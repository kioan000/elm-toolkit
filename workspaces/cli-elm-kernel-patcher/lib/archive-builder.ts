/**
 * Builds a patch archive from a manifest of Git commits, the same way this
 * package builds the archive it ships.
 *
 * Both files live in one folder, `elm-kernel-patcher/` by default, next to
 * `elm.json`. The manifest, `elm-kernel-patcher.json`, lists one entry for each
 * patched package under its `patches` key: the package, the Git address of its
 * fork and one commit. The archive, `patches.tar.gz`, is a
 * copy of those commits in the layout that the patcher reads, so a project that
 * keeps it never needs the network or the original repositories to patch. Pass
 * the folder to the patcher, or to the webpack plugin, as `patches`.
 *
 * The work has three steps, in this order. `initManifest` starts a manifest from
 * the one this package uses. `buildArchive` fetches every commit and writes the
 * archive. `checkArchive` builds the same files again and proves that the
 * archive still holds exactly what the manifest says.
 *
 * Each commit is fetched with `git`, so any Git server works, and a private
 * repository works with the credentials of the person who runs it. From each
 * commit the archive keeps `elm.json`, `LICENSE` and `src/`, and adds
 * `source.txt` with the address of the commit, which the patcher compares to
 * decide whether an Elm home is already patched.
 *
 * Every step below the three functions returns a `Result` with a `CliError`,
 * and never throws: a call of Node runs inside `Result.attempt`, and its
 * exception becomes a `CliError` that says what failed. The three functions
 * chain the steps, print the progress and the outcome once, and return the
 * `Result`, so that a command only has to set its exit code.
 *
 * @packageDocumentation
 */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import { CliError, CliSuccess, Result, prettyInfo } from '@elm-toolkit/cli-lib'

import { archiveCommand, inWorkFolder, patchCommand, report, shown } from './steps.ts'

/** The name of the manifest inside a patch folder. */
export const manifestName = 'elm-kernel-patcher.json'

/** The name of the archive inside a patch folder. */
export const archiveName = 'patches.tar.gz'

// The build copies the manifest next to the compiled module, as it does with the archive.
const bundledManifest = path.join(import.meta.dirname, manifestName)

// The files of a package that Elm reads, plus its license, which the copy must keep.
const keptFiles = ['elm.json', 'LICENSE', 'src']

/**
 * Chooses the patch folder, which holds the manifest and the archive.
 *
 * @example
 *
 * Keep the patch folder next to an Elm project in a subfolder
 * ```TypeScript
 *   const options: ArchiveOptions = { elmJsonFolder: 'frontend' }
 *   // the manifest is frontend/elm-kernel-patcher/elm-kernel-patcher.json
 * ```
 */
export type ArchiveOptions = {
  /**
   * The folder that holds `elm.json`, where a relative `folder` starts. It
   * defaults to `INIT_CWD`, which npm and yarn set when they run a script, and
   * then to the current directory, as in the patcher.
   */
  elmJsonFolder?: string
  /** The patch folder. It defaults to `elm-kernel-patcher`. */
  folder?: string
}

/** One package of a manifest: where its code lives, and the exact commit to take. */
type ManifestEntry = { commit: string; git: string; packageName: string; pullRequest?: string }

/** A package that the archive holds: its entry, and the version that the elm.json of its commit declares. */
type WrittenPackage = ManifestEntry & { version: string }

/**
 * Creates the patch folder with a manifest of the patches that this package
 * ships, as a starting point. Change the commits, or add and remove packages,
 * then build the archive.
 *
 * @example
 *
 * Start a patch folder next to `elm.json`
 * ```TypeScript
 *   initManifest()
 *   // Ok '…/elm-kernel-patcher/elm-kernel-patcher.json', with elm/browser, elm/core, elm/html and elm/virtual-dom
 * ```
 *
 * @param options - the patch folder, which is created when it is missing
 * @returns `Ok` the absolute path of the manifest, or `Err` when a manifest is
 * already there, so that nothing is overwritten
 */
