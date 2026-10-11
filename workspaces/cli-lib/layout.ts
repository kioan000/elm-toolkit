/**
 * The layout that `CliError` and `CliSuccess` share: a highlighted first line,
 * then sections, each with a label and indented lines, after a blank line. A
 * line that is too long continues on the next line, with the same indentation.
 *
 * The module is internal to `cli-lib`. The index exports only
 * `continuingSentence` and `splitFirstLine`, which the commands also use for
 * their own text.
 *
 * @packageDocumentation
 */

/**
 * One block of a report: a label such as "What happened:", the lines below it,
 * and their colors as terminal codes.
 *
 * @example
 *
 * Describe a solution with a green label
 * ```TypeScript
 *   const solution: Section = { label: 'How to fix:', labelColor: '\x1b[32m', lines: ['Rebuild the archive.'] }
 * ```
 */
export type Section = {
  /** When true, a long line stays whole, for text that another program already laid out. */
  readonly keepLines?: boolean
  readonly label: string
  readonly labelColor?: string
  readonly lineColor?: string
  readonly lines: ReadonlyArray<string>
}

// Longer lines are hard to read even in a wide terminal.
const maximumWidth = 100

// The width when the output is not a terminal, for example a file or a pipe.
const defaultWidth = 80

/**
 * Prints the sections that have lines, each after a blank line, with the label
 * in bold and the lines indented below it. The lines fit the terminal, up to
 * 100 columns.
 *
 * @param sections - the sections, in the order to print them
 */
export function printSections(sections: ReadonlyArray<Section>): void {
  const width = Math.min(process.stdout.columns || defaultWidth, maximumWidth) - 8

  for (const { keepLines = false, label, labelColor = '', lineColor = '', lines } of sections.filter(
    (each) => each.lines.length > 0
  )) {
    const wrapped = keepLines ? lines : lines.flatMap((line) => wrap(line, width))

    console.info(
      `\n    \x1b[1m${labelColor}${label}\x1b[0m\n${wrapped.map((line) => `        ${lineColor}${line}\x1b[0m`).join('\n')}`
    )
  }
}

/**
 * Splits a line that is longer than the width at its spaces. The next lines
 * keep the indentation of the first, so an indented line of Elm code stays
 * readable. A command between backticks stays on one line, so that it can be
 * copied, and so does a word longer than the width, such as a URL.
 *
 * @param line - the line to split
 * @param width - the number of columns available
 * @returns the line, or its parts, each within the width where possible
 */
export function wrap(line: string, width: number): ReadonlyArray<string> {
  if (line.length <= width) {
    return [line]
  }

  const indentation = /^\s*/.exec(line)?.[0] ?? ''
  // A span between backticks counts as one word.
  const words = line.slice(indentation.length).match(/`[^`]*`\S*|\S+/g) ?? []

  return words.reduce<string[]>(
    (parts, word) => {
      const last = parts[parts.length - 1] ?? indentation

      if (last.trim() === '' || `${last} ${word}`.length <= width) {
        return [...parts.slice(0, -1), last.trim() === '' ? `${last}${word}` : `${last} ${word}`]
      }

      return [...parts, `${indentation}${word}`]
    },
    [indentation]
  )
}

/**
 * Turns a summary and its sections into text without colors, in the same
 * layout as `printSections`. The lines stay whole, because the reader of the
 * text, such as webpack, decides where to break them.
 *
 * @param summary - the first line
 * @param sections - the sections, in order; the ones without lines are left out
 * @returns the summary and the sections, separated by blank lines
 */
export function sectionsToString(summary: string, sections: ReadonlyArray<Section>): string {
  const blocks = sections
    .filter((section) => section.lines.length > 0)
    .map(({ label, lines }) => [label, ...lines.map((line) => `    ${line}`)].join('\n'))

  return [summary, ...blocks].join('\n\n')
}

// Words that keep their capital letter where a sentence continues.
const properNouns = new Set(['Elm', 'Main', 'Node'])

/**
 * Lowers the first letter of a text that continues a sentence: a summary after
 * the title of a message, or a message of the system after a colon. Messages
 * follow the Chicago Manual of Style, so a colon does not start a new sentence.
 * A proper noun, such as `Elm`, and a word with more than one capital, such as
 * `TODO` or `TypeScript`, stay as they are.
 *
 * @example
 *
 * Quote the message of an exception after a colon
 * ```TypeScript
 *   `The system reported: ${continuingSentence('No such file or directory')}`
 *   // The system reported: no such file or directory
 * ```
 *
 * @param text - the text that continues the sentence
 * @returns the same text, with a lower first letter when it is an ordinary word
 */
export function continuingSentence(text: string): string {
  const [word = ''] = text.split(' ')

  return /^[A-Z][a-z]+\W*$/.test(word) && !properNouns.has(word.replace(/\W/g, ''))
    ? `${text.charAt(0).toLowerCase()}${text.slice(1)}`
    : text
}

/**
 * Splits a message in its first line and the other ones, without blank lines.
 * An error shows the first line as its summary, and the others below it, so
 * that nothing of the message is lost.
 *
 * @example
 *
 * Split the message of an exception
 * ```TypeScript
 *   splitFirstLine('Problem with the flags.\n\nExpecting a STRING')
 *   // ['Problem with the flags.', ['Expecting a STRING']]
 * ```
 *
 * @param message - the message, such as the one of an exception
 * @returns the first line, and the other lines that are not blank
 */
export function splitFirstLine(message: string): readonly [string, ReadonlyArray<string>] {
  const [first = '', ...others] = message.split('\n')

  return [first, others.filter((line) => line.trim() !== '')]
}
