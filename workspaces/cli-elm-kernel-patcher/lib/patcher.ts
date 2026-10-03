/**
 * Replaces Elm kernel packages inside `ELM_HOME` with a patched copy.
 *
 * Elm compiles against the package sources it keeps in `ELM_HOME`, so patching a
 * kernel package means editing that shared folder and then clearing the caches
 * Elm would otherwise reuse.
 *
 * `patchKernel` does the whole work and prints its progress and its outcome; the
 * command and the webpack plugin use it. It runs two steps, which a caller can
 * also run alone: `prepareArgs` resolves every path the work depends on, and
 * `replaceKernelPackages` performs the patching. Keeping the two apart makes the
 * resolved paths visible before anything is written to disk.
 *
 * No function here throws. Each step returns a `Result` with a `CliError`, which
 * says to the person who runs the command what failed and why, and only
 * `patchKernel` prints.
 *
 * The patches come from the archive inside this package unless the caller names
 * other ones: a patch folder made by the `archive` commands, an archive of a
 * `patches/` folder, or such a folder itself. Inside it, each package sits at
 * `<author>/<package>/<version>/`.
 *
 * @packageDocumentation
 */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { CliError, CliSuccess, Result, prettyInfo } from '@elm-toolkit/cli-lib'

import { archiveName, manifestName } from './archive-builder.ts'
import { archiveCommand, inWorkFolder, report, shown } from './steps.ts'

const __dirname = import.meta.dirname

/**
 * The Elm versions the patches are known to work with, each mapped to the
 * archive that holds its patches. The same patches work on 0.19.1 and 0.19.2,
 * so both use one archive; a version that needs other patches gets an archive of
 * its own here. A project on a version that is not listed is refused.
 */
const patchArchives: Readonly<Record<string, string>> = {
  '0.19.1': 'patches.tar.gz',
  '0.19.2': 'patches.tar.gz',
}

/**
 * Chooses the project and the patches for one run of `prepareArgs`.
 *
 * @example
 *
 * Patch a project in a subfolder with an archive of your own
 * ```TypeScript
 *   const options: PatchOptions = { elmJsonFolder: 'frontend', patches: 'kernel/patches.tar.gz' }
 * ```
 */
export type PatchOptions = {
  /**
   * The Elm home to patch. A relative path starts from the folder that holds
   * `elm.json`. Without it, the `ELM_HOME` of the environment is used, or
   * `~/.elm` when that is not set.
   */
  elmHome?: string
  /**
   * The folder that holds `elm.json`. It defaults to `INIT_CWD`, which npm and
   * yarn set when they run a script, and then to the current directory.
   */
  elmJsonFolder?: string
  /**
   * Patches of your own: a patch folder made by the `archive` commands, a
   * `.tar.gz` archive of a `patches/` folder, or the folder itself. A relative
   * path starts from the folder that holds `elm.json`. Without it, the archive
   * inside this package is used.
   */
  patches?: string
}

/**
 * Every path one patching run needs, as produced by `prepareArgs`.
 *
 * The values are read only inputs. Printing this value is the quickest way to see
 * which folders a run is about to read and write.
 */
export type ReplaceKernelArgs = {
  ELM_HOME: string
  ELM_HOME_PACKAGES: string
  ELM_VERSION: string
  PATCHES: string
  PROJECT_ELM_ROOT: string
  PROJECT_ELM_STUFF: string
}

/**
 * What a patching run did: each patched package of the Elm home, and whether it
 * was copied or was already up to date.
 *
 * @example
 *
 * Count the packages that a run copied
 * ```TypeScript
 *   const run: PatchReport = {
 *     cache: '/project/elm-stuff/0.19.1',
 *     cleared: true,
 *     elmHome: '/home/me/.elm',
 *     packages: [{ copied: true, folder: '/home/me/.elm/0.19.1/packages/elm/core/1.0.5', name: 'elm/core', version: '1.0.5' }],
 *   }
 *   run.packages.filter((patched) => patched.copied).length // 1
 * ```
 */
export type PatchReport = {
  /** The cache of the project, which the run removes when it copies. */
  cache: string
  /** True when the run copied the packages and removed the cache of the project. */
  cleared: boolean
  /** The Elm home that the run patched. */
  elmHome: string
  /** One entry for each patched package, with its folder in the Elm home. */
  packages: Array<{ copied: boolean; folder: string; name: string; version: string }>
}

