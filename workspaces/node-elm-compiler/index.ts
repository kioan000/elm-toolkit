/**
 * Runs the Elm compiler from Node, with the API of the `node-elm-compiler` npm
 * package, so code written for the original works with it.
 *
 * This API is deprecated. Every function here throws or rejects when something
 * fails, as the original did. The API at `@elm-toolkit/node-elm-compiler/result-api`
 * has the same names and options, and returns each failure as a `Result`
 * instead; it also adds `dryCompile`, which checks a program without writing
 * any output. The functions here are thin wrappers around it: they call the
 * new function and turn its error back into the message that the original
 * threw.
 *
 * Start with `compile`, which returns the compiler process. `compileToString`
 * returns the generated JavaScript instead, and the `Sync` variants block until
 * the compiler exits. `findAllDependencies` lists the local files that an Elm
 * module imports, and `compileWorker` starts a headless Elm program in this
 * process.
 *
 * @packageDocumentation
 */

import { type ChildProcess, spawn } from 'node:child_process'

import { CliError, type Result } from '@elm-toolkit/cli-lib'

import { CompileError } from './compile-error.ts'
// eslint-disable-next-line import-x/no-deprecated -- the old API keeps exporting the old function
import { findAllDependencies } from './find-elm-dependencies.ts'
import {
  type CompilerOptions,
  type CompilerSpawn,
  type CompilerSpawnSync,
  type SyncCompilerResult,
  elmBinaryName,
  prepareOptions,
  prepareProcessOpts,
  processArgs,
  spawnSyncAsCompilerSpawn,
  startErrorMessage,
  systemMessages,
} from './process.ts'
import * as resultApi from './result-api.ts'

export type { CompilerOptions, CompilerProcessOptions } from './process.ts'

/**
 * Starts `elm make` on the given files and returns the running process. Use it
 * when the caller wants the exit code or the streams; use `compileToString` when
 * it only wants the generated JavaScript.
 *
 * The compiler prints to the terminal of the current process, unless
 * `processOpts.stdio` says otherwise.
 *
 * When the binary cannot start, for example because it is not installed, the
 * process emits `'error'` with a message that names the binary, and then closes
 * with a non-zero code. The current process does not crash.
 *
 * @deprecated Use `compile` of `@elm-toolkit/node-elm-compiler/result-api`, which
 * returns a `Result` instead of throwing.
 *
 * @example
 *
 * Build an application and react to the result
 * ```TypeScript
 *   compile(['src/Main.elm'], { output: 'dist/main.js', optimize: true })
 *     .on('close', (exitCode) => console.log(exitCode === 0 ? 'built' : 'failed'))
 * ```
 *
 * @param sources - one Elm file, or a list of Elm files that become one bundle
 * @param options - the flags for `elm make` and the settings of its process
 * @returns the compiler process, already running
 * @throws a message that names the binary, when the compiler cannot start, and
 * an `Error` for an option that this module does not know
 */
export function compile(sources: unknown, options: CompilerOptions): ChildProcess {
  return orThrow(resultApi.compile(legacySources(sources), options))
}

/**
 * Runs `elm make` and waits for it to exit. Use it in scripts that cannot
 * continue before the build is done, and where blocking the process is fine.
 *
 * @deprecated Use `compileSync` of `@elm-toolkit/node-elm-compiler/result-api`,
 * which returns a `Result` with the messages of the compiler.
 *
 * @example
 *
 * Fail a build script when the compiler reports an error
 * ```TypeScript
 *   const result = compileSync('src/Main.elm', { output: 'dist/main.js' })
 *   if (result.status !== 0) process.exit(1)
 * ```
 *
 * @param sources - one Elm file, or a list of Elm files that become one bundle
 * @param options - the flags for `elm make` and the settings of its process
 * @returns the result of `spawnSync`, with the exit status and the captured output
 * @throws a message that names the binary, when the compiler cannot start, and
 * an `Error` for an option that this module does not know
 */