export function initManifest(options: ArchiveOptions = {}): Result<CliError, string> {
  const { build, init, manifest } = resolvePaths(options)
  const written = fs.existsSync(manifest)
    ? Result.Err(
        CliError.create({
          solution: `Edit the manifest that is there, or delete it and run \`${init}\` again.`,
          summary: `${shown(manifest)} already exists.`,
        })
      )
    : Result.fromAttempt(() => {
        fs.mkdirSync(path.dirname(manifest), { recursive: true })
        fs.copyFileSync(bundledManifest, manifest)

        return manifest
      }).mapError((caught) => CliError.fromUnknown(`could not write ${shown(manifest)}`, caught))

  return report('archive init', written, () =>
    CliSuccess.create({
      next: `Change the commits you need in it, then build the archive with \`${build}\`.`,
      summary: `Created ${shown(manifest)} with the patches of this package.`,
    })
  )
}

/**
 * Fetches every commit of the manifest and writes the archive of the patch
 * folder, replacing any archive there.
 *
 * @example
 *
 * Build the archive of the patch folder next to `elm.json`
 * ```TypeScript
 *   buildArchive()
 *   // Ok '…/elm-kernel-patcher/patches.tar.gz'
 * ```
 *
 * @param options - the patch folder, whose manifest is read and whose archive is written
 * @returns `Ok` the absolute path of the archive, or `Err` when the manifest is
 * invalid, when a commit cannot be fetched, or when a commit holds another
 * package or misses a kept file
 */
export function buildArchive(options: ArchiveOptions = {}): Result<CliError, string> {
  const { archive, init, manifest } = resolvePaths(options)
  const built = readManifest(manifest, init).andThen((entries) => {
    prettyInfo(
      '> Running:',
      `Fetching ${commits(entries.length)} with Git: ${entries.map((entry) => entry.packageName).join(', ')}`
    )

    return inWorkFolder((work) =>
      writePatches(entries, path.join(work, 'patches')).andThen((packages) =>
        Result.fromAttempt(() => {
          fs.mkdirSync(path.dirname(archive), { recursive: true })
          // macOS tar adds an AppleDouble file, ._name, for each file with extended attributes; Linux would extract them.
          execFileSync('tar', ['-czf', archive, '-C', work, 'patches'], {
            env: { ...process.env, COPYFILE_DISABLE: '1' },
            stdio: 'pipe',
          })

          return packages
        }).mapError((caught) => CliError.fromUnknown(`tar could not write ${shown(archive)}`, caught))
      )
    )
  })

  return report('archive build', built, (packages) =>
    CliSuccess.create({
      next: `Give the folder to the patcher with \`${patchCommand(options)}\`, or to the webpack plugin as "patches".`,
      summary: `Built ${shown(archive)} from ${commits(packages.length)}.`,
      whatHappened: packages.map(
        ({ commit, git, packageName, version }) => `${packageName} ${version} from ${git} at ${commit.slice(0, 7)}`
      ),
    })
  ).map(() => archive)
}

/**
 * Builds the files of the manifest in a temporary folder and compares them with
 * the archive, file by file. The bytes of the archive itself are not compared,
 * because `tar` and `gzip` write different bytes for the same files on
 * different systems.
 *
 * @example
 *
 * Fail a CI job when the archive and the manifest disagree
 * ```TypeScript
 *   checkArchive({ elmJsonFolder: 'frontend' })
 *   // Ok 64, or Err with every file that differs
 * ```
 *
 * @param options - the patch folder, whose manifest and archive are compared
 * @returns `Ok` the number of files that match, or `Err` that lists every file
 * that is missing, extra or different, or that explains why the manifest could
 * not be built
 */
