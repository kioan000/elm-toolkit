/**
 * The failures of a run, as data, and their message for a person.
 *
 * A failure of the build or of the load holds the error of
 * `@elm-toolkit/node-elm-compiler`. The other cases belong to the start of the
 * program.
 *
 * @packageDocumentation
 */

import { CliError, Maybe, continuingSentence, splitFirstLine } from '@elm-toolkit/cli-lib'
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
 * Describes a failure for a person. The summary adds only the detail, such as
 * the file or the message of the exception, because `title` already says what
 * went wrong.
 *
 * @example
 *
 * Print a build without Main
 * ```TypeScript
 *   CliError.print('no Main module to run', RunnerError.toCliError({ modules: ['Greeter'], type_: 'NoMain' }))
 *   // ERROR:no Main module to run the build has only Greeter.
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
        summary: `The build has only ${error.modules.join(', ')}.`,
        whatHappened: ['Without --ts, elm-node-runner starts the module called Main.'],
      })
    case 'MainNotStarted':
      return CliError.create({
        solution:
          'Without --ts, Main starts without flags. Give Main the type Program () model msg, or start it from a launcher with --ts and pass the flags there.',
        summary: splitFirstLine(error.cause)[0],
        whatHappened: [
          'elm-node-runner called the init function of Main, which threw an error.',
          ...splitFirstLine(error.cause)[1],
        ],
      })
    case 'LauncherNotLoaded':
      return CliError.create({
        solution: `Check that ${error.launcher} is a module that Node can run. A TypeScript launcher must use only syntax that Node can strip, and it must not be inside node_modules.`,
        summary: `${error.launcher}: ${continuingSentence(splitFirstLine(error.cause)[0])}`,
        whatHappened: [
          `elm-node-runner imports ${error.launcher} to start the program.`,
          ...splitFirstLine(error.cause)[1],
        ],
      })
    case 'LauncherNotAFunction':
      return CliError.create({
        solution:
          'Export a function that receives the Elm object, for example `export default (Elm) => Elm.Main.init()`.',
        summary: `Check the default export of ${error.launcher}.`,
        whatHappened: [`elm-node-runner calls the default export of ${error.launcher} with the Elm object.`],
      })
    case 'LauncherFailed':
      return CliError.create({
        solution: `Correct the error in ${error.launcher}; the message above comes from it.`,
        summary: `${error.launcher}: ${continuingSentence(splitFirstLine(error.cause)[0])}`,
        whatHappened: [
          `elm-node-runner called the default export of ${error.launcher} with the Elm object.`,
          ...splitFirstLine(error.cause)[1],
        ],
      })
  }
}

/**
 * Says in a few words what went wrong, as the person who runs the command sees
 * it. The command prints it highlighted, as the title of the error, so it must
 * make sense without knowing how the runner works.
 *
 * @example
 *
 * Print a failure under its title
 * ```TypeScript
 *   CliError.print(RunnerError.title(error), RunnerError.toCliError(error))
 *   // ERROR:launcher threw an error src/main.ts: cannot read properties of undefined
 * ```
 *
 * @param error - the failure
 * @returns a short sentence, such as `Elm code does not compile`
 */
function title(error: RunnerError): string {
  switch (error.type_) {
    case 'BuildFailed':
      return CompileError.title(error.compileError)
    case 'ProgramNotLoaded':
      return LoadError.title(error.loadError)
    case 'NoMain':
      return 'no Main module to run'
    case 'MainNotStarted':
      return 'Main failed to start'
    case 'LauncherNotLoaded':
      return 'launcher cannot be loaded'
    case 'LauncherNotAFunction':
      return 'launcher exports no function'
    case 'LauncherFailed':
      return 'launcher threw an error'
  }
}

/**
 * Describes a failed build with the message of `node-elm-compiler`. A missing
 * compiler gets its own advice, because the command has no option to choose
 * the binary.
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
 *   CliError.print(RunnerError.title(error), RunnerError.toCliError(error))
 * ```
 */
export const RunnerError = { title, toCliError }