export function compileSync(sources: unknown, options: CompilerOptions): SyncCompilerResult {
  const prepared = prepareOptions(options, options.spawn ?? spawnSyncAsCompilerSpawn)
  const pathToElm = options.pathToElm || elmBinaryName
  const args = orThrow(processArgs(legacySources(sources), prepared))

  if (prepared.verbose) {
    console.log(['Running', pathToElm, ...args].join(' '))
  }

  // The new compileSync returns only the messages, so this one runs the process itself to keep the exit status.
  try {
    return (prepared.spawn as CompilerSpawnSync)(pathToElm, args, prepareProcessOpts(prepared))
  } catch (err: unknown) {
    throw err instanceof Error && !('code' in err) ? err : startErrorMessage(err, pathToElm)
  }
}

/**
 * Compiles Elm files and returns the generated JavaScript as text. The compiler
 * writes to a temporary directory, which is removed after the file is read.
 *
 * The compiler messages are captured. They appear in the error when the build
 * fails, and on the console when `verbose` is set.
 *
 * @deprecated Use `compileToString` of `@elm-toolkit/node-elm-compiler/result-api`,
 * which returns a `Result` instead of rejecting.
 *
 * @example
 *
 * Compile an optimized bundle and write it where the server expects it
 * ```TypeScript
 *   const javascript = await compileToString('src/Main.elm', { optimize: true })
 *   await writeFile('public/main.js', javascript)
 * ```
 *
 * @param sources - one Elm file, or a list of Elm files that become one bundle
 * @param options - the compiler options; `output` only selects the file extension
 * @returns the generated JavaScript
 */
export async function compileToString(sources: unknown, options: CompilerOptions): Promise<string> {
  const remembered = rememberThrows((options.spawn ?? spawn) as CompilerSpawn)
  const compiled = await resultApi.compileToString(legacySources(sources), { ...options, spawn: remembered.spawn })

  // The original let a throw of spawn pass, and reported a later start error or a stopped compiler as a failed build.
  return orThrow(
    compiled.mapError((error): CompileError => {
      switch (error.type_) {
        case 'CompilerNotStarted':
          return remembered.threw()
            ? error
            : { exitCode: null, output: legacyStartMessage(error), sources: [], type_: 'CompileFailed' }
        case 'CompilerStopped':
          return { exitCode: null, output: '', sources: [], type_: 'CompileFailed' }
        case 'UnknownOption':
        case 'CompileFailed':
        case 'TempFolderNotCreated':
        case 'OutputNotRead':
        case 'ModuleNotFound':
        case 'WorkerNotStarted':
        case 'NoPorts':
        case 'EntryNotRead':
        case 'InvalidModule':
          return error
      }
    })
  )
}

/**
 * Compiles Elm files, waits for the compiler, and returns the generated
 * JavaScript as text. The compiler messages go to the terminal.
 *
 * @deprecated Use `compileToStringSync` of `@elm-toolkit/node-elm-compiler/result-api`,
 * which returns a `Result` instead of throwing.
 *
 * @example
 *
 * Compile a module inside a synchronous build step
 * ```TypeScript
 *   const javascript = compileToStringSync('src/Main.elm', { optimize: true })
 * ```
 *
 * @param sources - one Elm file, or a list of Elm files that become one bundle
 * @param options - the compiler options; `output` only selects the file extension
 * @returns the generated JavaScript
 * @throws the string `'Compilation failed.'` when the compiler exits with an error
 */
export function compileToStringSync(sources: unknown, options: CompilerOptions): string {
  const remembered = rememberThrows((options.spawn ?? spawnSyncAsCompilerSpawn) as CompilerSpawnSync)
  const compiled = resultApi.compileToStringSync(legacySources(sources), { ...options, spawn: remembered.spawn })

  switch (compiled.type_) {
    case 'Ok':
      return compiled.value
    case 'Err':
      switch (compiled.error.type_) {
        // The original let a throw of spawn pass, and reported a compiler that ran badly as a failed build.
        case 'CompilerNotStarted':
          throw remembered.threw() ? legacyError(compiled.error) : 'Compilation failed.'
        case 'CompileFailed':
        case 'CompilerStopped':
          throw 'Compilation failed.'
        case 'UnknownOption':
        case 'TempFolderNotCreated':
        case 'OutputNotRead':
        case 'ModuleNotFound':
        case 'WorkerNotStarted':
        case 'NoPorts':
        case 'EntryNotRead':
        case 'InvalidModule':
          throw legacyError(compiled.error)
      }
  }
}

