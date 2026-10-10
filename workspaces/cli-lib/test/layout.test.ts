/**
 * Checks how the shared layout splits a line that is too long for the
 * terminal.
 *
 * @packageDocumentation
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { CliError } from '../index.ts'
import { wrap } from '../layout.ts'

describe('wrap', () => {
  it('keeps a line that fits', () => {
    assert.deepEqual(wrap('Rebuild the archive.', 40), ['Rebuild the archive.'])
  })

  it('splits a long line at its spaces', () => {
    assert.deepEqual(wrap('Install Elm in the project with npm install, or set pathToElm.', 32), [
      'Install Elm in the project with',
      'npm install, or set pathToElm.',
    ])
  })

  it('keeps the indentation of the line on the next lines', () => {
    assert.deepEqual(wrap('    But the type annotation says it should be an Int', 30), [
      '    But the type annotation',
      '    says it should be an Int',
    ])
  })

  it('keeps a command between backticks on one line', () => {
    assert.deepEqual(wrap('Run `elm make src/Main.elm` to see it.', 16), [
      'Run',
      '`elm make src/Main.elm`',
      'to see it.',
    ])
  })

  it('keeps a word longer than the width whole, such as a URL', () => {
    assert.deepEqual(wrap('See https://guide.elm-lang.org/interop/ports.html now', 20), [
      'See',
      'https://guide.elm-lang.org/interop/ports.html',
      'now',
    ])
  })
})

describe('CliError.toString', () => {
  it('shows the details from another program under their own label, between what happened and the solution', () => {
    const text = CliError.toString(
      CliError.create({
        details: ['-- TYPE MISMATCH ---- src/Broken.elm'],
        solution: 'Follow the instructions of the Elm compiler above.',
        summary: 'Could not compile src/Broken.elm.',
        whatHappened: ['The Elm compiler reported an error.'],
      })
    )

    assert.match(text, /What happened:\n.*\n\nDetails:\n {4}-- TYPE MISMATCH ---- src\/Broken\.elm\n\nHow to fix:/)
  })
})

describe('CliError.print', () => {
  it('keeps every line within the terminal, and a command between backticks on one line', (t) => {
    const printed: string[] = []

    t.mock.method(console, 'error', (line: string) => printed.push(line))
    t.mock.method(console, 'info', (line: string) => printed.push(line))
    // The tests write to a pipe, which has no columns, so the test gives stdout a width of its own.
    process.stdout.columns = 60
    t.after(() => {
      delete (process.stdout as { columns?: number }).columns
    })
    CliError.print(
      'elm make',
      CliError.create({
        solution:
          'Install Elm in the project with `npm install --save-dev elm`, or set pathToElm to the path of the binary.',
        summary: 'The Elm compiler "elm" was not found.',
      })
    )

    const lines = printed
      .join('\n')
      .replace(/\x1b\[[0-9;]*m/g, '')
      .split('\n')

    assert.ok(
      lines.slice(1).every((line) => line.length <= 60),
      lines.join('\n')
    )
    assert.ok(lines.some((line) => line.includes('`npm install --save-dev elm`')))
  })
})
