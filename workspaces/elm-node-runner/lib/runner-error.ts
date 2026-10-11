/**
 * The failures of a run, as data, and their message for a person.
 *
 * A failure of the build or of the load holds the error of
 * `@elm-toolkit/node-elm-compiler`. The other cases belong to the start of the
 * program.
 *
 * @packageDocumentation
 */

import { CliError, Maybe } from '@elm-toolkit/cli-lib'
import { CompileError, LoadError } from '@elm-toolkit/node-elm-compiler/result-api'

/**
 * One failure of a run. Read it with a `switch` on `type_`.
 *
 * @example
 *
 * Handle a build without Main
 * ```TypeScript
 *   if (error.type_ === 'NoMain') {
 *     console.log(`Start one of: ${error.modules.join(', ')}`)
 *   }
 * ```
 */
export type RunnerError =
  /** Elm could not build the program. */
  | { readonly compileError: CompileError; readonly type_: 'BuildFailed' }
  /** The compiled code failed while it loaded. */
  | { readonly loadError: LoadError; readonly type_: 'ProgramNotLoaded' }
  /** No launcher and no `Main`. `modules` has the full names, such as `Tools.Echo`. */
  | { readonly modules: ReadonlyArray<string>; readonly type_: 'NoMain' }
  /** The `init` of `Main` threw, most often because `Main` expects flags. */
  | { readonly cause: string; readonly original: unknown; readonly type_: 'MainNotStarted' }
  /** The launcher could not be imported. */
  | {
      readonly cause: string
      readonly launcher: string
      readonly original: unknown
      readonly type_: 'LauncherNotLoaded'
    }
  /** The default export of the launcher is not a function. */
  | { readonly launcher: string; readonly type_: 'LauncherNotAFunction' }
  /** The launcher threw, or its promise rejected. */
  | { readonly cause: string; readonly launcher: string; readonly original: unknown; readonly type_: 'LauncherFailed' }

/**
 * Describes a failure for a person. A failure of the build or of the load keeps
 * the message of `@elm-toolkit/node-elm-compiler`.
 *
 * @example
 *
 * Print a build without Main
 * ```TypeScript
 *   CliError.print('elm-node-runner', RunnerError.toCliError({ modules: ['Greeter'], type_: 'NoMain' }))
 *   // ERROR:elm-node-runner No compiled module is called Main.
 * ```
 *
 * @param error - the failure
 * @returns the message, ready for `CliError.print`
 */
function toCliError(error: RunnerError): CliError {
  switch (error.type_) {
    case 'BuildFailed':
      return buildError(error.compileError)
    case 'ProgramNotLoaded':
      return LoadError.toCliError(error.loadError)
    case 'NoMain':
      return CliError.create({
        solution: 'Name the entry module Main, or start the module from a launcher with --ts.',
        summary: 'No compiled module is called Main.',
        whatHappened: [
          `Without --ts, elm-node-runner starts the module called Main, and the build exports ${error.modules.join(', ')}.`,
        ],
      })
    case 'MainNotStarted':
      return CliError.create({
        solution:
          'Without --ts, Main starts without flags. Give Main the type Program () model msg, or start it from a launcher with --ts and pass the flags there.',
        summary: 'The module Main failed to start.',
        whatHappened: [
          'elm-node-runner called the init function of Main, which threw an error.',
          `Elm reported: ${error.cause}`,
        ],
      })
    case 'LauncherNotLoaded':
      return CliError.create({
        solution: `Check that ${error.launcher} is a module that Node can run. A TypeScript launcher must use only syntax that Node can strip, and it must not be inside node_modules.`,
        summary: `Could not load the launcher ${error.launcher}.`,
        whatHappened: [
          `elm-node-runner imports ${error.launcher} to start the program, and the import failed.`,
          `Node reported: ${error.cause}`,
        ],
      })
    case 'LauncherNotAFunction':
      return CliError.create({
        solution:
          'Export a function that receives the Elm object, for example `export default (Elm) => Elm.Main.init()`.',
        summary: `${error.launcher} has no function as its default export.`,
        whatHappened: [
          `elm-node-runner calls the default export of ${error.launcher} with the Elm object, and that default export is not a function.`,
        ],
      })
    case 'LauncherFailed':
      return CliError.create({
        solution: `Correct the error in ${error.launcher}; the message above comes from it.`,
        summary: `The launcher ${error.launcher} failed.`,
        whatHappened: [
          `elm-node-runner called the default export of ${error.launcher} with the Elm object, and it threw an error.`,
          `The launcher reported: ${error.cause}`,
        ],
      })
  }
}

/**
 * Describes a failed build. A missing compiler gets its own advice, because the
 * command has no option to choose the binary.
 *
 * @param compileError - the error of the build
 * @returns the message
 */
function buildError(compileError: CompileError): CliError {
  const described = CompileError.toCliError(compileError)
  const notFound = compileError.type_ === 'CompilerNotStarted' && compileError.code.withDefault('') === 'ENOENT'

  return notFound
    ? {
        ...described,
        solution: Maybe.Just(
          'Install Elm in the project with `npm install --save-dev elm`, and start elm-node-runner from a script of package.json, which puts the elm of the project on the PATH.'
        ),
      }
    : described
}

/**
 * The functions of `RunnerError`.
 *
 * @example
 *
 * Print a failure
 * ```TypeScript
 *   CliError.print('elm-node-runner', RunnerError.toCliError(error))
 * ```
 */
export const RunnerError = { toCliError }
