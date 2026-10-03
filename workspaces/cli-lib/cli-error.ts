/**
 * The error of a command line step, made to be read by a person.
 *
 * A `CliError` has four parts. The summary is one line that says what failed.
 * The details are the lines that explain why. The solution, when there is one,
 * says what to do next. The trace is the stack of an exception that looks like
 * a bug, so that it can be reported. A step that can fail returns
 * `Result<CliError, A>`, and the function that runs the command prints the
 * error once, with `print`.
 *
 * Create one with `create` when the step knows what went wrong, or with
 * `fromUnknown` when it caught an exception, usually through `Result.fromAttempt`.
 * Add a solution to the error of an exception with `withSolution`.
 *
 * @packageDocumentation
 */

import { prettyError } from './index.ts'
import { type Section, printSections, sectionsToString } from './layout.ts'
import { Maybe } from './maybe.ts'

/**
 * What failed, why, what to do next, and, for an exception that looks like a
 * bug, where it happened.
 *
 * @example
 *
 * Describe a manifest that is missing
 * ```TypeScript
 *   const missing: CliError = {
 *     details: [],
 *     solution: Maybe.Just('cli-elm-kernel-patcher archive init'),
 *     summary: 'elm-kernel-patcher/elm-kernel-patcher.json does not exist.',
 *     trace: Maybe.Nothing,
 *   }
 * ```
 */
export type CliError = {
  /** The lines that explain why the step failed. */
  readonly details: ReadonlyArray<string>
  /** What to do next, when the step knows it. */
  readonly solution: Maybe<string>
  /** What failed, in one line. */
  readonly summary: string
  /** The stack of an exception that looks like a bug, not like a problem of the system. */
  readonly trace: Maybe<string>
}

/**
 * Builds an error. Only the summary is required; the details and the solution
 * are optional. The trace is left out, because only `fromUnknown` can tell
 * whether an exception looks like a bug.
 *
 * @example
 *
 * Refuse a manifest that repeats a package
 * ```TypeScript
 *   CliError.create({
 *     summary: 'elm/html appears more than once in elm-kernel-patcher.json.',
 *     solution: 'keep one entry for each package',
 *   })
 * ```
 *
 * @param parts - the summary, what failed in one line; the details, the lines
 * that explain why; and the solution, what to do next
 * @returns the error
 */
function create(parts: { details?: ReadonlyArray<string>; solution?: string; summary: string }): CliError {
  return {
    details: parts.details ?? [],
    solution: parts.solution === undefined ? Maybe.Nothing : Maybe.Just(parts.solution),
    summary: parts.summary,
    trace: Maybe.Nothing,
  }
}

/**
 * Turns an exception that a step caught into an error for a person. The
 * message of the exception becomes the details; a failed child process gives
 * its standard error instead, which says more than its exit code.
 *
 * An error of the system, such as a missing file (`ENOENT`), a failed child
 * process and a file that is not valid JSON are problems of the environment or
 * of the input, and their message is enough. Any other exception is probably a
 * bug, so its stack becomes the trace.
 *
 * @example
 *
 * Describe a file that could not be read
 * ```TypeScript
 *   Result.fromAttempt(read).mapError((caught) => CliError.fromUnknown('could not read elm.json', caught))
 *   // Err { summary: 'could not read elm.json', details: ["ENOENT: no such file or directory, open 'elm.json'"], … }
 * ```
 *
 * @param summary - what failed, in one line
 * @param caught - the exception, of any type
 * @returns the error, with the lines of the cause as details, and a trace for a likely bug
 */
function fromUnknown(summary: string, caught: unknown): CliError {
  if (!(caught instanceof Error)) {
    return create({ details: String(caught).split('\n'), summary })
  }

  const stderr = 'stderr' in caught ? String(caught.stderr).trim() : ''
  // JSON.parse throws a SyntaxError for a file that a person wrote, so it is a problem of the input.
  const fromTheSystem = 'code' in caught || 'status' in caught || stderr !== '' || caught instanceof SyntaxError
  const [, ...stack] = (caught.stack ?? '').split('\n')
  const error = create({ details: (stderr !== '' ? stderr : caught.message).split('\n'), summary })

  return fromTheSystem || stack.length === 0
    ? error
    : { ...error, trace: Maybe.Just(stack.map((line) => line.trim()).join('\n')) }
}

/**
 * Sets what to do next, replacing any solution that the error had.
 *
 * @example
 *
 * Suggest what to do after a caught exception
 * ```TypeScript
 *   CliError.withSolution(CliError.fromUnknown('could not read the manifest', caught), 'fix its JSON')
 * ```
 *
 * @param error - the error to extend
 * @param solution - what the person can do to fix the problem, in one line
 * @returns the same error, with that solution
 */
function withSolution(error: CliError, solution: string): CliError {
  return { ...error, solution: Maybe.Just(solution) }
}

/**
 * Lists the sections of an error, in the order they are shown: what happened,
 * how to fix it, and the stack trace. Only the label of the solution is green,
 * so that it stands out; the stack trace is grey, because it is for a bug
 * report.
 *
 * @param error - the error to describe
 * @returns each section with its label, its lines and its colors
 */
function sections(error: CliError): ReadonlyArray<Section> {
  return [
    { label: 'What happened:', lines: error.details },
    { label: 'How to fix:', labelColor: '\x1b[32m', lines: error.solution.map((text) => [text]).withDefault([]) },
    {
      label: 'Stack trace:',
      lineColor: '\x1b[2m',
      lines: error.trace.map((stack) => stack.split('\n')).withDefault([]),
    },
  ]
}

/**
 * Turns an error into text, in the same layout as `print` but without colors:
 * the summary, then each section that has content, with a blank line between
 * them. Use it where an error has to become a JavaScript `Error`, for example
 * to stop webpack.
 *
 * @example
 *
 * Show an error as text
 * ```TypeScript
 *   CliError.toString(CliError.create({ solution: 'Check the path.', summary: 'No patches at nowhere.' }))
 *   // 'No patches at nowhere.\n\nHow to fix:\n    Check the path.'
 * ```
 *
 * @param error - the error to turn into text
 * @returns the summary and the sections, separated by blank lines
 */
function toString(error: CliError): string {
  return sectionsToString(error.summary, sections(error))
}

/**
 * Prints an error the way every command of the toolkit does. The first line
 * holds the title and the summary, highlighted in red. Below it come the
 * sections that have content, each after a blank line: "What happened:" with
 * the details, "How to fix:" with the solution, its label in green, and
 * "Stack trace:" with the stack in grey.
 *
 * @example
 *
 * Report a manifest that is missing
 * ```TypeScript
 *   CliError.print('archive build', missing)
 *   // ERROR:archive build elm-kernel-patcher/elm-kernel-patcher.json does not exist.
 *   //
 *   //     How to fix:
 *   //         Create it with `cli-elm-kernel-patcher archive init`.
 * ```
 *
 * @param title - the command or the step that failed
 * @param error - the error to print
 */
function print(title: string, error: CliError): void {
  prettyError(title, error.summary)
  printSections(sections(error))
}

/**
 * The functions of `CliError`, under the same name as the type.
 *
 * @example
 *
 * Build an error with a solution and print it
 * ```TypeScript
 *   CliError.print(
 *     'kernel patching',
 *     CliError.create({ solution: 'name the folder with --elmJsonFolder', summary: 'elm.json does not exist.' })
 *   )
 * ```
 */
export const CliError = { create, fromUnknown, print, toString, withSolution }