/**
 * Patches the Elm home of a project, and prints the progress and the outcome
 * once. The command and the webpack plugin call this function.
 *
 * @example
 *
 * Patch the project in the current folder with the bundled patches
 * ```TypeScript
 *   patchKernel()
 *   // Ok { cleared: true, packages: [ … ] }, or Err with the message it printed
 * ```
 *
 * @param options - the project folder, the Elm home and the patches to use, all optional
 * @returns `Ok` what the run did, or `Err` with the message that it printed
 */
export function patchKernel(options: PatchOptions = {}): Result<CliError, PatchReport> {
  const patched = prepareArgs(options).andThen((args) => {
    prettyInfo('> Running:', 'Patching the Elm home with these settings')
    console.info(
      [
        `Elm home: ${shown(args.ELM_HOME)}`,
        `Elm version: ${args.ELM_VERSION}`,
        `Patches: ${options.patches === undefined ? 'the patches of this package' : shown(args.PATCHES)}`,
        `Project: ${shown(args.PROJECT_ELM_ROOT) || '.'}`,
      ]
        .map((line) => `    ${line}`)
        .join('\n')
    )

    return replaceKernelPackages(args)
  })

  return report('kernel patching', patched, ({ cache, cleared, elmHome, packages }) => {
    const copied = packages.filter((each) => each.copied).length

    return CliSuccess.create({
      details: [
        ...packages.map(({ copied: wasCopied, name, version }) =>
          wasCopied ? `${name} ${version}: patched` : `${name} ${version}: already patched`
        ),
        ...(cleared ? [`Removed ${shown(cache)}, so that Elm compiles the project again with the patches.`] : []),
      ],
      next: cleared ? 'Compile the project as usual. Elm now uses the patched packages.' : undefined,
      summary:
        copied > 0
          ? `Patched ${copied} of ${packages.length} kernel packages in ${shown(elmHome)}.`
          : `The Elm home ${shown(elmHome)} already has the patches.`,
    })
  })
}

/**
 * Resolves every path the patching depends on, so a caller can inspect them
 * before any file is touched.
 *
 * The Elm home is the one in the options, then the `ELM_HOME` of the
 * environment, then `~/.elm`.
 *
 * The Elm version comes from `elm-version` in the project's `elm.json`. Elm keeps
 * its packages and its cache in folders named after that version, so every path
 * depends on it. With the patches of this package, a version they do not support
 * is refused. With patches of your own, any version is accepted, and the check of
 * each package version against `elm.json` still protects the Elm home.
 *
 * @example
 *
 * Resolve the paths of the project in the current folder
 * ```TypeScript
 *   prepareArgs()
 *   // Ok { ELM_HOME: '/home/me/.elm', ELM_VERSION: '0.19.1', … }
 * ```
 *
 * @param options - the project folder, the Elm home and the patches to use, all optional
 * @returns `Ok` the resolved paths, ready for `replaceKernelPackages`, or `Err`
 * when `elm.json` cannot be read, when it declares an Elm version that the
 * bundled patches do not support, or when the given patches do not exist
 */
export function prepareArgs(options: PatchOptions = {}): Result<CliError, ReplaceKernelArgs> {
  const root = options.elmJsonFolder ?? process.env.INIT_CWD ?? process.cwd()
  const elmHome =
    options.elmHome === undefined
      ? process.env.ELM_HOME || path.join(os.homedir(), '.elm')
      : path.resolve(root, options.elmHome)
  const patches = (elmVersion: string): Result<CliError, string> =>
    options.patches === undefined
      ? Result.Ok(path.join(__dirname, patchArchives[elmVersion] ?? ''))
      : findPatches(
          path.resolve(root, options.patches),
          archiveCommand('build', { elmJsonFolder: options.elmJsonFolder, folder: options.patches })
        )

  return readElmVersion(path.join(root, 'elm.json'), options.patches === undefined).andThen((elmVersion) =>
    patches(elmVersion).map((found) => {
      return {
        ELM_HOME: elmHome,
        ELM_HOME_PACKAGES: path.join(elmHome, elmVersion, 'packages'),
        ELM_VERSION: elmVersion,
        PATCHES: found,
        PROJECT_ELM_ROOT: root,
        PROJECT_ELM_STUFF: path.join(root, 'elm-stuff', elmVersion),
      }
    })
  )
}

