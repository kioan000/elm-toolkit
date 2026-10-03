/**
 * The outcome of a command that worked, made to be read by a person, in the
 * same layout as `CliError`.
 *
 * A `CliSuccess` has a summary, one line that says what the command did, the
 * details of what happened, and, when there is one, the next step. The
 * function that runs a command prints it once, with `print`.
 *
 * @packageDocumentation
 */

import { type Section, printSections } from './layout.ts'
import { Maybe } from './maybe.ts'

/**
 * What a command did, the details, and what to do next.
 *
 * @example
 *
 * Describe a built archive
 * ```TypeScript
 *   const built: CliSuccess = {
 *     details: ['elm/core 1.0.5 from https://github.com/lydell/core.git at 310bb9e'],
 *     next: Maybe.Just('Give the folder to the patcher with `cli-elm-kernel-patcher --patches elm-kernel-patcher`.'),
 *     summary: 'Built elm-kernel-patcher/patches.tar.gz from 1 commit.',
 *   }
 * ```
 */
export type CliSuccess = {
  /** The lines that say what happened. */
  readonly details: ReadonlyArray<string>
  /** What to do next, when there is a natural next step. */
  readonly next: Maybe<string>
  /** What the command did, in one line. */
  readonly summary: string
}

/**
 * Builds a success. Only the summary is required.
 *
 * @example
 *
 * Report a manifest that was written
 * ```TypeScript
 *   CliSuccess.create({
 *     next: 'Change the commits you need, then run `cli-elm-kernel-patcher archive build`.',
 *     summary: 'Created elm-kernel-patcher/elm-kernel-patcher.json with the patches of this package.',
 *   })
 * ```
 *
 * @param parts - the summary, what the command did in one line; the details,
 * the lines that say what happened; and the next step
 * @returns the success
 */
function create(parts: { details?: ReadonlyArray<string>; next?: string; summary: string }): CliSuccess {
  return {
    details: parts.details ?? [],
    next: parts.next === undefined ? Maybe.Nothing : Maybe.Just(parts.next),
    summary: parts.summary,
  }
}

/**
 * Prints a success the way every command of the toolkit does. The first line
 * holds the title and the summary, highlighted in green. Below it come the
 * sections that have content, each after a blank line: "What happened:" with
 * the details, and "Next step:", its label in green.
 *
 * @example
 *
 * Report a built archive
 * ```TypeScript
 *   CliSuccess.print('archive build', built)
 *   // DONE:archive build Built elm-kernel-patcher/patches.tar.gz from 1 commit.
 *   //
 *   //     What happened:
 *   //         elm/core 1.0.5 from https://github.com/lydell/core.git at 310bb9e
 *   //
 *   //     Next step:
 *   //         Give the folder to the patcher with `cli-elm-kernel-patcher --patches elm-kernel-patcher`.
 * ```
 *
 * @param title - the command that worked
 * @param success - the success to print
 */
function print(title: string, success: CliSuccess): void {
  const sections: ReadonlyArray<Section> = [
    { label: 'What happened:', lines: success.details },
    { label: 'Next step:', labelColor: '\x1b[32m', lines: success.next.map((text) => [text]).withDefault([]) },
  ]

  console.info(`\n\x1b[42mDONE:${title}\x1b[0m`, success.summary)
  printSections(sections)
}

/**
 * The functions of `CliSuccess`, under the same name as the type.
 *
 * @example
 *
 * Build a success and print it
 * ```TypeScript
 *   CliSuccess.print('archive check', CliSuccess.create({ summary: 'The archive matches the manifest.' }))
 * ```
 */
export const CliSuccess = { create, print }