/**
 * Compiles a headless Elm program and starts it inside the current process.
 * Use it for build steps and command line tools written in Elm, which exchange
 * data with Node through ports.
 *
 * The compiler runs in `projectRootDir`, so `elm.json` is found there. The
 * working directory of the current process does not change, and the compiled
 * code is removed once the worker has started.
 *
 * @deprecated Use `compileWorker` of `@elm-toolkit/node-elm-compiler/result-api`,
 * which returns a `Result` instead of rejecting.
 *
 * @example
 *
 * Start a worker and listen to one of its ports
 * ```TypeScript
 *   const worker = await compileWorker('.', 'src/Generator.elm', 'Generator', { flags: { seed: 42 } })
 *   worker.ports.emit.subscribe((file) => console.log(file))
 * ```
 *
 * @param projectRootDir - the directory that contains `elm.json`
 * @param modulePath - the Elm file to compile
 * @param moduleName - the module to start, as Elm names it, for example `Generator`
 * @param workerArgs - the argument of `init`, as Elm expects it: `{ flags: ... }`, or
 * `undefined` for a program without flags
 * @returns the running worker, with its ports
 * @throws an `Error` when the build fails, when `moduleName` is not in the
 * output, which lists the modules that are, or when the module has no ports
 */
export async function compileWorker(
  projectRootDir: string,
  modulePath: string,
  moduleName: string,
  workerArgs: unknown
): Promise<resultApi.WorkerWithPorts> {
  const started = await resultApi.compileWorker(projectRootDir, modulePath, moduleName, workerArgs)

  switch (started.type_) {
    case 'Ok':
      return started.value
    case 'Err': {
      const cause = workerMessage(started.error)

      throw new Error(String(cause), { cause })
    }
  }
}

/**
 * Returns the arguments that `compile` would pass to the `elm` binary, without
 * starting it. It exists because `node-elm-compiler` exported it, and it helps
 * to check which flags a set of options produces.
 *
 * @deprecated Use `prepareProcessArgs` of `@elm-toolkit/node-elm-compiler/result-api`,
 * which returns a `Result` instead of throwing.
 *
 * @example
 *
 * See the command line for a debug build
 * ```TypeScript
 *   _prepareProcessArgs('src/Main.elm', { debug: true, output: 'main.js' })
 *   // ['make', 'src/Main.elm', '--debug', '--output', 'main.js']
 * ```
 *
 * @param sources - one Elm file, or a list of Elm files
 * @param options - the compiler options; options that are not flags add nothing
 * @returns the arguments, starting with `make`
 */
export function _prepareProcessArgs(sources: unknown, options: CompilerOptions): string[] {
  return orThrow(resultApi.prepareProcessArgs(legacySources(sources), options))
}

// eslint-disable-next-line import-x/no-deprecated -- the old API keeps exporting the old function
export { findAllDependencies }

/**
 * Wraps a spawn function so that the old API knows whether it threw. The new
 * API returns a throw of spawn and a start error emitted later as the same
 * error, while the original package reported them in different ways. The
 * wrapper goes only into the options of one call.
 *
 * @param spawnFunction - the spawn function of the options, or the default one
 * @returns `spawn`, which behaves as the given function, and `threw`, which
 * says whether a call of it threw
 */
function rememberThrows<A extends unknown[], R>(
  spawnFunction: (...args: A) => R
): { spawn: (...args: A) => R; threw: () => boolean } {
  let threw = false

  const remembering = (...args: A): R => {
    try {
      return spawnFunction(...args)
    } catch (err: unknown) {
      threw = true

      throw err
    }
  }

  return { spawn: remembering, threw: () => threw }
}

/**
 * Checks the sources at run time, as the original did for JavaScript callers.
 *
 * @param sources - what the caller passed
 * @returns the list of files
 * @throws a message when the sources are neither a string nor an array
 */
function legacySources(sources: unknown): ReadonlyArray<string> {
  if (Array.isArray(sources)) {
    return sources.map(String)
  }

  if (typeof sources === 'string') {
    return [sources]
  }

  throw 'compile() received neither an Array nor a String for its sources argument.'
}