/**
 * Copies the patched packages into `ELM_HOME` and clears the caches that would
 * hide them from the next compilation.
 *
 * The function refuses to run when a patched package does not carry the version
 * that `elm.json` pins, because a mismatch would silently corrupt the shared Elm
 * home. It also stops when a patched package holds more than one version. The
 * Elm version itself is checked earlier, by `prepareArgs`.
 *
 * Repeated runs are cheap. Each patched package records where its code came from,
 * and a run that finds the same record already in place skips the copy.
 *
 * @example
 *
 * Apply the bundled patches to the current project, without printing
 * ```TypeScript
 *   (prepareArgs()).andThen(replaceKernelPackages)
 * ```
 *
 * @param args - the resolved paths from `prepareArgs`
 * @returns `Ok` what the run did, or `Err` when `elm.json` cannot be read, when
 * the patches are in another layout, when a version does not match the pinned
 * one, or when a patched package holds more than one version
 */
export function replaceKernelPackages(args: ReplaceKernelArgs): Result<CliError, PatchReport> {
  const apply = (patchDir: string, dependencies: Record<string, string>): Result<CliError, PatchReport> =>
    checkLayout(patchDir, args.PATCHES).andThen(() => applyPatches(patchDir, args, dependencies))

  return readDependencies(path.join(args.PROJECT_ELM_ROOT, 'elm.json')).andThen((dependencies) => {
    if (fs.statSync(args.PATCHES).isDirectory()) {
      return apply(args.PATCHES, dependencies)
    }

    // A temporary folder, because the installed package can be read only.
    return inWorkFolder((extracted) =>
      Result.fromAttempt(() => execFileSync('tar', ['-xzf', args.PATCHES, '-C', extracted], { stdio: 'pipe' }))
        .mapError((caught) =>
          CliError.withSolution(
            CliError.fromUnknown(`tar could not read ${shown(args.PATCHES)}`, caught),
            'Check that the file is a .tar.gz archive. Build one with `cli-elm-kernel-patcher archive build`, or with `tar -czf patches.tar.gz patches`.'
          )
        )
        .andThen(() => apply(path.join(extracted, 'patches'), dependencies))
    )
  })
}

/**
 * Checks that the patches a caller named exist, before any file is touched. A
 * patch folder, which holds `elm-kernel-patcher.json`, stands for the archive
 * next to that manifest.
 *
 * @param patches - the absolute path of the patch folder, of the archive or of the folder
 * @param build - the build command for that folder, for the message of a missing archive
 * @returns `Ok` the path of the archive or of the folder to read, or `Err` when
 * nothing exists at that path, or when a patch folder has no archive yet
 */
function findPatches(patches: string, build: string): Result<CliError, string> {
  if (!fs.existsSync(patches)) {
    return Result.Err(
      CliError.create({
        solution: 'Check the path. A relative path starts from the folder that holds elm.json.',
        summary: `No patches at ${shown(patches)}.`,
      })
    )
  }
  if (!fs.existsSync(path.join(patches, manifestName))) {
    return Result.Ok(patches)
  }

  const archive = path.join(patches, archiveName)

  return fs.existsSync(archive)
    ? Result.Ok(archive)
    : Result.Err(
        CliError.create({
          solution: `Build the archive with \`${build}\`.`,
          summary: `No ${archiveName} in ${shown(patches)}.`,
        })
      )
}

/**
 * Reads the Elm version that a project declares. With the bundled patches it
 * also refuses a version they do not support, before any path is resolved or
 * any file touched.
 *
 * @param elmJsonPath - path to the project's `elm.json`
 * @param bundledPatches - true when the patches come from this package
 * @returns `Ok` the declared version, or `Err` when `elm.json` cannot be read,
 * or when its version is not supported
 */
function readElmVersion(elmJsonPath: string, bundledPatches: boolean): Result<CliError, string> {
  const supported = Object.keys(patchArchives)

  return (
    fs.existsSync(elmJsonPath)
      ? Result.fromAttempt(
          () => (JSON.parse(fs.readFileSync(elmJsonPath, 'utf-8')) as { 'elm-version'?: unknown })['elm-version']
        ).mapError((caught) => CliError.fromUnknown(`could not read the Elm version in ${shown(elmJsonPath)}`, caught))
      : Result.Err(
          CliError.create({
            solution:
              'Run the command in the folder of your Elm project, or point to that folder with `--elmJsonFolder <folder>`.',
            summary: `${shown(elmJsonPath)} does not exist.`,
          })
        )
  ).andThen((elmVersion) =>
    typeof elmVersion !== 'string'
      ? Result.Err(
          CliError.create({
            solution: `Add the Elm version of the project to elm.json, for example "elm-version": "${supported.at(-1) ?? '0.19.1'}".`,
            summary: `${shown(elmJsonPath)} has no "elm-version".`,
          })
        )
      : !bundledPatches || Object.hasOwn(patchArchives, elmVersion)
        ? Result.Ok(elmVersion)
        : Result.Err(
            CliError.create({
              details: [`file: ${shown(elmJsonPath)}`],
              solution: `Use Elm ${supported.join(' or ')}, or give patches made for Elm ${elmVersion} with \`--patches <folder>\`.`,
              summary: `The patches support Elm ${supported.join(' and ')}, but elm.json declares ${elmVersion}.`,
            })
          )
  )
}

