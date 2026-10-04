/**
 * Finds the local files that an Elm module depends on. This is a rewrite in
 * TypeScript of the `find-elm-dependencies` npm package, with the same behaviour.
 *
 * The search reads the `module` line to find the source directory of the file,
 * then the nearest `elm.json` that lists that directory. From there it reads only
 * the import section of each module and follows every import that resolves to a
 * file in one of the source directories. Imports from packages resolve to nothing
 * and are skipped.
 *
 * `findDependencies` returns a `Result`, with a `CompileError` when the search
 * cannot start. `findAllDependencies` is the function of the original package,
 * kept for compatibility: it logs that error and returns the dependencies it
 * already knew.
 *
 * @packageDocumentation
 */

import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import * as path from 'node:path'

import { CliError, Result } from '@elm-toolkit/cli-lib'

import { CompileError } from './compile-error.ts'

/**
 * The `elm.json` that lists a source directory, and the source directories it
 * lists.
 */
type ElmJsonMatch = {
  elmJsonPath: string
  sourceDirectories: ReadonlyArray<string>
}

/**
 * A cached match, with the modification time and the size that `elm.json` had
 * when it was read.
 */
type CachedElmJsonMatch = ElmJsonMatch & {
  modifiedAt: number
  size: number
}

const sourceDirectoriesCache = new Map<string, CachedElmJsonMatch>()

/**
 * Reads imports from a given Elm file asynchronously.
 *
 * @param file - Path to the Elm file
 * @returns Promise resolving to an array of import statements or null on error
 */
function readImports(file: string): Promise<ReadonlyArray<string> | null> {
  return new Promise((resolve) => {
    const stream = createReadStream(file, { encoding: 'utf8', highWaterMark: 8 * 60 })
    let buffer = ''
    const parser = new Parser()

    stream.on('error', () => {
      resolve(null)
    })

    stream.on('data', (chunk) => {
      buffer += chunk

      if (chunk.indexOf('\n') > -1) {
        const lines = buffer.split('\n')

        lines.slice(0, lines.length - 1).forEach((line) => parser.parseLine(line))
        buffer = lines[lines.length - 1]

        if (parser.isPastImports()) {
          stream.destroy()
        }
      }
    })

    stream.on('close', () => {
      resolve(parser.getImports())
    })
  })
}

/**
 * Parser for Elm import statements.
 */
class Parser {
  private moduleRead = false

  private readingImports = false

  private parsingDone = false

  private isInComment = false

  private imports: string[] = []

  /**
   * Parse a single line from an Elm file.
   *
   * @param line - Line to parse
   */
  public parseLine(line: string): void {
    if (this.parsingDone) {
      return
    }

    if (
      !this.moduleRead &&
      (line.startsWith('module ') || line.startsWith('port module') || line.startsWith('effect module'))
    ) {
      this.moduleRead = true
    } else if (this.moduleRead && line.indexOf('import ') === 0) {
      this.readingImports = true
    }

    if (this.isInComment) {
      if (line.endsWith('-}')) {
        this.isInComment = false
      }

      return
    }

    if (this.readingImports) {
      if (line.indexOf('import ') === 0) {
        this.imports.push(line)
      } else if (line.indexOf(' ') === 0 || line.trim().length === 0 || line.startsWith('--')) {
        // Ignore lines starting with whitespace, empty lines, and comments
      } else if (line.startsWith('{-')) {
        // A block comment that closes on the same line leaves nothing open.
        this.isInComment = !line.trimEnd().endsWith('-}')
      } else {
        // End of imports reached
        this.parsingDone = true
      }
    }
  }

  /**
   * Get all collected imports.
   *
   * @returns Array of import statements
   */
  public getImports(): ReadonlyArray<string> {
    return this.imports
  }

  /**
   * Check if parsing has reached past the imports section.
   *
   * @returns True if past imports
   */
  public isPastImports(): boolean {
    return this.parsingDone
  }
}

/**
 * Finds the source directory of an Elm file from its module declaration: the
 * module `Page.Home` in `src/Page/Home.elm` gives `src`.
 *
 * @param file - path to the Elm file
 * @returns `Ok` the base directory for imports, or `Err` when the file cannot be
 * read or its first line is not a module declaration
 */
