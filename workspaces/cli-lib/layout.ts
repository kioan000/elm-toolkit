/**
 * The layout that `CliError` and `CliSuccess` share: a highlighted first line,
 * then sections, each with a label and indented lines, after a blank line.
 *
 * The module is internal to `cli-lib`; the index does not export it.
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
  readonly label: string
  readonly labelColor?: string
  readonly lineColor?: string
  readonly lines: ReadonlyArray<string>
}

/**
 * Prints the sections that have lines, each after a blank line, with the label
 * in bold and the lines indented below it.
 *
 * @param sections - the sections, in the order to print them
 */
export function printSections(sections: ReadonlyArray<Section>): void {
  for (const { label, labelColor = '', lineColor = '', lines } of sections.filter((each) => each.lines.length > 0)) {
    console.info(
      `\n    \x1b[1m${labelColor}${label}\x1b[0m\n${lines.map((line) => `        ${lineColor}${line}\x1b[0m`).join('\n')}`
    )
  }
}

/**
 * Turns a summary and its sections into text without colors, in the same
 * layout as `printSections`.
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
