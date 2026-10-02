/**
 * Replaces Elm kernel packages inside `ELM_HOME` with a patched copy.
 *
 * Elm compiles against the package sources it keeps in `ELM_HOME`, so patching a
 * kernel package means editing that shared folder and then clearing the caches
 * Elm would otherwise reuse.
 *
 * Callers use the module in two steps. `prepareArgs` resolves every path the work
 * depends on and returns them as one value, and `replaceKernelPackages` performs
 * the patching. Keeping the two apart makes the resolved paths visible before
 * anything is written to disk.
 *
 * @packageDocumentation
 */

import { prettyError, prettyInfo } from '@elm-toolkit/cli-lib'
import path from 'node:path'
import fs from 'node:fs'
import * as os from 'node:os'
import * as childProcess from 'node:child_process'

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
 * Resolves every path the patching depends on, so a caller can inspect them
 * before any file is touched.
 *
 * The Elm home comes from `ELM_HOME` when it is set, and from the user home
 * directory otherwise. The project folder falls back to `INIT_CWD`, which npm and
 * yarn set when they run a script, and then to the current working directory.
 *
 * The Elm version comes from `elm-version` in the project's `elm.json`. Elm keeps
 * its packages and its cache in folders named after that version, and each
 * supported version has its own patch archive, so every path depends on it.
 *
 * @example
 *
 * Patch the project in the current folder using the bundled archive
 * ```TypeScript
 *   replaceKernelPackages(prepareArgs(true))
 * ```
 *
 * @param useArchive - true to extract the bundled archive, false to read a `patches/` folder
 * @param elmJsonFolder - the folder holding the project's `elm.json`
 * @returns the resolved paths and options, ready for `replaceKernelPackages`
 * @throws Error when `elm.json` cannot be read, or when it declares an Elm version
 * that the patches do not support
 */
export function prepareArgs(useArchive: boolean, elmJsonFolder?: string): ReplaceKernelArgs {
  const ROOT = elmJsonFolder ?? process.env.INIT_CWD ?? process.cwd()
  const CURRENT = __dirname
  const ELM_VERSION = readElmVersion(path.join(ROOT, 'elm.json'))
  const ELM_HOME = process.env.ELM_HOME || path.join(os.homedir(), '.elm')
  const ELM_HOME_PACKAGES = path.join(ELM_HOME, ELM_VERSION, 'packages')

  return {
    CURRENT: CURRENT,
    ELM_HOME: ELM_HOME,
    ELM_HOME_PACKAGES: ELM_HOME_PACKAGES,
    ELM_VERSION: ELM_VERSION,
    PATCH_ARCHIVE: path.join(CURRENT, patchArchives[ELM_VERSION]),
    PATCH_DIR: path.join(CURRENT, 'patches'),
    PROJECT_ELM_ROOT: ROOT,
    PROJECT_ELM_STUFF: path.join(ROOT, 'elm-stuff', ELM_VERSION),
    USE_ARCHIVE: useArchive,
  }
}

/**
 * Reads the Elm version that a project declares, and stops on one that the
 * patches do not support, before any path is resolved or any file touched.
 *
 * @param elmJsonPath - path to the project's `elm.json`
 * @returns the declared version, one of the keys of `patchArchives`
 * @throws Error when `elm.json` cannot be read, or when its version is not supported
 */
function readElmVersion(elmJsonPath: string): string {
  let elmVersion: unknown

  try {
    elmVersion = JSON.parse(fs.readFileSync(elmJsonPath, 'utf-8'))['elm-version']
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error)

    prettyError('elm.json reading', 'the Elm version of the project could not be read')
    console.info(indent(`file: ${elmJsonPath}\ncause: ${cause}`))

    throw new Error(`Failed to read elm.json: ${cause}`)
  }

  if (typeof elmVersion !== 'string' || !Object.hasOwn(patchArchives, elmVersion)) {
    const supported = Object.keys(patchArchives)

    prettyError('elm version checking', 'the project uses a version that the patches do not support')
    console.info(indent(`file: ${elmJsonPath}\nelm-version: ${String(elmVersion)}\nsupported: ${supported.join(', ')}`))

    throw new Error(`The patches support Elm ${supported.join(' and ')}, but elm.json declares ${String(elmVersion)}.`)
  }

  return elmVersion
}

/**
 * Indents every line of a detail, so that it reads as part of the message
 * printed above it.
 *
 * @param text - the detail, on one or more lines
 * @returns the same text with each line indented
 */
function indent(text: string): string {
  return text
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n')
}

/**
 * Every path and option one patching run needs, as produced by `prepareArgs`.
 *
 * The values are read only inputs. Printing this value is the quickest way to see
 * which folders a run is about to read and write.
 */