/**
 * Reads the dependencies of an Elm application, direct and indirect together,
 * because a kernel patch can apply to either kind.
 *
 * @param elmJsonPath - path to the project's `elm.json`
 * @returns `Ok` the package names mapped to the versions the project pins, or
 * `Err` when the file is not valid JSON or is not the `elm.json` of an application
 */
function readDependencies(elmJsonPath: string): Result<CliError, Record<string, string>> {
  type Dependencies = { direct?: unknown; indirect?: unknown }

  return Result.fromAttempt(
    () => (JSON.parse(fs.readFileSync(elmJsonPath, 'utf-8')) as { dependencies?: Dependencies }).dependencies
  )
    .mapError((caught) => CliError.fromUnknown(`could not read ${shown(elmJsonPath)}`, caught))
    .andThen((dependencies) => {
      const isObject = (value: unknown): value is Record<string, string> => typeof value === 'object' && value !== null

      return isObject(dependencies?.direct) && isObject(dependencies.indirect)
        ? Result.Ok({ ...dependencies.direct, ...dependencies.indirect })
        : Result.Err(
            CliError.create({
              details: [`the patcher needs the direct and indirect dependencies that an application pins`],
              solution: 'Run the patcher on the application that uses this package, not on the package itself.',
              summary: `${shown(elmJsonPath)} is not the elm.json of an application.`,
            })
          )
    })
}

/**
 * Checks that a patch folder holds `<author>/<package>/<version>/source.txt`
 * for every package, before anything is copied. Without this check, patches of
 * one's own in another layout fail later with an error about a missing file.
 *
 * @param patchDir - the folder that should hold the patched packages, by author
 * @param origin - the archive or the folder that the caller gave, for the message
 * @returns `Ok` when the layout is right, or `Err` when the folder is missing,
 * empty, or in another layout
 */
function checkLayout(patchDir: string, origin: string): Result<CliError, void> {
  const isFolder = (folder: string): boolean => fs.existsSync(folder) && fs.statSync(folder).isDirectory()
  const versions = isFolder(patchDir)
    ? readDir(patchDir)
        .filter((author) => isFolder(author.path))
        .flatMap((author) => readDir(author.path))
        .filter((package_) => isFolder(package_.path))
        .flatMap((package_) => readDir(package_.path))
    : []

  return versions.length > 0 && versions.every((version) => fs.existsSync(path.join(version.path, 'source.txt')))
    ? Result.Ok(undefined)
    : Result.Err(
        CliError.create({
          details: [`for example elm/core/1.0.5/source.txt`],
          solution:
            'Create the archive from the folder that holds patches/, with `tar -czf patches.tar.gz patches`, or build it with `cli-elm-kernel-patcher archive build`.',
          summary: `The patches at ${shown(origin)} do not follow the layout <author>/<package>/<version>/source.txt.`,
        })
      )
}

/**
 * Checks each patched package against the versions that `elm.json` pins, then
 * copies the packages into `ELM_HOME` when the copy there is out of date.
 *
 * @param patchDir - the folder that holds the patched packages, by author
 * @param args - the resolved paths from `prepareArgs`
 * @param dependencies - the package names mapped to the versions the project pins
 * @returns `Ok` what the run did, or `Err` when a version does not match the
 * pinned one, when a patched package holds more than one version, or when a
 * file cannot be copied
 */
