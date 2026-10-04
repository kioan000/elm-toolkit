/**
 * The part of a compiler call that both APIs of this package share: the
 * options, the flags they become, and the settings of the child process.
 *
 * The module is internal; the package does not export it. Read
 * `CompilerOptions` first, then `processArgs`, which turns the options into the
 * arguments of `elm make` and refuses an option it does not know.
 *
 * @packageDocumentation
 */

import { type SpawnOptions, type SpawnSyncReturns, spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import * as process from 'node:process'

import { Maybe, Result } from '@elm-toolkit/cli-lib'

import type { CompileError } from './compile-error.ts'

/** The binary that runs when `pathToElm` is not given. */
export const elmBinaryName = 'elm'

/**
 * One Elm file, or a list of Elm files that become one bundle.
 *
 * @example
 *
 * Bundle two pages
 * ```TypeScript
 *   const sources: Sources = ['src/Home.elm', 'src/Admin.elm']
 * ```
 */
export type Sources = string | ReadonlyArray<string>

/** What a synchronous run of the compiler returns. */
export type SyncCompilerResult = SpawnSyncReturns<string | Buffer>

/** The part of a child process that this package uses, so that a test can pass its own. */
export interface CompilerProcessLike {
  on(event: string, listener: (...args: unknown[]) => void): CompilerProcessLike
  stderr?: NodeJS.ReadableStream | null
  stdout?: NodeJS.ReadableStream | null
}

/**
 * Options for the child process that runs the compiler, passed through to
 * `child_process.spawn`. The environment is merged with `process.env`, so a
 * caller only lists the variables it wants to add or change.
 *
 * @example
 *
 * Capture the compiler output instead of printing it
 * ```TypeScript
 *   compile('src/Main.elm', { processOpts: { stdio: 'pipe' } })
 * ```
 */
export interface CompilerProcessOptions extends SpawnOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
}

/** The process options of a synchronous run, which can also choose an encoding. */
export interface CompilerSyncProcessOptions extends CompilerProcessOptions {
  encoding?: BufferEncoding
}

/** A function that starts the compiler and returns its process. */
export type CompilerSpawn = (command: string, args: string[], options: CompilerProcessOptions) => CompilerProcessLike

/** A function that runs the compiler and waits for it. */
export type CompilerSpawnSync = (
  command: string,
  args: string[],
  options: CompilerSyncProcessOptions
) => SyncCompilerResult

/**
 * Describes one compiler run. The flag options (`debug`, `docs`, `help`,
 * `optimize`, `output`, `report`, `runtimeOptions`) become `elm make` flags. The
 * rest decide how the process starts: which binary, which directory, which
 * environment.
 *
 * An option that this list does not name is refused, so a misspelled flag
 * fails at once instead of being ignored. `yes`, `warn` and `pathToMake` were
 * removed in Elm 0.19, and the error says what to use instead.
 *
 * @example
 *
 * Build an optimized bundle with a compiler installed in the project
 * ```TypeScript
 *   const options: CompilerOptions = {
 *     optimize: true,
 *     output: 'dist/main.js',
 *     pathToElm: 'node_modules/.bin/elm',
 *   }
 * ```
 */
export interface CompilerOptions {
  [key: string]: unknown
  cwd?: string
  debug?: boolean
  docs?: string
  help?: boolean
  optimize?: boolean
  output?: string
  pathToElm?: string
  processOpts?: CompilerProcessOptions
  report?: string
  runtimeOptions?: ReadonlyArray<string>
  spawn?: CompilerSpawn | CompilerSpawnSync
  verbose?: boolean
}

const defaultOptions: CompilerOptions = {
  cwd: undefined,
  debug: undefined,
  docs: undefined,
  help: undefined,
  optimize: undefined,
  output: undefined,
  pathToElm: undefined,
  processOpts: undefined,
  report: undefined,
  runtimeOptions: undefined,
  spawn,
  verbose: false,
}

const supportedOptions = Object.keys(defaultOptions)

// The options that Elm 0.19 removed or renamed, with what to do instead.
const removedOptions: Readonly<Record<string, string>> = {
  pathToMake: 'Rename "pathToMake" to "pathToElm". Elm 0.19 renamed that option.',
  warn: 'Remove "warn" from the options. Elm 0.19 removed it.',
  yes: 'Remove "yes" from the options. Elm 0.19 removed it.',
}

/**
 * Applies the defaults of the original package without overwriting the
 * options that the caller set.
 *
 * @param options - the options of the caller
 * @param spawnFn - the function that starts the compiler, unless the caller gave one
 * @returns the options with their defaults
 */
export function prepareOptions(options: CompilerOptions, spawnFn: CompilerSpawn | CompilerSpawnSync): CompilerOptions {
  const prepared: CompilerOptions = { spawn: spawnFn }

  for (const source of [options, defaultOptions]) {
    for (const key of Object.keys(source)) {
      if (prepared[key] === undefined) {
        prepared[key] = source[key]
      }
    }
  }

  return prepared
}

/**
 * Builds the arguments of `elm make`, from the sources and the flag options.
 *
 * @param sources - the Elm files
 * @param options - the compiler options
 * @returns `Ok` the arguments, starting with `make`, or `Err` for an option that
 * this package does not know
 */