async function baseDirOf(file: string): Promise<Result<CompileError, string>> {
  const firstLine = (await Result.fromPromise(readFirstLine(file))).mapError((caught): CompileError => {
    return { cause: caught instanceof Error ? caught.message : String(caught), file, kind: 'entryNotRead' }
  })

  return firstLine.andThen((line): Result<CompileError, string> => {
    const matches = line.match(/^(?:port\s+)?module\s+([^\s]+)/)

    if (matches) {
      const dependencyLogicalName = matches[1].replace(/\./g, '/')
      const backedOut = dependencyLogicalName.replace(/[^/]+/g, '..')

      return Result.Ok(path.normalize(path.dirname(file) + backedOut.replace(/^\.\./, '')))
    }

    return line.match(/^(?:port\s+)?module\s/)
      ? Result.Err({ file, kind: 'invalidModule' })
      : Result.Ok(path.dirname(file))
  })
}

/**
 * Read only the first line from a file to avoid loading full contents.
 *
 * @param file - Path to file
 * @returns First line (without trailing CR)
 */
function readFirstLine(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stream = createReadStream(file, { encoding: 'utf8', highWaterMark: 1024 })
    let buffer = ''
    let done = false

    /**
     * Resolve only once to avoid race conditions between close/data events.
     *
     * @param value - First line value to resolve
     */
    function resolveOnce(value: string): void {
      if (!done) {
        done = true
        resolve(value)
      }
    }

    stream.on('data', (chunk) => {
      buffer += chunk
      const lineBreakIndex = buffer.indexOf('\n')

      if (lineBreakIndex !== -1) {
        resolveOnce(buffer.slice(0, lineBreakIndex).replace(/\r$/, ''))
        stream.destroy()
      }
    })

    stream.on('error', reject)
    stream.on('close', () => {
      resolveOnce(buffer.replace(/\r$/, ''))
    })
  })
}

/**
 * Parse elm.json and extract source-directories.
 *
 * @param elmPackagePath - Path to elm.json file
 * @returns Array of source directories
 */
function getSourceDirectories(elmPackagePath: string): ReadonlyArray<string> {
  try {
    const elmPackage = JSON.parse(readFileSync(elmPackagePath, 'utf8')) as {
      'source-directories'?: unknown
    }
    const sourceDirectories = elmPackage['source-directories']

    if (!Array.isArray(sourceDirectories)) {
      console.warn(`Ignored package metadata JSON file with missing/invalid source-directories: ${elmPackagePath}`)

      return []
    }

    return sourceDirectories.map((sourceDir) => path.resolve(path.dirname(elmPackagePath), String(sourceDir)))
  } catch {
    console.warn(`Ignored malformed package metadata JSON file: ${elmPackagePath}`)

    return []
  }
}

/**
 * Check if a path is the filesystem root.
 *
 * @param dir - Directory path
 * @returns True if it's the root
 */
function isRoot(dir: string): boolean {
  const parsedPath = path.parse(dir)

  return parsedPath.root === parsedPath.dir
}

/**
 * Recursively find the elm.json and extract source directories.
 *
 * @param baseDir - Base directory to start searching from
 * @param currentDir - Current directory being checked (defaults to baseDir)
 * @returns The elm.json that lists baseDir and its source directories, or undefined when none does
 */
function getElmPackageSourceDirectories(baseDir: string, currentDir?: string): ElmJsonMatch | undefined {
  if (!currentDir) {
    baseDir = path.resolve(baseDir)
    currentDir = baseDir
  }

  const elmPackagePath = path.join(currentDir, 'elm.json')

  if (existsSync(elmPackagePath)) {
    const sourceDirectories = getSourceDirectories(elmPackagePath)

    if (sourceDirectories.includes(baseDir)) {
      return { elmJsonPath: elmPackagePath, sourceDirectories }
    }
  }

  if (isRoot(currentDir)) {
    return undefined
  }

  return getElmPackageSourceDirectories(baseDir, path.dirname(currentDir))
}