function applyPatches(
  patchDir: string,
  args: ReplaceKernelArgs,
  dependencies: Record<string, string>
): Result<CliError, PatchReport> {
  const found = Result.fromAttempt(() =>
    readDir(patchDir).flatMap((author) =>
      readDir(author.path).map((package_) => {
        return { name: `${author.name}/${package_.name}`, versions: readDir(package_.path) }
      })
    )
  ).mapError((caught) => CliError.fromUnknown(`could not read the patches in ${shown(patchDir)}`, caught))
  const checked = found.andThen((packages) =>
    packages.reduce<Result<CliError, Array<{ folder: string; name: string; source: string; version: string }>>>(
      (valid, package_) =>
        Result.map2(valid, checkVersion(package_, dependencies, args.ELM_HOME_PACKAGES), (list, one) => [...list, one]),
      Result.Ok([])
    )
  )

  return checked.andThen((packages) =>
    Result.fromAttempt(() => {
      // A package is up to date when the Elm home holds the same record of where its code came from.
      const report = packages.map(({ folder, name, source, version }) => {
        const installed = path.join(folder, 'source.txt')
        const copied =
          !fs.existsSync(installed) || fs.readFileSync(installed, 'utf-8') !== fs.readFileSync(source, 'utf-8')

        return { copied, folder, name, version }
      })
      const oDat = path.join(args.PROJECT_ELM_STUFF, 'o.dat')
      // o.dat keeps the compiled code of the packages. Without the code of the patched elm/virtual-dom, the
      // project was compiled without the patches, and Elm would reuse that code even with a patched Elm home.
      const staleCache = fs.existsSync(oDat) && !fs.readFileSync(oDat, 'utf-8').includes('_VirtualDom_createTNode')
      const cleared = report.some(({ copied }) => copied) || staleCache

      if (cleared) {
        for (const { copied, folder } of report) {
          if (copied) {
            // Forces Elm to use the patched files that are copied next.
            fs.rmSync(path.join(folder, 'artifacts.dat'), { force: true })
          }
        }
        fs.cpSync(patchDir, args.ELM_HOME_PACKAGES, { recursive: true })
        fs.rmSync(args.PROJECT_ELM_STUFF, { force: true, recursive: true })
      }

      return { cache: args.PROJECT_ELM_STUFF, cleared, elmHome: args.ELM_HOME, packages: report }
    }).mapError((caught) => CliError.fromUnknown(`could not patch ${shown(args.ELM_HOME_PACKAGES)}`, caught))
  )
}

/**
 * Checks that a patched package holds exactly one version, and that it is the
 * version the project pins.
 *
 * @param package_ - the package, with the versions found in the patches
 * @param dependencies - the package names mapped to the versions the project pins
 * @param elmHomePackages - the packages folder of the Elm home
 * @returns `Ok` the folder of the package in the Elm home and its record of
 * origin, or `Err` when the versions do not match
 */
function checkVersion(
  package_: { name: string; versions: Array<{ name: string; path: string }> },
  dependencies: Record<string, string>,
  elmHomePackages: string
): Result<CliError, { folder: string; name: string; source: string; version: string }> {
  const { versions } = package_
  const [version] = versions
  const pinned = dependencies[package_.name]

  if (versions.length !== 1 || version === undefined) {
    return Result.Err(
      CliError.create({
        details: [`versions: ${versions.map((each) => each.name).join(', ')}`],
        solution: `Keep one version folder for ${package_.name} and delete the others.`,
        summary: `${package_.name} has ${versions.length} versions in the patches; it needs exactly one.`,
      })
    )
  }
  if (pinned !== version.name) {
    return Result.Err(
      CliError.create({
        solution:
          pinned === undefined
            ? `Add ${package_.name} ${version.name} to elm.json, or remove ${package_.name} from the patches.`
            : `Pin ${package_.name} ${version.name} in elm.json, or use patches made for ${package_.name} ${pinned}.`,
        summary: `${package_.name} is ${version.name} in the patches, but elm.json pins ${pinned ?? 'no version of it'}.`,
      })
    )
  }

  return Result.Ok({
    folder: path.join(elmHomePackages, package_.name, version.name),
    name: package_.name,
    source: path.join(version.path, 'source.txt'),
    version: version.name,
  })
}

/**
 * Lists the entries of a directory with their full paths, skipping hidden files.
 *
 * @param dir - the directory to read
 * @returns one entry per visible child, with its name and its full path
 */
function readDir(dir: string): Array<{ name: string; path: string }> {
  return fs
    .readdirSync(dir)
    .filter((name) => !name.startsWith('.')) // Ignore files Like .DS_Store
    .map((name) => {
      return { name, path: path.join(dir, name) }
    })
}
