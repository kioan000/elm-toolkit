/**
 * The failures of `load`, the second step of `compileRunnableProgram`, and
 * their message for a person. A failure of the first step, the build, is a
 * `CompileError`.
 *
 * @packageDocumentation
 */

import { CliError } from '@elm-toolkit/cli-lib'

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
 *       return CliError.print('elm-node-runner', LoadError.toCliError(loadResult.error))
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
 *   CliError.print('elm-node-runner', LoadError.toCliError({ cause: 'boom', original: new Error('boom'), type_: 'ScriptFailed' }))
 *   // ERROR:elm-node-runner The compiled Elm program failed while it loaded.
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
        summary: 'The compiled Elm program failed while it loaded.',
        whatHappened: [
          'Elm compiled the program without errors. Loading it computes the top-level values of every module, and one of them threw an error.',
          `The program reported: ${error.cause}`,
        ],
      })
    case 'NoElmObject':
      return CliError.create({
        solution:
          'This is probably a bug of node-elm-compiler. Please report it at https://github.com/kioan000/elm-toolkit/issues, with the message above.',
        summary: 'The compiled code did not produce the Elm object.',
        whatHappened: [
          'Elm compiled the program without errors, and its code ran, but it did not define the Elm object that holds the modules.',
        ],
      })
  }
}

/**
 * The functions of `LoadError`.
 *
 * @example
 *
 * Print a failure
 * ```TypeScript
 *   CliError.print('elm make', LoadError.toCliError(error))
 * ```
 */
export const LoadError = { toCliError }
