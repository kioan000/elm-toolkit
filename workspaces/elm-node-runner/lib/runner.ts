/**
 * Compiles Elm modules and runs them inside the current Node process.
 *
 * A run has two steps. `compileProgram` builds the modules with
 * `@elm-toolkit/node-elm-compiler` into a temporary directory, loads the result,
 * and removes the directory again; what remains is the `Elm` object that the
 * compiler exports. Then the program starts in one of two ways. Without a
 * launcher, `startMain` starts the module called `Main` and connects two ports,
 * `log` and `eval`. With a launcher, the `Elm` object goes to a function that the
 * caller writes, which can start any module and connect any port.
 *
 * `runElm` puts the two steps together, and it is what the command line runs.
 *
 * @packageDocumentation
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { compile } from '@elm-toolkit/node-elm-compiler'

// The compiler writes a script that assigns to `this.Elm`, which only a CommonJS
// loader runs correctly, so the output is loaded with `require` and not `import`.
const require = createRequire(import.meta.url)

/**
 * One port of a running Elm program. A port from Elm to JavaScript has
 * `subscribe`; a port from JavaScript to Elm has `send`.
 *
 * @example
 *
 * Print every value that Elm sends through a port
 * ```TypeScript
 *   const log: ElmPort = app.ports.log
 *   log.subscribe?.((message) => console.log(message))
 * ```
 */
export type ElmPort = {
  send?(value: unknown): void
  subscribe?(listener: (value: unknown) => void): void
}

/**
 * A running Elm program. Elm leaves `ports` out when the program declares none.
 *
 * @example
 *
 * Send a value into a running program
 * ```TypeScript
 *   const app: ElmApp = Elm.Main.init()
 *   app.ports?.input?.send?.(42)
 * ```
 */
export type ElmApp = {
  ports?: Record<string, ElmPort>
}

/**
 * The object that compiled Elm code exports: one entry for each compiled module,
 * named like the module, with the `init` function that starts it.
 *
 * @example
 *
 * Start the `Main` module with flags
 * ```TypeScript
 *   const Elm: ElmNamespace = await compileProgram(['src/Main.elm'])
 *   Elm.Main.init({ flags: { name: 'Ada' } })
 * ```
 */
export type ElmNamespace = Record<string, { init(options?: { flags?: unknown }): ElmApp }>

/**
 * Describes one run of `runElm`.
 *
 * @example
 *
 * Run an optimized build through a launcher
 * ```TypeScript
 *   const options: RunOptions = { elmFiles: ['src/Main.elm'], launcher: 'src/main.ts', optimize: true }
 * ```
 */
export type RunOptions = {
  /** The Elm files to compile. All of them end up in the same `Elm` object. */
  elmFiles: string[]
  /**
   * A TypeScript or JavaScript module whose default export receives the `Elm`
   * object. Without it, the module called `Main` starts with the default ports.
   */
  launcher?: string
  /** Builds with `--optimize`. */
  optimize?: boolean
  /** Prints the compiler command before it runs. */
  verbose?: boolean
}

/**
 * Compiles Elm files and returns the `Elm` object that the compiled code
 * exports. The compiler runs in the current directory, so `elm.json` must be
 * there or in a parent directory, and its messages go to the terminal.
 *
 * The temporary directory that holds the compiled code is removed before the
 * function returns, also when the build fails.
 *
 * @example
 *
 * See which modules a build exports
 * ```TypeScript
 *   const Elm = await compileProgram(['src/Main.elm', 'src/Report.elm'])
 *   Object.keys(Elm) // ['Main', 'Report']
 * ```
 *
 * @param elmFiles - the Elm files to compile into one program
 * @param options - whether to optimize, and whether to print the compiler command
 * @returns the object with one entry for each compiled module
 * @throws an `Error` when the compiler cannot start or reports an error
 */
export async function compileProgram(
  elmFiles: string[],
  options: Pick<RunOptions, 'optimize' | 'verbose'> = {}
): Promise<ElmNamespace> {
  const directory = mkdtempSync(path.join(tmpdir(), 'elm-node-runner-'))
  const output = path.join(directory, 'elm.js')

  try {
    await new Promise<void>((resolve, reject) => {
      let startError: Error | undefined

      compile(elmFiles, { optimize: options.optimize, output, verbose: options.verbose })
        .on('error', (error) => {
          startError = error
        })
        .on('close', (exitCode) => {
          if (exitCode === 0) {
            resolve()
          } else {
            reject(startError ?? new Error('The Elm compiler reported an error.'))
          }
        })
    })

    return (require(output) as { Elm: ElmNamespace }).Elm
  } finally {
    rmSync(directory, { force: true, recursive: true })
  }
}

/**
 * Starts the module called `Main` the way `elm-node` does, for programs that
 * need no launcher. Whatever Elm sends through a `log` port is printed. Whatever
 * it sends through an `eval` port runs as JavaScript, with the program available
 * as the global `app`, so that code can send values back to Elm.
 *
 * @example
 *
 * Start a program and send it a value
 * ```TypeScript
 *   const app = startMain(await compileProgram(['src/Main.elm']))
 *   app.ports?.input?.send?.('hello')
 * ```
 *
 * @param Elm - the object that `compileProgram` returned
 * @returns the running program
 * @throws an `Error` when no compiled module is called `Main`
 */
export function startMain(Elm: ElmNamespace): ElmApp {
  if (!Elm.Main) {
    throw new Error(
      `No compiled module is called Main; the build exports ${Object.keys(Elm).join(', ')}. ` +
        'Name the entry module Main, or start the module from a launcher with --ts.'
    )
  }

  const app = Elm.Main.init()

  Object.assign(globalThis, { app })
  app.ports?.log?.subscribe?.((message) => console.log(message))
  // Indirect eval runs the code in the global scope, where it can reach `app`.
  app.ports?.eval?.subscribe?.((code) => globalThis.eval(String(code)))

  return app
}

/**
 * Compiles Elm files and starts the program, with a launcher or without one.
 * This is what the `elm-node-runner` command does.
 *
 * A launcher is a module whose default export is a function that receives the
 * `Elm` object. Node runs it directly, so a TypeScript launcher must use only
 * syntax that Node can strip, and it must live outside `node_modules`.
 *
 * @example
 *
 * Run a program through a launcher
 * ```TypeScript
 *   await runElm({ elmFiles: ['src/Main.elm'], launcher: 'src/main.ts' })
 * ```
 *
 * @param options - the files to compile, the launcher, and the build settings
 * @returns a promise that settles once the program has started
 * @throws an `Error` when the build fails, when the launcher has no function as
 * its default export, or when there is no launcher and no module called `Main`
 */
export async function runElm(options: RunOptions): Promise<void> {
  const Elm = await compileProgram(options.elmFiles, options)

  if (!options.launcher) {
    startMain(Elm)

    return
  }

  const launcher = (await import(pathToFileURL(path.resolve(options.launcher)).href)) as { default?: unknown }

  if (typeof launcher.default !== 'function') {
    throw new Error(`${options.launcher} must export a function as its default export.`)
  }

  await launcher.default(Elm)
}