export function processArgs(sources: ReadonlyArray<string>, options: CompilerOptions): Result<CompileError, string[]> {
  return Object.entries(options).reduce<Result<CompileError, string[]>>(
    (args, [option, value]) => Result.map2(args, optionFlags(option, value), (all, flags) => [...all, ...flags]),
    Result.Ok(['make', ...sources])
  )
}

/**
 * Turns one option into its `elm make` flags.
 *
 * @param option - the name of the option
 * @param value - its value
 * @returns `Ok` the flags, none for an option about the process or a false flag,
 * or `Err` for an option that this package does not know
 */
function optionFlags(option: string, value: unknown): Result<CompileError, string[]> {
  if (!value) {
    return Result.Ok([])
  }

  switch (option) {
    case 'debug':
      return Result.Ok(['--debug'])
    case 'docs':
      return Result.Ok(['--docs', String(value)])
    case 'help':
      return Result.Ok(['--help'])
    case 'optimize':
      return Result.Ok(['--optimize'])
    case 'output':
      return Result.Ok(['--output', String(value)])
    case 'report':
      return Result.Ok(['--report', String(value)])
    case 'runtimeOptions':
      return Result.Ok(['+RTS', ...(value as ReadonlyArray<string>), '-RTS'])

    default:
      return supportedOptions.includes(option)
        ? Result.Ok([])
        : Result.Err({
            hint:
              removedOptions[option] ??
              `Remove "${option}", or correct its spelling. The known options are: ${supportedOptions.join(', ')}.`,
            kind: 'unknownOption',
            option,
          })
  }
}

/**
 * Builds the options of the child process. The environment of the current
 * process stays, and the compiler always gets an English locale, so that its
 * messages have the same form everywhere.
 *
 * @param options - the compiler options
 * @returns the options for `spawn` or `spawnSync`
 */
export function prepareProcessOpts(options: CompilerOptions): CompilerProcessOptions {
  const env = {
    LANG: 'en_US.UTF-8',
    ...process.env,
    ...options.processOpts?.env,
  }

  return {
    cwd: options.cwd,
    stdio: 'inherit',
    ...options.processOpts,
    env,
  }
}

/**
 * Describes a compiler that could not start, in the words that the original
 * package used, which the old API still throws.
 *
 * @param err - what the start threw or emitted
 * @param pathToElm - the binary that was started
 * @returns the message
 */
export function startErrorMessage(err: unknown, pathToElm: string): string {
  if (typeof err === 'object' && err !== null && 'code' in err && typeof err.code === 'string') {
    switch (err.code) {
      case 'ENOENT':
        return `Could not find Elm compiler "${pathToElm}". Is it installed?`
      case 'EACCES':
        return `Elm compiler "${pathToElm}" did not have permission to run. Do you need to give it executable permissions?`

      default:
        return `Error attempting to run Elm compiler "${pathToElm}":\n${String(err)}`
    }
  }

  if (typeof err === 'object' && err !== null && 'message' in err && typeof err.message === 'string') {
    return JSON.stringify(err.message)
  }

  return `Exception thrown when attempting to run Elm compiler ${JSON.stringify(pathToElm)}`
}

/**
 * The message that the system gave to a start error, before `compile` replaced
 * it with a message that names the binary. A `CompileError` shows the message
 * of the system, which the replacement only repeats.
 */
export const systemMessages = new WeakMap<Error, string>()

/**
 * Describes a compiler that could not start, as a compile error.
 *
 * @param err - what the start threw or emitted
 * @param pathToElm - the binary that was started
 * @returns the error, with the code of the system when there is one
 */
export function startError(err: unknown, pathToElm: string): CompileError {
  const code = typeof err === 'object' && err !== null && 'code' in err && typeof err.code === 'string' ? err.code : ''

  return {
    cause: err instanceof Error ? (systemMessages.get(err) ?? err.message) : String(err),
    code: code === '' ? Maybe.Nothing : Maybe.Just(code),
    kind: 'compilerNotStarted',
    pathToElm,
  }
}

/**
 * Chooses the extension of a temporary output file: the one of the requested
 * output, or the default.
 *
 * @param outputPath - the output that the caller asked for, if any
 * @param defaultSuffix - the extension to use otherwise
 * @returns the extension, with its dot
 */
export function getSuffix(outputPath: string | undefined, defaultSuffix: string): string {
  return (outputPath ? path.extname(outputPath) : '') || defaultSuffix
}

/**
 * Makes a temporary folder and returns the path of an output file inside it.
 *
 * @param suffix - the extension of the file
 * @returns the path of the file, which does not exist yet
 */
export function makeTempOutputPathSync(suffix: string): string {
  return path.join(mkdtempSync(path.join(tmpdir(), 'node-elm-compiler-')), `elm-output${suffix}`)
}

/**
 * Removes a temporary output file and its folder.
 *
 * @param filePath - the file that `makeTempOutputPathSync` returned
 */
export function cleanupTempFileSync(filePath: string): void {
  rmSync(path.dirname(filePath), { force: true, recursive: true })
}

/**
 * Runs the compiler synchronously, with the shape of the `spawn` option.
 *
 * @param command - the binary
 * @param args - its arguments
 * @param options - the process options
 * @returns what `spawnSync` returns
 */
export function spawnSyncAsCompilerSpawn(
  command: string,
  args: string[],
  options: CompilerSyncProcessOptions
): SyncCompilerResult {
  return spawnSync(command, args, options)
}