/**
 * Takes the value out of a result, or throws its error in the form of the
 * original package.
 *
 * @param result - the outcome of a function of the new API
 * @returns the value
 * @throws the error, as the original threw it
 */
function orThrow<A>(result: Result<CompileError, A>): A {
  switch (result.type_) {
    case 'Ok':
      return result.value
    case 'Err':
      throw legacyError(result.error)
  }
}

/**
 * Turns a compile error into what the original package threw: an `Error` for
 * a problem of the options or of the build, and a string for a compiler that
 * could not start.
 *
 * @param error - the compile error
 * @returns the value to throw
 */
function legacyError(error: CompileError): unknown {
  switch (error.type_) {
    case 'UnknownOption':
      return new Error(legacyOptionMessage(error.option))
    case 'CompilerNotStarted':
      // The original let an Error without a system code pass unchanged, for example one of a custom spawn.
      return error.original instanceof Error && !('code' in error.original) ? error.original : legacyStartMessage(error)
    case 'CompileFailed':
      return new Error(`Compilation failed\n${error.output}`)
    case 'CompilerStopped':
      return new Error(error.cause)
    case 'TempFolderNotCreated':
    case 'OutputNotRead':
      return error.original
    case 'ModuleNotFound':
    case 'WorkerNotStarted':
    case 'NoPorts':
      return workerMessage(error)
    case 'EntryNotRead':
    case 'InvalidModule':
      return new Error(CliError.toString(CompileError.toCliError(error)))
  }
}

/**
 * The message of the original package for an option that it does not know.
 *
 * @param option - the name of the option
 * @returns the message
 */
function legacyOptionMessage(option: string): string {
  switch (option) {
    case 'yes':
    case 'warn':
      return `node-elm-compiler received the \`${option}\` option, but that was removed in Elm 0.19. Try re-running without passing the \`${option}\` option.`
    case 'pathToMake':
      return 'node-elm-compiler received the `pathToMake` option, but that was renamed to `pathToElm` in Elm 0.19. Try re-running after renaming the parameter to `pathToElm`.'

    default:
      return `node-elm-compiler was given an unrecognized Elm compiler option: ${option}`
  }
}

/**
 * The message of the original package for a compiler that could not start,
 * made from the original exception, as the original package made it.
 *
 * @param error - the compile error
 * @returns the message
 */
function legacyStartMessage(error: Extract<CompileError, { type_: 'CompilerNotStarted' }>): string {
  // `compile` already gave an emitted error the message of the original package.
  return error.original instanceof Error && systemMessages.has(error.original)
    ? error.original.message
    : startErrorMessage(error.original, error.pathToElm)
}

/**
 * The message of the original package for a worker that did not start. A
 * failed build now also carries the messages of Elm, which the original
 * printed to the terminal instead.
 *
 * @param error - the compile error
 * @returns the message
 */
function workerMessage(error: CompileError): unknown {
  switch (error.type_) {
    case 'CompileFailed':
      return `Errored with exit code ${String(error.exitCode)}\n${error.output}`
    case 'ModuleNotFound': {
      const hint =
        error.suggestions.length > 1
          ? `\nMaybe you meant one of these: ${error.suggestions.join(',')}`
          : error.suggestions.length === 1
            ? `\nMaybe you meant: ${error.suggestions.join('')}`
            : ''

      return `I couldn't find the entry module ${error.moduleName}.\n${hint}\nYou can pass me a different module to use with --module=<moduleName>`
    }
    case 'NoPorts':
      // The missing space before `port` is in the original message.
      return `The module ${error.moduleName} doesn't expose any ports!\n\n\nTry adding something likeport foo : Value\nport foo =\n    someValue\n\nto ${error.moduleName}!`
    case 'WorkerNotStarted':
      // The original wrapped the exception of init, whose text starts with its name.
      return `Error: ${error.cause}`
    case 'UnknownOption':
    case 'CompilerNotStarted':
    case 'CompilerStopped':
    case 'TempFolderNotCreated':
    case 'OutputNotRead':
    case 'EntryNotRead':
    case 'InvalidModule':
      return legacyError(error)
  }
}
