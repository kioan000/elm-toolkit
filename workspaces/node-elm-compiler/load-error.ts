/**
 * The failures of `load`, the second step of `compileRunnableProgram`, and
 * their message for a person. A failure of the first step, the build, is a
 * `CompileError`.
 *
 * @packageDocumentation
 */

import { CliError, splitFirstLine } from '@elm-toolkit/cli-lib'

/**
 * One failure of the load of a compiled Elm program.
 *
 * @example
 *
 * Report a program that could not be loaded
 * ```TypeScript
 *   switch (loadResult.type_) {
 *     case 'Ok':
 *       return loadResult.value.Main?.init()
 *     case 'Err':
 *       return CliError.print(LoadError.title(loadResult.error), LoadError.toCliError(loadResult.error))
 *   }
 * ```
 */
export type LoadError =
  /** The code threw, for example in a top-level `Debug.todo`. `original` is what it threw. */
  | { readonly cause: string; readonly original: unknown; readonly type_: 'ScriptFailed' }
  /** The code did not define the `Elm` object, so Elm did not write it. */
  | { readonly type_: 'NoElmObject' }

/**
 * Describes a failure of `load` for a person.
 *
 * @example
 *
 * Print a program whose code threw while it loaded
 * ```TypeScript
 *   const error: LoadError = { cause: 'TODO in module `Main` on line 3', original: undefined, type_: 'ScriptFailed' }
 *   CliError.print(LoadError.title(error), LoadError.toCliError(error))
 *   // ERROR:Elm program crashed before it started TODO in module `Main` on line 3
 * ```
 *
 * @param error - the failure
 * @returns the message, ready for `CliError.print`
 */
function toCliError(error: LoadError): CliError {
  switch (error.type_) {
    case 'ScriptFailed':
      return CliError.create({
        solution:
          'Look for a top-level value of the program that fails when it is computed, such as a call of Debug.todo, and run the program again.',
        summary: splitFirstLine(error.cause)[0],
        whatHappened: [
          'Elm compiled the program without errors. Loading it computes the top-level values of every module, and one of them threw an error.',
          ...splitFirstLine(error.cause)[1],
        ],
      })
    case 'NoElmObject':
      return CliError.create({
        solution:
          'This is probably a bug of node-elm-compiler. Please report it at https://github.com/kioan000/elm-toolkit/issues, with the message above.',
        summary: 'The code ran without defining the Elm object.',
        whatHappened: [
          'Elm compiled the program without errors, and its code ran, but it did not define the Elm object that holds the modules.',
        ],
      })
  }
}

/**
 * Says in a few words what went wrong, as the person who runs the tool sees it.
 * Print it as the highlighted title, with the `CliError` of `toCliError`.
 *
 * @example
 *
 * Print a program that crashed while it loaded
 * ```TypeScript
 *   CliError.print(LoadError.title(error), LoadError.toCliError(error))
 * ```
 *
 * @param error - the load error
 * @returns a short sentence, such as `Elm program crashed before it started`
 */
function title(error: LoadError): string {
  switch (error.type_) {
    case 'ScriptFailed':
      return 'Elm program crashed before it started'
    case 'NoElmObject':
      return 'compiled code is not an Elm program'
  }
}

/**
 * The functions of `LoadError`.
 *
 * @example
 *
 * Print a failure
 * ```TypeScript
 *   CliError.print(LoadError.title(error), LoadError.toCliError(error))
 * ```
 */
export const LoadError = { title, toCliError }