export function checkArchive(options: ArchiveOptions = {}): Result<CliError, number> {
  const { archive, build, init, manifest } = resolvePaths(options)
  // Without an archive there is nothing to compare, so the commits are not fetched at all.
  const manifestEntries = fs.existsSync(archive)
    ? readManifest(manifest, init)
    : Result.Err(
        CliError.create({
          solution: `Build the archive first with \`${build}\`.`,
          summary: `${shown(archive)} does not exist.`,
        })
      )
  const checked = manifestEntries.andThen((entries) => {
    prettyInfo(
      '> Running:',
      `Fetching ${commits(entries.length)} with Git: ${entries.map((entry) => entry.packageName).join(', ')}`
    )

    return inWorkFolder((work) => {
      const fresh = path.join(work, 'fresh')
      const stored = path.join(work, 'stored')
      const extracted = Result.fromAttempt(() => {
        fs.mkdirSync(stored)
        execFileSync('tar', ['-xzf', archive, '-C', stored], { stdio: 'pipe' })
      }).mapError((caught) =>
        CliError.withSolution(
          CliError.fromUnknown(`tar could not read ${shown(archive)}`, caught),
          `Rebuild the archive with \`${build}\`.`
        )
      )

      return writePatches(entries, path.join(fresh, 'patches')).andThen(() =>
        extracted.andThen(() => compareFolders(fresh, stored, { archive, build, manifest }))
      )
    })
  })

  return report('archive check', checked, (count) =>
    CliSuccess.create({
      summary: `${shown(archive)} matches ${shown(manifest)}.`,
      whatHappened: [`Compared ${count} files with the commits of the manifest. None of them differs.`],
    })
  )
}

/**
 * Finds the manifest and the archive of a patch folder, and the commands that
 * a message suggests for that folder.
 *
 * @param options - the patch folder and the folder it starts from
 * @returns the absolute paths of the archive and of the manifest, and the init
 * and build commands with the same options
 */
function resolvePaths(options: ArchiveOptions): { archive: string; build: string; init: string; manifest: string } {
  const base = options.elmJsonFolder ?? process.env.INIT_CWD ?? process.cwd()
  const folder = path.resolve(base, options.folder ?? 'elm-kernel-patcher')

  return {
    archive: path.join(folder, archiveName),
    build: archiveCommand('build', options),
    init: archiveCommand('init', options),
    manifest: path.join(folder, manifestName),
  }
}

/**
 * Reads the `patches` of a manifest, and refuses an entry without a package
 * name, a Git address or a full commit hash, because a branch name or a short
 * hash can point somewhere else later. A package may appear only once.
 *
 * @param manifestPath - the absolute path of the manifest
 * @param init - the init command for this patch folder, for the message of a missing manifest
 * @returns `Ok` the entries, in the order of the manifest, or `Err` when the file
 * is missing or cannot be read, when `patches` is not a list, or when an entry is incomplete or
 * repeats a package
 */
function readManifest(manifestPath: string, init: string): Result<CliError, ManifestEntry[]> {
  const parsed = fs.existsSync(manifestPath)
    ? Result.fromAttempt(
        () => JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { patches?: Array<Partial<ManifestEntry>> }
      ).mapError((caught) =>
        CliError.withSolution(
          CliError.fromUnknown(`could not read ${shown(manifestPath)}`, caught),
          'Fix the JSON of the manifest. The message above says where the problem is.'
        )
      )
    : Result.Err(
        CliError.create({
          solution: `Create it with \`${init}\`.`,
          summary: `${shown(manifestPath)} does not exist.`,
        })
      )

  return parsed.andThen((manifest) => {
    if (!Array.isArray(manifest.patches)) {
      return Result.Err(
        CliError.create({
          solution:
            'Put one entry for each package in a "patches" list. For an example, run ' +
            '`cli-elm-kernel-patcher archive init --folder example` and open example/elm-kernel-patcher.json.',
          summary: `${shown(manifestPath)} needs a "patches" list, with one entry for each package.`,
        })
      )
    }

    const seen = new Set<string>()

    for (const [index, entry] of manifest.patches.entries()) {
      const label = typeof entry.packageName === 'string' ? entry.packageName : `entry ${index + 1}`

      if (
        typeof entry.packageName !== 'string' ||
        typeof entry.git !== 'string' ||
        typeof entry.commit !== 'string' ||
        !/^[0-9a-f]{40}$/.test(entry.commit)
      ) {
        return Result.Err(
          CliError.create({
            solution:
              'Copy the full 40 character hash from the page of the commit. A branch name or a short hash can point to another commit later.',
            summary: `${label} in ${shown(manifestPath)} needs "packageName", "git" and a full 40 character "commit".`,
          })
        )
      }
      if (seen.has(entry.packageName)) {
        return Result.Err(
          CliError.create({
            solution: `Remove one of the entries for ${entry.packageName}.`,
            summary: `${entry.packageName} appears more than once in ${shown(manifestPath)}.`,
          })
        )
      }
      seen.add(entry.packageName)
    }

    return Result.Ok(manifest.patches as ManifestEntry[])
  })
}

