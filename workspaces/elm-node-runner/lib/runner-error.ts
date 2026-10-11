/**
 * The failures of a run, as data, and their message for a person.
 *
 * A failure of the build or of the load holds the error of
 * `@elm-toolkit/node-elm-compiler`. The other cases belong to the start of the
 * program.
 *
 * @packageDocumentation
 */

import { CliError, Maybe, continuingSentence } from '@elm-toolkit/cli-lib'
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
  const described = describe(error)

  return { ...described, summary: continuingSentence(described.summary) }
}

/**
 * Describes a failure, with a summary that may start with a capital letter.
 *
 * @param error - the failure
 * @returns the message
 */
function describe(error: RunnerError): CliError {
  switch (error.type_) {
    case 'BuildFailed':
      return buildError(error.compileError)
    case 'ProgramNotLoaded':
      return error.loadError.type_ === 'ScriptFailed'
        ? {
            ...LoadError.toCliError(error.loadError),
            summary: firstLine(error.loadError.cause),
            whatHappened: [
              'Loading the program computes the top-level values of every module, and one of them threw an error.',
              ...rest(error.loadError.cause),
            ],
          }
        : LoadError.toCliError(error.loadError)
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
        summary: firstLine(error.cause),
        whatHappened: ['elm-node-runner called the init function of Main, which threw an error.', ...rest(error.cause)],
      })
    case 'LauncherNotLoaded':
      return CliError.create({
        solution: `Check that ${error.launcher} is a module that Node can run. A TypeScript launcher must use only syntax that Node can strip, and it must not be inside node_modules.`,
        summary: `${error.launcher}: ${continuingSentence(firstLine(error.cause))}`,
        whatHappened: [`elm-node-runner imports ${error.launcher} to start the program.`, ...rest(error.cause)],
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
        summary: `${error.launcher}: ${continuingSentence(firstLine(error.cause))}`,
        whatHappened: [
          `elm-node-runner called the default export of ${error.launcher} with the Elm object.`,
          ...rest(error.cause),
        ],
      })
  }
}

/**
 * Takes the first line of a message, for the summary of an error.
 *
 * @param cause - the message of an exception
 * @returns its first line
 */
function firstLine(cause: string): string {
  return cause.split('\n')[0] ?? cause
}

/**
 * Takes the lines of a message after the first, so that nothing of it is lost.
 *
 * @param cause - the message of an exception
 * @returns the other lines, without blank ones
 */
function rest(cause: string): ReadonlyArray<string> {
  return cause
    .split('\n')
    .slice(1)
    .filter((line) => line.trim() !== '')
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
      return buildTitle(error.compileError)
    case 'ProgramNotLoaded':
      return error.loadError.type_ === 'ScriptFailed'
        ? 'Elm program crashed before it started'
        : 'compiled code is not an Elm program'
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
 * Says in a few words why the build failed.
 *
 * @param compileError - the error of the build
 * @returns a short sentence
 */
function buildTitle(compileError: CompileError): string {
  switch (compileError.type_) {
    case 'CompileFailed':
      return 'Elm code does not compile'
    case 'CompilerNotStarted':
      return compileError.code.withDefault('') === 'ENOENT' ? 'Elm compiler not found' : 'Elm compiler could not run'
    case 'CompilerStopped':
      return 'Elm compiler could not run'
    case 'UnknownOption':
    case 'TempFolderNotCreated':
    case 'OutputNotRead':
    case 'ModuleNotFound':
    case 'ProgramNotLoaded':
    case 'WorkerNotStarted':
    case 'NoPorts':
    case 'EntryNotRead':
    case 'InvalidModule':
      return 'build failed'
  }
}

/**
 * Describes a failed build, with a summary that adds only the detail to the
 * title. A missing compiler gets its own advice, because the command has no
 * option to choose the binary.
 *
 * @param compileError - the error of the build
 * @returns the message
 */
function buildError(compileError: CompileError): CliError {
  const described = CompileError.toCliError(compileError)

  switch (compileError.type_) {
    case 'CompileFailed':
      return { ...described, summary: compileError.sources.join(', ') }
    case 'CompilerNotStarted':
      return compileError.code.withDefault('') === 'ENOENT'
        ? {
            ...described,
            solution: Maybe.Just(
              'Install Elm in the project with `npm install --save-dev elm`, and start elm-node-runner from a script of package.json, which puts the elm of the project on the PATH.'
            ),
            summary: `No program called "${compileError.pathToElm}" is on the PATH.`,
          }
        : described
    case 'UnknownOption':
    case 'CompilerStopped':
    case 'TempFolderNotCreated':
    case 'OutputNotRead':
    case 'ModuleNotFound':
    case 'ProgramNotLoaded':
    case 'WorkerNotStarted':
    case 'NoPorts':
    case 'EntryNotRead':
    case 'InvalidModule':
      return described
  }
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