interface FindDepsResult {
  error: boolean
  file: string
  knownDependencies: ReadonlyArray<string>
}

/**
 * Build a normalized dependency discovery result payload.
 *
 * @param error - Whether dependency reading failed for the current file
 * @param file - File currently being analyzed
 * @param knownDependencies - Accumulated dependency set
 * @returns Structured dependency discovery result
 */
function toFindDepsResult(error: boolean, file: string, knownDependencies: ReadonlySet<string>): FindDepsResult {
  return {
    error,
    file,
    knownDependencies: [...knownDependencies],
  }
}

/**
 * Recursively find all dependencies for a given Elm file.
 *
 * @param file - Path to the Elm file
 * @param knownDependencies - Previously found dependencies (defaults to [])
 * @param sourceDirectories - Source directories from elm.json
 * @param knownFiles - Files already processed (defaults to [])
 * @returns Promise resolving to an array of all dependencies
 */
async function findAllDependenciesHelp(
  file: string,
  knownDependencies: Set<string>,
  sourceDirectories: ReadonlyArray<string>,
  knownFiles: Set<string>
): Promise<FindDepsResult> {
  if (knownFiles.has(file)) {
    return toFindDepsResult(false, file, knownDependencies)
  }

  knownFiles.add(file)
  const lines = await readImports(file)

  if (lines === null) {
    return toFindDepsResult(true, file, knownDependencies)
  }

  const validDependencies: string[] = []

  for (const line of lines) {
    const matches = line.match(/^import\s+([^\s]+)/)

    if (!matches) {
      continue
    }

    const moduleName = matches[1]
    const dependencyLogicalName = moduleName.replace(/\./g, '/')
    const extension = moduleName.startsWith('Native.') ? '.js' : '.elm'

    let resolvedDependency: string | null = null

    for (const sourceDir of sourceDirectories) {
      const absPath = path.join(sourceDir, dependencyLogicalName + extension)
      if (existsSync(absPath)) {
        resolvedDependency = absPath
        break
      }
    }

    if (!resolvedDependency) {
      continue
    }

    if (!knownDependencies.has(resolvedDependency)) {
      knownDependencies.add(resolvedDependency)
      validDependencies.push(resolvedDependency)
    }
  }

  const recursePromises = validDependencies
    .filter((dependency) => path.extname(dependency) === '.elm')
    .map((dependency) => findAllDependenciesHelp(dependency, knownDependencies, sourceDirectories, knownFiles))

  const extraDependencies = await Promise.all(recursePromises)
  const packagesInError = new Set(extraDependencies.filter((item) => item.error).map((item) => item.file))

  if (packagesInError.size > 0) {
    const filtered = new Set([...knownDependencies].filter((item) => !packagesInError.has(item)))

    return toFindDepsResult(false, file, filtered)
  }

  return toFindDepsResult(false, file, knownDependencies)
}

/**
 * Get source-directories for a base dir, reading elm.json only when it changed.
 *
 * A webpack process in watch mode lives for a whole session, and elm.json can
 * change during it, so a cached entry counts only while its elm.json keeps the
 * same modification time and size. A search that finds no elm.json is not
 * cached, so a file created later is found at once.
 *
 * @param baseDir - Base source directory for the requested Elm entrypoint
 * @returns Cached or freshly discovered source-directories
 */
function getCachedElmPackageSourceDirectories(baseDir: string): ReadonlyArray<string> {
  const resolvedBaseDir = path.resolve(baseDir)
  const cached = sourceDirectoriesCache.get(resolvedBaseDir)

  if (cached && isUnchanged(cached)) {
    return cached.sourceDirectories
  }

  const match = getElmPackageSourceDirectories(resolvedBaseDir)

  if (!match) {
    sourceDirectoriesCache.delete(resolvedBaseDir)

    return []
  }

  const stats = statSync(match.elmJsonPath, { throwIfNoEntry: false })

  // elm.json can disappear between the read and this call; its directories are still valid, but not cached.
  if (stats !== undefined) {
    sourceDirectoriesCache.set(resolvedBaseDir, { ...match, modifiedAt: stats.mtimeMs, size: stats.size })
  }

  return match.sourceDirectories
}

