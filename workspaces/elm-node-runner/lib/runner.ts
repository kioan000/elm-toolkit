/**
 * Runs Elm programs inside the current Node process.
 *
 * A run has two steps. `compileProgram` compiles the Elm files and loads them,
 * which gives the `Elm` object. Then `startProgram` starts it: `startMain`
 * starts `Main` with the `log` and `eval` ports, or a launcher receives the
 * `Elm` object and starts what it wants. `runElm` does both steps. A failure is
 * a `RunnerError`.
 *
 * @packageDocumentation
 */

import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { Result } from '@elm-toolkit/cli-lib'
import { compileRunnableProgram } from '@elm-toolkit/node-elm-compiler/result-api'

import type { RunnerError } from './runner-error.ts'

export { RunnerError } from './runner-error.ts'

/**
 * One port of a running program. A port from Elm has `subscribe`, a port to Elm
 * has `send`.
 *
 * @example
 *
 * Print what Elm sends
 * ```TypeScript
 *   app.ports?.log?.subscribe?.((message) => console.log(message))
 * ```
 */
export type ElmPort = {
  send?(value: unknown): void
  subscribe?(listener: (value: unknown) => void): void
}

/**
 * A running program. `ports` is missing when the program declares none.
 *
 * @example
 *
 * Send a value to Elm
 * ```TypeScript
 *   app.ports?.input?.send?.(42)
 * ```
 */
export type ElmApp = {
  ports?: Record<string, ElmPort>
}

/**
 * The `Elm` object: one entry for each compiled module, with the `init` that
 * starts it.
 *
 * A module with a dot in its name is nested: `Page.Home` is `Elm.Page?.Home`.
 * A missing module is `undefined`.
 *
 * @example
 *
 * Start `Main` with flags
 * ```TypeScript
 *   Elm.Main?.init({ flags: { name: 'Ada' } })
 * ```
 */
export type ElmNamespace = Readonly<Record<string, { init(options?: { flags?: unknown }): ElmApp } | undefined>>

/**
 * The settings of one run of `runElm`.
 *
 * @example
 *
 * An optimized build started by a launcher
 * ```TypeScript
 *   const options: RunOptions = { elmFiles: ['src/Main.elm'], launcher: 'src/main.ts', optimize: true }
 * ```
 */
export type RunOptions = {
  /** The Elm files to compile into one `Elm` object. */
  elmFiles: string[]
  /** A module whose default export receives the `Elm` object. Without it, `Main` starts. */
  launcher?: string
  /** Builds with `--optimize`. */
  optimize?: boolean
  /** Prints the compiler command, and the messages of Elm. */
  verbose?: boolean
}

/**
 * Compiles Elm files and loads them, without starting any module. Elm runs in
 * the current directory, so `elm.json` must be there or in a parent.
 *
 * @example
 *
 * See which modules a build has
 * ```TypeScript
 *   (await compileProgram(['src/Main.elm', 'src/Report.elm'])).map(Object.keys)
 *   // Ok ['Main', 'Report']
 * ```
 *
 * @param elmFiles - the Elm files of the program
 * @param options - `optimize` and `verbose`, as in `RunOptions`
 * @returns `Ok` the `Elm` object, or `Err` `BuildFailed` or `ProgramNotLoaded`
 */
export async function compileProgram(
  elmFiles: string[],
  options: Pick<RunOptions, 'optimize' | 'verbose'> = {}
): Promise<Result<RunnerError, ElmNamespace>> {
  const compiled = await compileRunnableProgram(elmFiles, { optimize: options.optimize, verbose: options.verbose })

  return compiled
    .mapError((compileError): RunnerError => {
      return { compileError, type_: 'BuildFailed' }
    })
    .andThen((program) =>
      program.load().mapError((loadError): RunnerError => {
        return { loadError, type_: 'ProgramNotLoaded' }
      })
    )
    .map((Elm) => Elm as ElmNamespace)
}

/**
 * Starts `Main` the way `elm-node` does. The `log` port prints to the console.
 * The `eval` port runs JavaScript, which reaches the program as the global
 * `app`.
 *
 * @example
 *
 * Start Main and send it a value
 * ```TypeScript
 *   startMain(Elm).map((app) => app.ports?.input?.send?.('hello'))
 * ```
 *
 * @param Elm - the object that `compileProgram` returned
 * @returns `Ok` the running program, or `Err` `NoMain` or `MainNotStarted`
 */
