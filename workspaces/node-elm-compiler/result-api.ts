/**
 * Runs the Elm compiler from Node, with every failure returned as a `Result`
 * instead of thrown.
 *
 * The functions have the names of the original API of this package, at its
 * root, and the same options; only the way they report a failure differs. A
 * failure is a `CompileError`, a value with a `kind` that a caller can inspect,
 * and `CompileError.toCliError` turns it into a message for a person.
 *
 * Start with `compileToString`, which returns the generated JavaScript, and
 * `dryCompile`, which only checks that the program compiles. `compile` returns
 * the running process for a caller that wants its streams. `compileWorker`
 * starts a headless Elm program in this process, and `findAllDependencies`
 * lists the local files that a module imports.
 *
 * @packageDocumentation
 */

import { type ChildProcess, spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { StringDecoder } from 'node:string_decoder'

import { Result } from '@elm-toolkit/cli-lib'

import type { CompileError } from './compile-error.ts'
import { findDependencies } from './find-elm-dependencies.ts'
import {
  type CompilerOptions,
  type CompilerProcessLike,
  type CompilerSpawn,
  type CompilerSpawnSync,
  type Sources,
  type SyncCompilerResult,
  cleanupTempFileSync,
  elmBinaryName,
  getSuffix,
  makeTempOutputPathSync,
  prepareOptions,
  prepareProcessOpts,
  processArgs,
  spawnSyncAsCompilerSpawn,
  startError,
  startErrorMessage,
  systemMessages,
} from './process.ts'

export { CompileError } from './compile-error.ts'
export type { CompilerOptions, CompilerProcessOptions, Sources } from './process.ts'

// The compiler writes a script that assigns to `this.Elm`, which only a CommonJS
// loader runs correctly, so the worker is loaded with `require` and not `import`.
const require = createRequire(import.meta.url)

// Elm itself recognises this output on every system, Windows included, and then writes nothing.
const noOutput = '/dev/null'

// Names that the compiled code can hold besides the modules of the program, left out of the suggestions.
const knownModules = new Set([
  'fullscreen',
  'embed',
  'worker',
  'Basics',
  'Maybe',
  'List',
  'Array',
  'Char',
  'Color',
  'Transform2D',
  'Text',
  'Graphics',
  'Debug',
  'Result',
  'Task',
  'Signal',
  'String',
  'Dict',
  'Json',
  'Regex',
  'VirtualDom',
  'Html',
  'Css',
])

/**
 * A worker that `compileWorker` started, with the ports of its Elm program.
 *
 * @example
 *
 * Listen to a port of the worker
 * ```TypeScript
 *   const worker: WorkerWithPorts = …
 *   (worker.ports.emit as { subscribe: (f: (value: unknown) => void) => void }).subscribe(console.log)
 * ```
 */
export interface WorkerWithPorts {
  ports: Record<string, unknown>
}

/**
 * Builds the arguments that `compile` passes to the `elm` binary, without
 * starting it. It helps to check which flags a set of options produces.
 *
 * @example
 *
 * See the command line for a debug build
 * ```TypeScript
 *   prepareProcessArgs('src/Main.elm', { debug: true, output: 'main.js' })
 *   // Ok ['make', 'src/Main.elm', '--debug', '--output', 'main.js']
 * ```
 *
 * @param sources - one Elm file, or a list of Elm files
 * @param options - the compiler options; options that are not flags add nothing
 * @returns `Ok` the arguments, starting with `make`, or `Err` for an option that
 * this package does not know
 */
export function prepareProcessArgs(sources: Sources, options: CompilerOptions): Result<CompileError, string[]> {
  return processArgs(toList(sources), prepareOptions(options, spawn))
}

/**
 * Starts `elm make` on the given files and returns the running process. Use it
 * when the caller wants the exit code or the streams; use `compileToString` or
 * `dryCompile` when it only wants the outcome.
 *
 * A compiler that cannot start, for example because it is not installed, is
 * known only after this function returns. The process then emits `'error'`,
 * with a message that names the binary, and closes with a non-zero code. The
 * current process does not crash, even when the caller does not listen for
 * errors.
 *
 * @example
 *
 * Build an application and react to its exit code
 * ```TypeScript
 *   compile('src/Main.elm', { output: 'dist/main.js' }).map((compiler) =>
 *     compiler.on('close', (exitCode) => console.log(exitCode === 0 ? 'built' : 'failed'))
 *   )
 * ```
 *
 * @param sources - one Elm file, or a list of Elm files that become one bundle
 * @param options - the flags for `elm make` and the settings of its process
 * @returns `Ok` the compiler process, already running, or `Err` for an option
 * that this package does not know, or for a `spawn` that throws
 */
export function compile(sources: Sources, options: CompilerOptions): Result<CompileError, ChildProcess> {
  const prepared = prepareOptions(options, options.spawn ?? spawn)
  const pathToElm = options.pathToElm || elmBinaryName

  return processArgs(toList(sources), prepared).andThen((args) =>
    Result.fromAttempt(() => {
      if (prepared.verbose) {
        console.log(['Running', pathToElm, ...args].join(' '))
      }

      const compiler = (prepared.spawn as CompilerSpawn)(pathToElm, args, prepareProcessOpts(prepared))

      // A listener stops an error event from crashing the process; the message names the binary.
      return compiler.on('error', (err: unknown) => {
        if (err instanceof Error) {
          systemMessages.set(err, err.message)
          err.message = startErrorMessage(err, pathToElm)
        }
      }) as ChildProcess
    }).mapError((caught) => startError(caught, pathToElm))
  )
}

/**
 * Runs `elm make` and waits for it to exit. Use it in scripts that cannot
 * continue before the build is done, and where blocking the process is fine.
 *
 * @example
 *
 * Fail a build script when the compiler reports an error
 * ```TypeScript
 *   const built = compileSync('src/Main.elm', { output: 'dist/main.js' })
 *   if (built.tag === 'Err') process.exit(1)
 * ```
 *
 * @param sources - one Elm file, or a list of Elm files that become one bundle
 * @param options - the flags for `elm make` and the settings of its process
 * @returns `Ok` the messages of the compiler, empty when they went to the
 * terminal, or `Err` when an option is unknown, the compiler cannot start, or
 * the build fails
 */
export function compileSync(sources: Sources, options: CompilerOptions): Result<CompileError, string> {
  const prepared = prepareOptions(options, options.spawn ?? spawnSyncAsCompilerSpawn)
  const pathToElm = options.pathToElm || elmBinaryName

  return processArgs(toList(sources), prepared).andThen((args) =>
    Result.fromAttempt(() =>
      (prepared.spawn as CompilerSpawnSync)(pathToElm, args, { ...prepareProcessOpts(prepared), encoding: 'utf8' })
    )
      .mapError((caught) => startError(caught, pathToElm))
      .andThen((ran: SyncCompilerResult): Result<CompileError, string> => {
        if (ran.error) {
          return Result.Err(syncRunError(ran.error, pathToElm))
        }

        return outcome(ran.status, String(ran.stdout ?? ''), String(ran.stderr ?? ''), sources)
      })
  )
}

/**
 * Compiles Elm files and returns the generated JavaScript as text. The compiler
 * writes to a temporary directory, which is removed after the file is read.
 *
 * The compiler messages are captured. They are in the error when the build
 * fails, and on the console when `verbose` is set.
 *
 * @example
 *
 * Compile an optimized bundle and write it where the server expects it
 * ```TypeScript
 *   const compiled = await compileToString('src/Main.elm', { optimize: true })
 *   compiled.map((javascript) => writeFileSync('public/main.js', javascript))
 * ```
 *
 * @param sources - one Elm file, or a list of Elm files that become one bundle
 * @param options - the compiler options; `output` only selects the file extension
 * @returns `Ok` the generated JavaScript, or `Err` when an option is unknown, the
 * compiler cannot start, the build fails or its output cannot be read
 */
export async function compileToString(
  sources: Sources,
  options: CompilerOptions
): Promise<Result<CompileError, string>> {
  const temporary = temporaryOutput(getSuffix(options.output, '.js'))

  if (temporary.tag === 'Err') {
    return Result.Err(temporary.error)
  }

  const output = temporary.value

  try {
    const built = await runToTheEnd(sources, { ...options, output })

    if (built.tag === 'Err') {
      return built
    }

    return (await Result.fromPromise(readFile(output, { encoding: 'utf8' }))).mapError((caught): CompileError => {
      return { cause: messageOf(caught), file: output, kind: 'outputNotRead', original: caught }
    })
  } finally {
    cleanupTempFileSync(output)
  }
}

/**
 * Compiles Elm files, waits for the compiler, and returns the generated
 * JavaScript as text. The compiler messages go to the terminal, unless
 * `processOpts.stdio` says otherwise.
 *
 * @example
 *
 * Compile a module inside a synchronous build step
 * ```TypeScript
 *   const compiled = compileToStringSync('src/Main.elm', { optimize: true })
 * ```
 *
 * @param sources - one Elm file, or a list of Elm files that become one bundle
 * @param options - the compiler options; `output` only selects the file extension
 * @returns `Ok` the generated JavaScript, or `Err` as `compileSync` describes, or
 * when the output cannot be read
 */
export function compileToStringSync(sources: Sources, options: CompilerOptions): Result<CompileError, string> {
  return temporaryOutput(getSuffix(options.output, '.js')).andThen((output) => {
    try {
      return compileSync(sources, { ...options, output }).andThen(() =>
        Result.fromAttempt(() => readFileSync(output, { encoding: 'utf8' })).mapError((caught): CompileError => {
          return { cause: messageOf(caught), file: output, kind: 'outputNotRead', original: caught }
        })
      )
    } finally {
      cleanupTempFileSync(output)
    }
  })
}

/**
 * Checks that Elm files compile, without writing any output. Elm still reads
 * the packages and reports every problem, so this is the fastest way to know
 * whether a program builds, for example in a test or a commit hook.
 *
 * @example
 *
 * Check a program before a release
 * ```TypeScript
 *   const checked = await dryCompile('src/Main.elm', { cwd: 'frontend' })
 *
 *   switch (checked.tag) {
 *     case 'Ok':
 *       return console.log('The program compiles.')
 *     case 'Err':
 *       return CliError.print('elm make', CompileError.toCliError(checked.error))
 *   }
 * ```
 *
 * @param sources - one Elm file, or a list of Elm files
 * @param options - the compiler options; `output` and `docs` are ignored, because nothing is written
 * @returns `Ok` when the program compiles, or `Err` when an option is unknown,
 * the compiler cannot start, or the build fails, with the messages of Elm
 */
export async function dryCompile(sources: Sources, options: CompilerOptions): Promise<Result<CompileError, void>> {
  return (await runToTheEnd(sources, { ...options, docs: undefined, output: noOutput })).map(() => undefined)
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
 * @example
 *
 * Start a worker and listen to one of its ports
 * ```TypeScript
 *   const started = await compileWorker('.', 'src/Generator.elm', 'Generator', { flags: { seed: 42 } })
 * ```
 *
 * @param projectRootDir - the directory that contains `elm.json`
 * @param modulePath - the Elm file to compile
 * @param moduleName - the module to start, as Elm names it, for example `Generator`
 * @param workerArgs - the argument of `init`, as Elm expects it: `{ flags: ... }`, or
 * `undefined` for a program without flags
 * @returns `Ok` the running worker, with its ports, or `Err` when the build
 * fails, when `moduleName` is not in the output, when its `init` throws, or
 * when the module has no ports
 */
export async function compileWorker(
  projectRootDir: string,
  modulePath: string,
  moduleName: string,
  workerArgs: unknown
): Promise<Result<CompileError, WorkerWithPorts>> {
  const temporary = (await Result.fromPromise(mkdtemp(path.join(tmpdir(), 'node-elm-compiler-')))).mapError(
    (caught): CompileError => {
      return { cause: messageOf(caught), folder: tmpdir(), kind: 'tempFolderNotCreated', original: caught }
    }
  )

  if (temporary.tag === 'Err') {
    return Result.Err(temporary.error)
  }

  const output = path.join(temporary.value, 'emitter.js')

  try {
    const built = await runToTheEnd(modulePath, { cwd: projectRootDir, output })

    return built.andThen(() => startWorker(output, modulePath, moduleName, workerArgs))
  } finally {
    await rm(temporary.value, { force: true, recursive: true })
  }
}

/**
 * Lists every local file that an Elm module imports, directly or through other
 * modules. A bundler in watch mode needs this list, because `elm make` rebuilds
 * from the entry file and does not report which files it read.
 *
 * @example
 *
 * Find what a page depends on
 * ```TypeScript
 *   await findAllDependencies('/app/src/Page/Home.elm')
 *   // Ok ['/app/src/Api.elm', '/app/src/Ui/Button.elm']
 * ```
 *
 * @param file - the absolute path of the Elm module to start from
 * @param knownDependencies - dependencies found earlier, which are kept in the result
 * @param sourceDirectories - the absolute source directories; when absent they come from `elm.json`
 * @param knownFiles - files already visited, which are not read again
 * @returns `Ok` the absolute paths of the dependencies, or `Err` when the entry
 * file cannot be read or is not an Elm module
 */
export async function findAllDependencies(
  file: string,
  knownDependencies: ReadonlyArray<string> = [],
  sourceDirectories?: ReadonlyArray<string>,
  knownFiles: ReadonlyArray<string> = []
): Promise<Result<CompileError, ReadonlyArray<string>>> {
  return await findDependencies(file, knownDependencies, sourceDirectories, knownFiles)
}

/**
 * Turns the sources into a list.
 *
 * @param sources - one file or a list of files
 * @returns the list
 */
function toList(sources: Sources): ReadonlyArray<string> {
  return typeof sources === 'string' ? [sources] : sources
}

/**
 * Runs the compiler with its messages captured, and waits for it to close. The
 * promise never rejects: every failure becomes an `Err`.
 *
 * @param sources - the Elm files
 * @param options - the compiler options, with the output to write
 * @returns `Ok` the messages of the compiler, or `Err` when an option is
 * unknown, the compiler cannot start or is stopped, or the build fails
 */
async function runToTheEnd(sources: Sources, options: CompilerOptions): Promise<Result<CompileError, string>> {
  const pathToElm = options.pathToElm || elmBinaryName
  const started = compile(sources, { ...options, processOpts: { ...options.processOpts, stdio: 'pipe' } })

  if (started.tag === 'Err') {
    return Result.Err(started.error)
  }

  const finished = await new Promise<{
    exitCode: number | null
    signal: string | null
    startFailure?: unknown
    stderr: string
    stdout: string
  }>((resolve) => {
    const compiler: CompilerProcessLike = started.value
    const stdout = collectText(compiler.stdout)
    const stderr = collectText(compiler.stderr)
    let startFailure: unknown

    compiler.on('error', (err: unknown) => {
      startFailure = err
    })
    compiler.on('close', (exitCode: unknown, signal: unknown) => {
      resolve({
        exitCode: typeof exitCode === 'number' ? exitCode : null,
        signal: typeof signal === 'string' ? signal : null,
        startFailure,
        stderr: stderr(),
        stdout: stdout(),
      })
    })
  })

  if (options.verbose) {
    console.log([asTerminalShows(finished.stdout), finished.stderr].join('\n').trim())
  }

  if (finished.startFailure !== undefined) {
    return Result.Err(startError(finished.startFailure, pathToElm))
  }

  if (finished.exitCode === null && finished.signal !== null) {
    return Result.Err(stoppedBySignal(finished.signal, options.processOpts, pathToElm))
  }

  return outcome(finished.exitCode, finished.stdout, finished.stderr, sources)
}

/**
 * Collects what a stream of the compiler writes, as UTF-8 text.
 *
 * @param stream - stdout or stderr of the compiler, absent when it is not piped
 * @returns a function that gives the text written so far
 */
function collectText(stream: NodeJS.ReadableStream | null | undefined): () => string {
  // One decoder for the whole stream: a character of several bytes can fall across two chunks.
  const decoder = new StringDecoder('utf8')
  let text = ''

  stream?.on('data', (chunk: string | Buffer) => {
    text += typeof chunk === 'string' ? chunk : decoder.write(chunk)
  })

  return () => text + decoder.end()
}

/**
 * Describes the error that `spawnSync` returned. It sets that error also after
 * the compiler started, when the system stopped it at a limit of the options.
 *
 * @param err - the error of the run
 * @param pathToElm - the binary that was started
 * @returns a stopped compiler for a timeout or a full buffer, and a compiler
 * that did not start for anything else
 */
function syncRunError(err: Error, pathToElm: string): CompileError {
  const code = 'code' in err ? err.code : undefined

  switch (code) {
    case 'ETIMEDOUT':
      return { cause: err.message, kind: 'compilerStopped', original: err, pathToElm, reason: 'timeout' }
    case 'ENOBUFS':
      return { cause: err.message, kind: 'compilerStopped', original: err, pathToElm, reason: 'maxBuffer' }

    default:
      return startError(err, pathToElm)
  }
}

/**
 * Describes a compiler that a signal stopped while it ran.
 *
 * @param signal - the name of the signal, such as SIGTERM
 * @param processOpts - the options of the process, which may set a timeout
 * @param pathToElm - the binary that was started
 * @returns a stopped compiler, with `timeout` as the reason when the signal is the one of the timeout
 */
function stoppedBySignal(signal: string, processOpts: CompilerOptions['processOpts'], pathToElm: string): CompileError {
  // At the timeout Node sends killSignal, and reports only the signal, as for any other stop.
  const timedOut = (processOpts?.timeout ?? 0) > 0 && signal === String(processOpts?.killSignal ?? 'SIGTERM')

  return {
    cause: signal,
    kind: 'compilerStopped',
    original: signal,
    pathToElm,
    reason: timedOut ? 'timeout' : 'signal',
  }
}

/**
 * Turns the end of a compiler run into a result.
 *
 * Elm writes its progress to stdout and its problems to stderr. A failed build
 * keeps only the problems, so that the downloads and the progress of a first
 * build do not hide them.
 *
 * @param exitCode - the exit code of the compiler
 * @param stdout - what the compiler wrote to stdout
 * @param stderr - what the compiler wrote to stderr
 * @param sources - the Elm files, for the error
 * @returns `Ok` the messages of stdout, or `Err` with the problems of stderr
 */
function outcome(
  exitCode: number | null,
  stdout: string,
  stderr: string,
  sources: Sources
): Result<CompileError, string> {
  const messages = asTerminalShows(stdout)

  return exitCode === 0
    ? Result.Ok(messages)
    : Result.Err({
        exitCode,
        kind: 'compileFailed',
        output: stderr.trim() === '' ? messages : stderr,
        sources: toList(sources),
      })
}

/**
 * Turns the progress output of Elm into the text that a terminal shows.
 *
 * @param stdout - what the compiler wrote to stdout
 * @returns the lines as a terminal shows them, without the progress line
 */
function asTerminalShows(stdout: string): string {
  // Elm rewrites a progress line with a carriage return, so a terminal shows only its last part.
  // `Compiling ...` stays alone when nothing follows it, and says nothing to the caller.
  return stdout
    .split('\n')
    .map((line) => line.slice(line.lastIndexOf('\r') + 1).trimEnd())
    .filter((line) => line !== 'Compiling ...')
    .join('\n')
}

/**
 * Makes a temporary folder for an output file.
 *
 * @param suffix - the extension of the file
 * @returns `Ok` the path of the file, or `Err` when the folder cannot be created
 */
function temporaryOutput(suffix: string): Result<CompileError, string> {
  return Result.fromAttempt(() => makeTempOutputPathSync(suffix)).mapError((caught): CompileError => {
    return { cause: messageOf(caught), folder: tmpdir(), kind: 'tempFolderNotCreated', original: caught }
  })
}

/**
 * Takes the message of a caught value.
 *
 * @param caught - an exception, of any type
 * @returns its message
 */
function messageOf(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught)
}

/**
 * Loads the compiled program and starts the module as a worker.
 *
 * @param file - the compiled JavaScript
 * @param modulePath - the Elm file that was compiled, for the error message
 * @param moduleName - the module to start
 * @param workerArgs - the argument of `init`
 * @returns `Ok` the worker, or `Err` when the file cannot be loaded, the module
 * is not in it, its `init` throws, for example for flags of the wrong type, or
 * it has no ports
 */
function startWorker(
  file: string,
  modulePath: string,
  moduleName: string,
  workerArgs: unknown
): Result<CompileError, WorkerWithPorts> {
  return Result.fromAttempt(
    () => (require(file) as { Elm: Record<string, { init(args?: unknown): Partial<WorkerWithPorts> }> }).Elm
  )
    .mapError((caught): CompileError => {
      return { cause: messageOf(caught), file, kind: 'outputNotRead', original: caught }
    })
    .andThen((elm): Result<CompileError, WorkerWithPorts> => {
      const module_ = elm[moduleName]

      if (module_ === undefined) {
        return Result.Err({
          file: modulePath,
          kind: 'moduleNotFound',
          moduleName,
          suggestions: Object.keys(elm).filter((name) => !knownModules.has(name)),
        })
      }

      return Result.fromAttempt(() => module_.init(workerArgs))
        .mapError((caught): CompileError => {
          return { cause: messageOf(caught), file: modulePath, kind: 'workerNotStarted', moduleName, original: caught }
        })
        .andThen((worker): Result<CompileError, WorkerWithPorts> =>
          // Elm leaves `ports` out entirely when a module declares none.
          worker.ports && Object.keys(worker.ports).length > 0
            ? Result.Ok({ ...worker, ports: worker.ports })
            : Result.Err({ file: modulePath, kind: 'noPorts', moduleName })
        )
    })
}
