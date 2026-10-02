/**
 * Runs the Elm compiler from Node. This is a fork of the `node-elm-compiler` npm
 * package, rewritten in TypeScript with no runtime dependencies. The API is the
 * same, so code written for the original works with it.
 *
 * Every function here is a wrapper around one `elm make` call. The option bag
 * becomes command line flags, and the compiler runs as a child process. Start
 * with `compile`, which returns that process. `compileToString` builds on it and
 * returns the generated JavaScript instead. The `Sync` variants block until the
 * compiler exits.
 *
 * `findAllDependencies` answers a question that `elm make` does not: which local
 * files an Elm module imports, directly or through other modules. A bundler in
 * watch mode needs that list to know which changes require a new build.
 *
 * `compileWorker` compiles a headless Elm program and starts it in this process,
 * for tools that talk to Elm code through ports.
 *
 * @packageDocumentation
 */

import { type ChildProcess, type SpawnOptions, type SpawnSyncReturns, spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import * as process from 'node:process'
import { findAllDependencies } from './find-elm-dependencies.ts'

// The compiler writes a script that assigns to `this.Elm`, which only a CommonJS
// loader runs correctly, so the worker is loaded with `require` and not `import`.
const require = createRequire(import.meta.url)

const elmBinaryName = 'elm'
const jsEmitterFilename = 'emitter.js'
const knownModules = [
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
] as const

type Sources = unknown

type SyncCompilerResult = SpawnSyncReturns<string | Buffer>

interface CompilerProcessLike {
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

interface CompilerSyncProcessOptions extends CompilerProcessOptions {
  encoding?: BufferEncoding
}

type CompilerSpawn = (command: string, args: string[], options: CompilerProcessOptions) => CompilerProcessLike

type CompilerSpawnSync = (command: string, args: string[], options: CompilerSyncProcessOptions) => SyncCompilerResult

/**
 * Describes one compiler run. The flag options (`debug`, `docs`, `help`,
 * `optimize`, `output`, `report`, `runtimeOptions`) become `elm make` flags. The
 * rest decide how the process starts: which binary, which directory, which
 * environment.
 *
 * An option that this list does not name raises an error, so a misspelled flag
 * fails at once instead of being ignored. `yes`, `warn` and `pathToMake` were
 * removed in Elm 0.19, and their errors say what to use instead.
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
  spawn,
  verbose: false,
}

const supportedOptions = Object.keys(defaultOptions)

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
export function compile(sources: Sources, options: CompilerOptions): ChildProcess {
  const optionsWithDefaults = prepareOptions(options, options.spawn || spawn)
  const pathToElm = options.pathToElm || elmBinaryName

  try {
    const compilerProcess = runCompiler(sources, optionsWithDefaults, pathToElm) as CompilerProcessLike

    // A binary that cannot start is reported after this function returns, so throwing here would
    // crash the caller. The process still closes with a non-zero code, which reports the failure.
    return compilerProcess.on('error', (err: unknown) => {
      if (err instanceof Error) {
        err.message = compilerErrorToString(err, pathToElm)
      }
    }) as ChildProcess
  } catch (err: unknown) {
    throw compilerErrorToString(err, pathToElm)
  }
}

/**
 * Runs `elm make` and waits for it to exit. Use it in scripts that cannot
 * continue before the build is done, and where blocking the process is fine.
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
export function compileSync(sources: Sources, options: CompilerOptions): SyncCompilerResult {
  const optionsWithDefaults = prepareOptions(options, options.spawn || spawnSyncAsCompilerSpawn)
  const pathToElm = options.pathToElm || elmBinaryName

  try {
    return runCompiler(sources, optionsWithDefaults, pathToElm) as SyncCompilerResult
  } catch (err: unknown) {
    throw compilerErrorToString(err, pathToElm)
  }
}

/**
 * Compiles Elm files and returns the generated JavaScript as text. The compiler
 * writes to a temporary directory, which is removed after the file is read.
 *
 * The compiler messages are captured. They appear in the error when the build
 * fails, and on the console when `verbose` is set.
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
export async function compileToString(sources: Sources, options: CompilerOptions): Promise<string> {
  const suffix = getSuffix(options.output, '.js')
  const tempFilePath = makeTempOutputPathSync(suffix)

  const compiler = compile(sources, {
    ...options,
    output: tempFilePath,
    processOpts: { stdio: 'pipe' },
  })

  assertReadableStream(compiler.stdout)
  assertReadableStream(compiler.stderr)

  compiler.stdout.setEncoding('utf8')
  compiler.stderr.setEncoding('utf8')

  const output = await collectCompilerOutput(compiler)

  if (options.verbose) {
    console.log(output)
  }

  try {
    return await readFile(tempFilePath, { encoding: 'utf8' })
  } finally {
    await cleanupTempFile(tempFilePath)
  }
}

/**
 * Compiles Elm files, waits for the compiler, and returns the generated
 * JavaScript as text. The compiler messages go to the terminal.
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
export function compileToStringSync(sources: Sources, options: CompilerOptions): string {
  const suffix = getSuffix(options.output, '.js')
  const tempFilePath = makeTempOutputPathSync(suffix)

  try {
    const compileProcess = compileSync(sources, { ...options, output: tempFilePath })

    if (compileProcess.status === 0) {
      return readFileSync(tempFilePath, { encoding: 'utf8' })
    }

    throw 'Compilation failed.'
  } finally {
    cleanupTempFileSync(tempFilePath)
  }
}

/**
 * Compiles a headless Elm program and starts it inside the current process.
 * Use it for build steps and command line tools written in Elm, which exchange
 * data with Node through ports.
 *
 * The process changes its working directory to `projectRootDir` during the
 * compilation, so `elm.json` is found there, and returns to the original
 * directory afterwards.
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
export const compileWorker = makeCompileWorker(compile)

/**
 * Returns the arguments that `compile` would pass to the `elm` binary, without
 * starting it. It exists because `node-elm-compiler` exported it, and it helps
 * to check which flags a set of options produces.
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
export function _prepareProcessArgs(sources: Sources, options: CompilerOptions): string[] {
  return prepareProcessArgs(sources, options)
}

export { findAllDependencies }

interface ElmModuleRuntime {
  init(options?: unknown): Partial<WorkerWithPorts>
}

interface ElmRuntime {
  Elm: Record<string, ElmModuleRuntime>
}

interface WorkerWithPorts {
  ports: Record<string, unknown>
}

/**
 * Normalize the `sources` argument.
 *
 * @param sources - Elm source file or files
 * @returns Sources as an array
 * @throws When sources is neither a string nor an array
 */
function prepareSources(sources: Sources): string[] {
  if (Array.isArray(sources)) {
    return [...sources].map(String)
  }

  if (typeof sources === 'string') {
    return [sources]
  }

  throw 'compile() received neither an Array nor a String for its sources argument.'
}

/**
 * Apply upstream default semantics without overwriting already defined keys.
 *
 * @param options - caller options
 * @param spawnFn - spawn function to pin into the final option bag
 * @returns Prepared options object
 */
function prepareOptions(options: CompilerOptions, spawnFn: CompilerSpawn | CompilerSpawnSync): CompilerOptions {
  const destination: CompilerOptions = { spawn: spawnFn }

  return applyDefaults(destination, options, defaultOptions)
}

/**
 * Build the final `elm make` process arguments.
 *
 * @param sources - Elm source file or files
 * @param options - compiler options
 * @returns The final CLI argument list
 */
function prepareProcessArgs(sources: Sources, options: CompilerOptions): string[] {
  const preparedSources = prepareSources(sources)
  const compilerArgs = compilerArgsFromOptions(options)

  return ['make', ...preparedSources, ...compilerArgs]
}

/**
 * Build the process options passed to spawn/spawnSync.
 *
 * @param options - compiler options
 * @returns Prepared process options
 */
function prepareProcessOpts(options: CompilerOptions): CompilerProcessOptions {
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
 * Execute the configured compiler process.
 *
 * @param sources - Elm source file or files
 * @param options - compiler options with defaults applied
 * @param pathToElm - executable to invoke
 * @returns The underlying process result
 * @throws When options.spawn is not a function
 */
function runCompiler(
  sources: Sources,
  options: CompilerOptions,
  pathToElm: string
): CompilerProcessLike | SyncCompilerResult {
  if (typeof options.spawn !== 'function') {
    throw `options.spawn was a(n) ${typeof options.spawn} instead of a function.`
  }

  const processArgs = prepareProcessArgs(sources, options)
  const processOpts = prepareProcessOpts(options)

  if (options.verbose) {
    console.log(['Running', pathToElm, ...processArgs].join(' '))
  }

  return options.spawn(pathToElm, processArgs, processOpts)
}

/**
 * Convert compiler startup errors into the legacy string format.
 *
 * @param err - startup error
 * @param pathToElm - executable that was being launched
 * @returns Legacy stringified error message
 */
function compilerErrorToString(err: unknown, pathToElm: string): string {
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
 * Compute the temp file suffix to use for string output compilation.
 *
 * @param outputPath - optional requested output path
 * @param defaultSuffix - fallback extension
 * @returns The chosen file suffix
 */
function getSuffix(outputPath: string | undefined, defaultSuffix: string): string {
  if (outputPath) {
    return path.extname(outputPath) || defaultSuffix
  }

  return defaultSuffix
}

/**
 * Convert an options bag into elm CLI flags.
 *
 * @param options - compiler options
 * @returns Elm CLI flags
 */
function compilerArgsFromOptions(options: CompilerOptions): string[] {
  return Object.entries(options).flatMap(([opt, value]): string[] => {
    if (!value) {
      return []
    }

    switch (opt) {
      case 'debug':
        return ['--debug']
      case 'docs':
        return ['--docs', String(value)]
      case 'help':
        return ['--help']
      case 'optimize':
        return ['--optimize']
      case 'output':
        return ['--output', String(value)]
      case 'report':
        return ['--report', String(value)]
      case 'runtimeOptions':
        return ['+RTS', ...(value as ReadonlyArray<string>), '-RTS']

      default:
        if (supportedOptions.includes(opt)) {
          return []
        }

        if (opt === 'yes') {
          throw new Error(
            'node-elm-compiler received the `yes` option, but that was removed in Elm 0.19. Try re-running without passing the `yes` option.'
          )
        }

        if (opt === 'warn') {
          throw new Error(
            'node-elm-compiler received the `warn` option, but that was removed in Elm 0.19. Try re-running without passing the `warn` option.'
          )
        }

        if (opt === 'pathToMake') {
          throw new Error(
            'node-elm-compiler received the `pathToMake` option, but that was renamed to `pathToElm` in Elm 0.19. Try re-running after renaming the parameter to `pathToElm`.'
          )
        }

        throw new Error(`node-elm-compiler was given an unrecognized Elm compiler option: ${opt}`)
    }
  })
}

/**
 * Create the exported compileWorker function.
 *
 * @param compileFn - compile implementation to use
 * @returns Worker compiler function
 */
function makeCompileWorker(
  compileFn: (sources: Sources, options: CompilerOptions) => ChildProcess
): (projectRootDir: string, modulePath: string, moduleName: string, workerArgs: unknown) => Promise<WorkerWithPorts> {
  return async function compiledWorker(
    projectRootDir: string,
    modulePath: string,
    moduleName: string,
    workerArgs: unknown
  ): Promise<WorkerWithPorts> {
    const originalWorkingDir = process.cwd()
    process.chdir(projectRootDir)

    try {
      const tmpDirPath = await createTmpDir()
      const destination = path.join(tmpDirPath, jsEmitterFilename)

      await compileEmitter(compileFn, modulePath, { output: destination })

      return await runWorker(destination, moduleName, workerArgs)
    } catch (err: unknown) {
      const wrappedError = new Error(String(err))
      ;(wrappedError as Error & { cause?: unknown }).cause = err

      throw wrappedError
    } finally {
      process.chdir(originalWorkingDir)
    }
  }
}

/**
 * Create a temporary directory for worker compilation.
 *
 * @returns The temporary directory path
 */
async function createTmpDir(): Promise<string> {
  return await mkdtemp(path.join(tmpdir(), 'node-elm-compiler-'))
}

/**
 * Suggest probable entry module names.
 *
 * @param elm - compiled Elm namespace object
 * @returns Suggested module names
 */
function suggestModulesNames(elm: Record<string, unknown>): string[] {
  return Object.keys(elm).filter((key): boolean => !knownModules.includes(key as (typeof knownModules)[number]))
}

/**
 * Build the legacy missing-entry-module message.
 *
 * @param moduleName - requested module
 * @param elm - compiled Elm namespace object
 * @returns Error message
 */
function missingEntryModuleMessage(moduleName: string, elm: Record<string, unknown>): string {
  let errorMessage = `I couldn't find the entry module ${moduleName}.\n`
  const suggestions = suggestModulesNames(elm)

  if (suggestions.length > 1) {
    errorMessage += `\nMaybe you meant one of these: ${suggestions.join(',')}`
  } else if (suggestions.length === 1) {
    errorMessage += `\nMaybe you meant: ${suggestions}`
  }

  errorMessage += '\nYou can pass me a different module to use with --module=<moduleName>'

  return errorMessage
}

/**
 * Build the legacy no-ports message.
 *
 * @param moduleName - requested module
 * @returns Error message
 */
function noPortsMessage(moduleName: string): string {
  let errorMessage = `The module ${moduleName} doesn't expose any ports!\n`
  errorMessage += '\n\nTry adding something like'
  errorMessage += `port foo : Value\nport foo =\n    someValue\n\nto ${moduleName}!`

  return errorMessage.trim()
}

/**
 * Load the compiled worker module and initialize it.
 *
 * @param jsFilename - generated JS file path
 * @param moduleName - Elm module name to initialize
 * @param workerArgs - arguments forwarded to `init`
 * @returns Initialized worker with ports
 */
async function runWorker(jsFilename: string, moduleName: string, workerArgs: unknown): Promise<WorkerWithPorts> {
  const runtime = require(jsFilename) as ElmRuntime
  const elm = runtime.Elm

  if (!(moduleName in elm)) {
    throw missingEntryModuleMessage(moduleName, elm)
  }

  const worker = elm[moduleName].init(workerArgs)

  // Elm leaves `ports` out entirely when a module declares none.
  if (!worker.ports || Object.keys(worker.ports).length === 0) {
    throw noPortsMessage(moduleName)
  }

  return { ...worker, ports: worker.ports }
}

/**
 * Compile the emitter JS used by compileWorker.
 *
 * @param compileFn - compile implementation to use
 * @param src - Elm source file
 * @param options - compiler options
 * @returns Close exit code on success
 */
function compileEmitter(
  compileFn: (sources: Sources, options: CompilerOptions) => ChildProcess,
  src: string,
  options: CompilerOptions
): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    compileFn(src, options).on('close', (exitCode: unknown) => {
      if (exitCode === 0) {
        resolve(0)

        return
      }

      reject(`Errored with exit code ${String(exitCode)}`)
    })
  })
}

/**
 * Collect compiler stdout/stderr and reject on non-zero exit.
 *
 * @param compiler - spawned compiler process
 * @returns Collected text output
 */
function collectCompilerOutput(compiler: ChildProcess): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let output = ''

    compiler.stdout?.on('data', (chunk: string | Buffer) => {
      output += chunk.toString()
    })

    compiler.stderr?.on('data', (chunk: string | Buffer) => {
      output += chunk.toString()
    })

    // A compiler that never started prints nothing, so its start error is the only explanation.
    compiler.on('error', (err: unknown) => {
      output += err instanceof Error ? err.message : String(err)
    })

    compiler.on('close', (exitCode: unknown) => {
      if (exitCode !== 0) {
        reject(new Error(`Compilation failed\n${output}`))

        return
      }

      resolve(output)
    })
  })
}