/**
 * Writes the patch folder that the patcher reads, one package after the other,
 * and stops at the first package that fails.
 *
 * @param entries - the entries of the manifest
 * @param patchesFolder - the folder to create, named `patches`
 * @returns `Ok` each written package with its version, or the `Err` of the first one that fails
 */
function writePatches(entries: ManifestEntry[], patchesFolder: string): Result<CliError, WrittenPackage[]> {
  // Like a fold in Elm: once a package fails, map2 keeps that error and skips the rest.
  return entries.reduce<Result<CliError, WrittenPackage[]>>(
    (written, entry) => Result.map2(written, writePackage(entry, patchesFolder), (list, one) => [...list, one]),
    Result.Ok([])
  )
}

/**
 * Fetches the commit of one entry and writes it as
 * `<author>/<package>/<version>/` with the kept files and `source.txt`. The
 * version comes from the `elm.json` of the commit.
 *
 * @param entry - the entry of the manifest
 * @param patchesFolder - the folder that receives the package
 * @returns `Ok` when the package is written, or `Err` when the commit cannot be
 * fetched, holds another package, or misses a kept file
 */
function writePackage(entry: ManifestEntry, patchesFolder: string): Result<CliError, WrittenPackage> {
  return inWorkFolder((checkout) =>
    fetchCommit(entry, checkout).andThen(() =>
      readVersion(entry, checkout).andThen((version) =>
        copyPackage(entry, checkout, path.join(patchesFolder, entry.packageName, version)).map(() => {
          return { ...entry, version }
        })
      )
    )
  )
}

/**
 * Fetches one commit, and only that commit, into an empty folder.
 *
 * @param entry - the Git address and the commit
 * @param folder - the empty folder that receives the files
 * @returns `Ok` when the files are there, or `Err` when Git cannot fetch the
 * commit, for example because it is gone
 */
function fetchCommit(entry: ManifestEntry, folder: string): Result<CliError, void> {
  // Without a terminal prompt, a repository that needs credentials fails at once instead of waiting.
  const options = { cwd: folder, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, stdio: 'pipe' as const }

  const fetched = Result.fromAttempt(() => {
    execFileSync('git', ['init', '--quiet'], options)
    execFileSync('git', ['fetch', '--quiet', '--depth', '1', entry.git, entry.commit], options)
    execFileSync('git', ['checkout', '--quiet', 'FETCH_HEAD'], options)
  }).mapError((caught) => CliError.fromUnknown(`Git could not fetch ${entry.commit} from ${entry.git}`, caught))

  // A server such as GitHub answers a missing repository with an authentication error, to hide private ones.
  return fetched.mapError((error) =>
    /authentication|could not read username|terminal prompts disabled/i.test(CliError.toString(error))
      ? CliError.withSolution(
          error,
          'Check that the repository exists and that your Git credentials can read it, then run the command again.'
        )
      : /not our ref/i.test(CliError.toString(error))
        ? CliError.withSolution(
            error,
            'Check the commit in the manifest. The repository does not have it, perhaps because its branch was rewritten.'
          )
        : error
  )
}

/**
 * Reads the version of the package in a fetched commit, after checking that the
 * commit holds the package that the entry names.
 *
 * @param entry - the entry of the manifest
 * @param checkout - the folder of the fetched commit
 * @returns `Ok` the version, or `Err` when the commit holds another package or no `elm.json`
 */
function readVersion(entry: ManifestEntry, checkout: string): Result<CliError, string> {
  const elmJsonPath = path.join(checkout, 'elm.json')
  const elmJson: Result<CliError, { name?: string; version?: string }> = fs.existsSync(elmJsonPath)
    ? Result.fromAttempt(
        () => JSON.parse(fs.readFileSync(elmJsonPath, 'utf8')) as { name?: string; version?: string }
      ).mapError((caught) => CliError.fromUnknown(`could not read the elm.json of ${entry.commit}`, caught))
    : Result.Ok({})

  return elmJson.andThen(({ name, version }) =>
    name === entry.packageName && typeof version === 'string'
      ? Result.Ok(version)
      : Result.Err(
          CliError.create({
            solution: `Point "git" at a fork of ${entry.packageName}, or change "packageName" to ${String(name)}.`,
            summary: `${entry.git} at ${entry.commit} holds ${String(name)}, not ${entry.packageName}.`,
          })
        )
  )
}