/**
 * Check whether a cached elm.json still has the modification time and the size
 * it had when it was read.
 *
 * @param cached - Cached match to check
 * @returns True if the file is still there and looks unchanged
 */
function isUnchanged(cached: CachedElmJsonMatch): boolean {
  const stats = statSync(cached.elmJsonPath, { throwIfNoEntry: false })

  return stats !== undefined && stats.mtimeMs === cached.modifiedAt && stats.size === cached.size
}

/**
 * Lists every local file that an Elm module imports, directly or through other
 * modules. A bundler in watch mode needs this list, because `elm make` rebuilds
 * from the entry file and does not report which files it read.
 *
 * Imports of `Native.*` modules resolve to `.js` files, as they did before Elm
 * 0.19. A file that cannot be read further down is dropped from the result.
 *
 * @example
 *
 * Find what a page depends on
 * ```TypeScript
 *   await findDependencies('/app/src/Page/Home.elm')
 *   // Ok ['/app/src/Api.elm', '/app/src/Ui/Button.elm']
 * ```
 *
 * @param file - the absolute path of the Elm module to start from
 * @param knownDependencies - dependencies found earlier, which are kept in the result
 * @param sourceDirectories - the absolute source directories; when absent they come from `elm.json`
 * @param knownFiles - files already visited, which are not read again
 * @returns `Ok` the absolute paths of the dependencies, where `file` itself is
 * absent unless an import cycle, which Elm rejects, leads back to it; or `Err`
 * when the entry file cannot be read or is not an Elm module
 */
export async function findDependencies(
  file: string,
  knownDependencies: ReadonlyArray<string> = [],
  sourceDirectories?: ReadonlyArray<string>,
  knownFiles: ReadonlyArray<string> = []
): Promise<Result<CompileError, ReadonlyArray<string>>> {
  const search = async (directories: ReadonlyArray<string>): Promise<ReadonlyArray<string>> =>
    (await findAllDependenciesHelp(file, new Set(knownDependencies), directories, new Set(knownFiles)))
      .knownDependencies

  if (sourceDirectories) {
    return Result.Ok(await search(sourceDirectories))
  }

  const baseDir = await baseDirOf(file)

  switch (baseDir.tag) {
    case 'Ok':
      return Result.Ok(await search(getCachedElmPackageSourceDirectories(baseDir.value)))
    case 'Err':
      return Result.Err(baseDir.error)
  }
}

/**
 * Lists every local file that an Elm module imports, as `findDependencies`
 * does, but with the behaviour of the original package: when the search fails,
 * for example because the entry file does not exist, the error is logged and
 * `knownDependencies` is returned unchanged.
 *
 * @deprecated Use `findAllDependencies` of `@elm-toolkit/node-elm-compiler/result-api`, which returns a `Result`
 * instead of logging the error.
 *
 * @example
 *
 * Find what a page depends on
 * ```TypeScript
 *   await findAllDependencies('/app/src/Page/Home.elm')
 *   // ['/app/src/Api.elm', '/app/src/Ui/Button.elm']
 * ```
 *
 * @param file - the absolute path of the Elm module to start from
 * @param knownDependencies - dependencies found earlier, which are kept in the result
 * @param sourceDirectories - the absolute source directories; when absent they come from `elm.json`
 * @param knownFiles - files already visited, which are not read again
 * @returns the absolute paths of the dependencies; `file` itself is absent, unless an
 * import cycle, which Elm rejects, leads back to it
 */
export async function findAllDependencies(
  file: string,
  knownDependencies: ReadonlyArray<string> = [],
  sourceDirectories?: ReadonlyArray<string>,
  knownFiles: ReadonlyArray<string> = []
): Promise<ReadonlyArray<string>> {
  const found = await findDependencies(file, knownDependencies, sourceDirectories, knownFiles)

  switch (found.tag) {
    case 'Ok':
      return found.value
    case 'Err':
      console.error(`Error finding dependencies for ${file}:`, CliError.toString(CompileError.toCliError(found.error)))

      return knownDependencies
  }
}