export type ReplaceKernelArgs = {
  CURRENT: string
  ELM_HOME: string
  ELM_HOME_PACKAGES: string
  ELM_VERSION: string
  PATCH_ARCHIVE: string
  PATCH_DIR: string
  PROJECT_ELM_ROOT: string
  PROJECT_ELM_STUFF: string
  USE_ARCHIVE: boolean
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
 * Apply the bundled patches to the current project
 * ```TypeScript
 *   replaceKernelPackages(prepareArgs(true))
 * ```
 *
 * @param args - the resolved paths and options from `prepareArgs`
 * @throws Error when `elm.json` cannot be read, when a version does not match the
 * pinned one, or when a patched package holds more than one version
 */
export function replaceKernelPackages(args: ReplaceKernelArgs): void {
  prettyInfo('> Running:', 'Elm kernel patcher with given params')
  console.info(args)
  console.info('\n')
  let elmJsonDependencies

  try {
    elmJsonDependencies = parseElmJsonDependencies(path.join(args.PROJECT_ELM_ROOT, 'elm.json'))
  } catch (error) {
    throw new Error(`Failed to parse elm.json: ${error instanceof Error ? error.message : String(error)} `)
  }

  // The archive is extracted inside the installed package, so the folder must go on every path,
  // also when the extraction itself fails halfway and leaves part of it behind.
  try {
    if (args.USE_ARCHIVE) {
      prettyInfo('> Running:', "I'll un-archive patch folder:", args.PATCH_ARCHIVE)
      childProcess.execFileSync('tar', ['-xzf', args.PATCH_ARCHIVE, '-C', args.CURRENT])
    }

    applyPatches(args, elmJsonDependencies)
  } finally {
    if (args.USE_ARCHIVE) {
      prettyInfo('> Running: ', "I'm removing the unarchived patch folder:", args.PATCH_DIR)
      fs.rmSync(args.PATCH_DIR, { force: true, recursive: true })
    }
  }

  prettyInfo('> Done: ', 'Finished successfully\n')
}

/**
 * Checks each extracted patched package against the versions that `elm.json` pins,
 * then copies the packages into `ELM_HOME` when the copy there is out of date.
 *
 * @param args - the resolved paths and options from `prepareArgs`
 * @param elmJsonDependencies - the package names mapped to the versions the project pins
 * @throws Error when a version does not match the pinned one, or when a patched
 * package holds more than one version
 */
function applyPatches(args: ReplaceKernelArgs, elmJsonDependencies: Record<string, string>): void {
  let alreadyUpToDate = true

  for (const user of readDir(args.PATCH_DIR)) {
    for (const package_ of readDir(user.path)) {
      const versions = readDir(package_.path)
      if (versions.length !== 1) {
        throw new Error(
          `Replace Kernel packages: Found more than one version! \n\nVersions: ${versions
            .map((version) => version.name)
            .join(', ')}\n\nIn: ${package_.path}`
        )
      }

      const [version] = versions
      const packageIdentifier = `${user.name}/${package_.name}`
      const elmJsonVersion: string = elmJsonDependencies[packageIdentifier]

      if (elmJsonVersion !== version.name) {
        throw new Error(`Replace Kernel packages: Expected version ${version.name}
          for ${packageIdentifier} in elm.json, but got: ${String(elmJsonVersion)}`)
      }

      const destinationDir = path.join(args.ELM_HOME_PACKAGES, user.name, package_.name, version.name)

      // ALL packages in patch archive must have a source.txt file showing
      // where the code was taken from. We use that to see if elm-home/
      // is already patched.
      const sourceFileName = 'source.txt'

      if (
        !fs.existsSync(path.join(destinationDir, sourceFileName)) ||
        fs.readFileSync(path.join(destinationDir, sourceFileName), 'utf-8') !==
          fs.readFileSync(path.join(version.path, sourceFileName), 'utf-8')
      ) {
        prettyInfo('> Running:', "I'll patch this file: ", path.join(destinationDir))
        alreadyUpToDate = false
        // Forces Elm to use the patched files we'll copy soon:
        fs.rmSync(path.join(destinationDir, 'artifacts.dat'), {
          force: true,
        })
      } else {
        prettyInfo('> Running:', "I'll skip patching for file:", path.join(destinationDir))
      }
    }
  }

  // This file contains JavaScript code from Elm packages.
  // If it exists, but doesn't contain code from our elm/virtual-dom
  // package replacement, we must have compiled without the replacements
  // some time. Even if elm-home/ is up-to-date, that won't be used because
  // of this cache file.
  const oDat: string = path.join(args.PROJECT_ELM_STUFF, 'o.dat')
  if (
    alreadyUpToDate &&
    fs.existsSync(oDat) &&
    // This is specific to lydell/virtual-dom: Change as needed if you patch other things.
    !fs.readFileSync(oDat, 'utf-8').includes('_VirtualDom_createTNode')
  ) {
    alreadyUpToDate = false
  }

  if (!alreadyUpToDate) {
    prettyInfo('> Running: ', 'Patching elm packages in: ', args.ELM_HOME_PACKAGES)
    fs.cpSync(args.PATCH_DIR, args.ELM_HOME_PACKAGES, { recursive: true })
    // Force Elm to recompile everything:
    prettyInfo('> Running: ', 'Invalidate cache fingerprint for: ', args.PROJECT_ELM_STUFF)
    fs.rmSync(args.PROJECT_ELM_STUFF, { force: true, recursive: true })
  }
}

/**
 * Reads the dependencies of an Elm project, direct and indirect together, because
 * a kernel patch can apply to either kind.
 *
 * @param elmJsonPath - path to the project's `elm.json`
 * @returns the package names mapped to the versions the project pins
 * @throws Error when the file is not valid JSON or lacks the expected structure
 */
function parseElmJsonDependencies(elmJsonPath: string): Record<string, string> {
  const elmJson = JSON.parse(fs.readFileSync(elmJsonPath, 'utf-8'))
  if (typeof elmJson !== 'object' || elmJson === null) {
    throw new Error('elmJson is not an object.')
  }
  if (typeof elmJson.dependencies !== 'object' || elmJson.dependencies === null) {
    throw new Error('elmJson dependencies field is not an object')
  }
  if (typeof elmJson.dependencies.direct !== 'object' || elmJson.dependencies.direct === null) {
    throw new Error('elmJson dependencies direct field is not an object.')
  }
  if (typeof elmJson.dependencies.indirect !== 'object' || elmJson.dependencies.indirect === null) {
    throw new Error('elmJson dependencies. indirect field is not an object.')
  }

  return { ...elmJson.dependencies.direct, ...elmJson.dependencies.indirect }
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