/**
 * Copies the kept files of a fetched commit, and writes `source.txt`.
 *
 * @param entry - the entry of the manifest, for `source.txt` and the messages
 * @param checkout - the folder of the fetched commit
 * @param destination - the `<author>/<package>/<version>/` folder to write
 * @returns `Ok` when every file is written, or `Err` when a kept file is missing
 */
function copyPackage(entry: ManifestEntry, checkout: string, destination: string): Result<CliError, void> {
  const missing = keptFiles.find((file) => !fs.existsSync(path.join(checkout, file)))

  if (missing !== undefined) {
    return Result.Err(
      CliError.create({
        solution: 'Choose a commit of the fork whose top folder has elm.json, LICENSE and src.',
        summary: `${entry.git} at ${entry.commit} has no ${missing}.`,
      })
    )
  }

  return Result.fromAttempt(() => {
    for (const file of keptFiles) {
      fs.cpSync(path.join(checkout, file), path.join(destination, file), { recursive: true })
    }
    fs.writeFileSync(path.join(destination, 'source.txt'), sourceRecord(entry))
  }).mapError((caught) => CliError.fromUnknown(`could not copy ${entry.packageName}`, caught))
}

/**
 * Builds the text of `source.txt`. A GitHub repository gets the address of the
 * commit page, the form the shipped archive has always used; any other server
 * gets its Git address and the commit.
 *
 * @param entry - the Git address and the commit
 * @returns the text that records where the code came from
 */
function sourceRecord(entry: ManifestEntry): string {
  const github = /^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/.exec(entry.git)

  return github ? `https://github.com/${github[1]}/commit/${entry.commit}` : `${entry.git}#${entry.commit}`
}

/**
 * Compares two folders file by file.
 *
 * @param fresh - the folder built from the manifest
 * @param stored - the folder extracted from the archive
 * @param paths - the archive, the manifest and the build command, for the message
 * @returns `Ok` the number of files when the folders match, or `Err` that lists
 * every file that is missing, extra or different
 */
function compareFolders(
  fresh: string,
  stored: string,
  paths: { archive: string; build: string; manifest: string }
): Result<CliError, number> {
  const compared = Result.fromAttempt(() => {
    const freshFiles = listFiles(fresh)
    const storedFiles = listFiles(stored)
    const same = (file: string): boolean =>
      fs.readFileSync(path.join(fresh, file)).equals(fs.readFileSync(path.join(stored, file)))

    return {
      count: freshFiles.length,
      differences: [
        ...freshFiles.filter((file) => !storedFiles.includes(file)).map((file) => `missing from the archive: ${file}`),
        ...storedFiles.filter((file) => !freshFiles.includes(file)).map((file) => `not in the manifest: ${file}`),
        ...freshFiles.filter((file) => storedFiles.includes(file) && !same(file)).map((file) => `different: ${file}`),
      ],
    }
  }).mapError((caught) => CliError.fromUnknown('could not compare the files', caught))

  return compared.andThen(({ count, differences }) =>
    differences.length === 0
      ? Result.Ok(count)
      : Result.Err(
          CliError.create({
            solution: `Rebuild the archive with \`${paths.build}\`.`,
            summary: `${shown(paths.archive)} does not match ${shown(paths.manifest)}.`,
            whatHappened: differences,
          })
        )
  )
}

/**
 * Counts commits in words, for a message.
 *
 * @param count - the number of commits
 * @returns `1 commit`, or the number followed by `commits`
 */
function commits(count: number): string {
  return count === 1 ? '1 commit' : `${count} commits`
}

/**
 * Lists every file under a folder, as paths relative to it, in a stable order.
 * It throws when the folder cannot be read, so it runs inside `Result.attempt`.
 *
 * @param folder - the folder to read
 * @returns the relative paths of the files, sorted
 */
function listFiles(folder: string): string[] {
  return fs
    .readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(folder, path.join(entry.parentPath, entry.name)))
    .sort()
}