export function startMain(Elm: ElmNamespace): Result<RunnerError, ElmApp> {
  const main = Elm.Main

  // A module such as Main.Report creates an entry Main without init.
  if (typeof main?.init !== 'function') {
    return Result.Err({ modules: moduleNames(Elm, ''), type_: 'NoMain' })
  }

  return Result.fromAttempt(() => main.init())
    .mapError((caught): RunnerError => {
      return { cause: messageOf(caught), original: caught, type_: 'MainNotStarted' }
    })
    .map((app) => {
      Object.assign(globalThis, { app })
      app.ports?.log?.subscribe?.((message) => console.log(message))
      // Indirect eval runs the code in the global scope, where it can reach `app`.
      app.ports?.eval?.subscribe?.((code) => globalThis.eval(String(code)))

      return app
    })
}

/**
 * Compiles and starts a program, as the `elm-node-runner` command does.
 *
 * A launcher is a module whose default export receives the `Elm` object. Node
 * runs it as it is, so a TypeScript launcher uses only syntax that Node can
 * strip, and lives outside `node_modules`.
 *
 * @example
 *
 * Run a program through a launcher, and print a failure
 * ```TypeScript
 *   const runElmResult = await runElm({ elmFiles: ['src/Main.elm'], launcher: 'src/main.ts' })
 *
 *   if (runElmResult.type_ === 'Err') {
 *     CliError.print(RunnerError.title(runElmResult.error), RunnerError.toCliError(runElmResult.error))
 *   }
 * ```
 *
 * @param options - the files, the launcher and the build settings
 * @returns `Ok` once the program has started, or `Err` with what went wrong
 */
export async function runElm(options: RunOptions): Promise<Result<RunnerError, void>> {
  const compiled = await compileProgram(options.elmFiles, options)

  return compiled.type_ === 'Err' ? Result.Err(compiled.error) : await startProgram(compiled.value, options.launcher)
}

/**
 * Starts a compiled program: with the launcher when there is one, otherwise
 * with `startMain`. Use it to do something between the build and the start,
 * as the command does when it reports the build.
 *
 * @example
 *
 * Report the build, then start the program
 * ```TypeScript
 *   const compileProgramResult = await compileProgram(['src/Main.elm'])
 *
 *   if (compileProgramResult.type_ === 'Ok') {
 *     console.log('Built.')
 *     await startProgram(compileProgramResult.value, 'src/main.ts')
 *   }
 * ```
 *
 * @param Elm - the object that `compileProgram` returned
 * @param launcher - the path of the launcher, or `undefined` to start `Main`
 * @returns `Ok` once the program has started, or `Err` with what went wrong
 */
export async function startProgram(
  Elm: ElmNamespace,
  launcher: string | undefined
): Promise<Result<RunnerError, void>> {
  return launcher === undefined ? startMain(Elm).map(() => undefined) : await startLauncher(launcher, Elm)
}

/**
 * Imports a launcher and calls its default export with the `Elm` object.
 *
 * @param launcher - the path of the launcher
 * @param Elm - the `Elm` object
 * @returns `Ok` once the launcher has finished, or `Err` with what went wrong
 */
async function startLauncher(launcher: string, Elm: ElmNamespace): Promise<Result<RunnerError, void>> {
  const imported = (
    await Result.fromPromise(import(pathToFileURL(path.resolve(launcher)).href) as Promise<{ default?: unknown }>)
  ).mapError((caught): RunnerError => {
    return { cause: messageOf(caught), launcher, original: caught, type_: 'LauncherNotLoaded' }
  })

  if (imported.type_ === 'Err') {
    return Result.Err(imported.error)
  }

  const start = imported.value.default

  if (typeof start !== 'function') {
    return Result.Err({ launcher, type_: 'LauncherNotAFunction' })
  }

  // Promise.resolve().then turns a throw of the launcher into a rejection, as for an async launcher.
  const started = await Result.fromPromise(Promise.resolve().then(() => (start as (Elm: ElmNamespace) => unknown)(Elm)))

  return started
    .mapError((caught): RunnerError => {
      return { cause: messageOf(caught), launcher, original: caught, type_: 'LauncherFailed' }
    })
    .map(() => undefined)
}

/**
 * Lists the modules that have `init`, with full names such as `Tools.Echo`.
 *
 * @param namespace - the `Elm` object, or a nested part of it
 * @param prefix - the name of that part with a final dot, or `''`
 * @returns the full names
 */
function moduleNames(namespace: object, prefix: string): string[] {
  return Object.entries(namespace).flatMap(([name, entry]: [string, unknown]) => {
    if (typeof entry !== 'object' || entry === null) {
      return []
    }

    const nested = moduleNames(entry, `${prefix}${name}.`)

    return 'init' in entry && typeof entry.init === 'function' ? [`${prefix}${name}`, ...nested] : nested
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