/**
 * Ensure a compiler stream exists before using it.
 *
 * @param stream - compiler stdio stream
 * @throws When the compiler stdio stream is unavailable
 */
function assertReadableStream(
  stream: NodeJS.ReadableStream | null | undefined
): asserts stream is NodeJS.ReadableStream & {
  setEncoding(encoding: BufferEncoding): NodeJS.ReadableStream
} {
  if (!stream || typeof stream.setEncoding !== 'function') {
    throw new Error('Compilation output streams are not available.')
  }
}

/**
 * Create a unique temp output path synchronously.
 *
 * @param suffix - file suffix to use
 * @returns The temp file path
 */
function makeTempOutputPathSync(suffix: string): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'node-elm-compiler-'))

  return path.join(directory, `elm-output${suffix}`)
}

/**
 * Remove a temp file and its parent directory asynchronously.
 *
 * @param filePath - file path to clean up
 */
async function cleanupTempFile(filePath: string): Promise<void> {
  await rm(path.dirname(filePath), { force: true, recursive: true })
}

/**
 * Remove a temp file and its parent directory synchronously via fire-and-forget.
 *
 * @param filePath - file path to clean up
 */
function cleanupTempFileSync(filePath: string): void {
  rm(path.dirname(filePath), { force: true, recursive: true }).catch((): void => undefined)
}

/**
 * Provide a sync-spawn adapter that matches the configurable `spawn` option shape.
 *
 * @param command - executable to launch
 * @param args - CLI arguments
 * @param options - process options
 * @returns Synchronous spawn result
 */
function spawnSyncAsCompilerSpawn(
  command: string,
  args: string[],
  options: CompilerSyncProcessOptions
): SyncCompilerResult {
  return spawnSync(command, args, options)
}

/**
 * Apply lodash-like defaults semantics.
 *
 * @param destination - object to enrich
 * @param sources - sources to read defaults from
 * @returns The destination object
 */
function applyDefaults<T extends Record<string, unknown>>(
  destination: T,
  ...sources: ReadonlyArray<Partial<T> | undefined>
): T {
  for (const source of sources) {
    if (!source) {
      continue
    }

    for (const key of Object.keys(source) as Array<keyof T>) {
      if (destination[key] === undefined) {
        destination[key] = source[key] as T[keyof T]
      }
    }
  }

  return destination
}
