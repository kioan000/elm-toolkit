/**
 * Checks that `CliSuccess` keeps its parts and prints them in the layout of
 * `CliError`.
 *
 * @packageDocumentation
 */

import { afterEach, describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'

import { CliSuccess, Maybe } from '../index.ts'

describe('CliSuccess', () => {
  afterEach(() => {
    mock.restoreAll()
  })

  it('keeps the summary, what happened and the next step that create receives', () => {
    assert.deepEqual(CliSuccess.create({ summary: 'The archive matches the manifest.' }), {
      next: Maybe.Nothing,
      summary: 'The archive matches the manifest.',
      whatHappened: [],
    })
    assert.deepEqual(
      CliSuccess.create({ next: 'Patch.', summary: 'Built.', whatHappened: ['elm/core 1.0.5'] }).next,
      Maybe.Just('Patch.')
    )
  })

  it('prints the highlighted summary, then what happened and the next step, after blank lines', () => {
    const printed = mock.method(console, 'info', () => undefined)

    CliSuccess.print(
      'archive build',
      CliSuccess.create({
        next: 'Give the folder to the patcher.',
        summary: 'Built elm-kernel-patcher/patches.tar.gz from 1 commits.',
        whatHappened: ['elm/core 1.0.5 from https://github.com/lydell/core.git at 310bb9e'],
      })
    )

    const lines = printed.mock.calls
      .map((call) => call.arguments.join(' '))
      .join('\n')
      .replace(/\x1b\[[0-9;]*m/g, '')
      .split('\n')

    assert.deepEqual(lines, [
      '',
      'DONE:archive build Built elm-kernel-patcher/patches.tar.gz from 1 commits.',
      '',
      '    What happened:',
      '        elm/core 1.0.5 from https://github.com/lydell/core.git at 310bb9e',
      '',
      '    Next step:',
      '        Give the folder to the patcher.',
    ])
  })
})
