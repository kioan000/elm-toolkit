/**
 * Checks `Result.attempt`, which turns an exception into an `Err` without
 * changing it, and `CliError`, which turns that exception into an error for a
 * person and prints it.
 *
 * @packageDocumentation
 */

import { execFileSync } from 'node:child_process'
import { afterEach, describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'

import { CliError, Maybe, Result } from '../index.ts'

describe('Result.attempt', () => {
  it('returns Ok with the value of a call that does not throw', () => {
    assert.deepEqual(
      Result.fromAttempt(() => 64),
      Result.Ok(64)
    )
  })

  it('returns Err with the exception itself, of any type', () => {
    const thrown = new RangeError('too far')
    const caught = Result.fromAttempt(() => {
      throw thrown
    })

    switch (caught.tag) {
      case 'Ok':
        return assert.fail('the call should fail')
      case 'Err':
        return assert.equal(caught.error, thrown)
    }
  })
})

describe('CliError', () => {
  afterEach(() => {
    mock.restoreAll()
  })

  it('keeps the summary and what happened as create receives them, without a solution or a trace', () => {
    assert.deepEqual(CliError.create({ summary: 'No patches at nowhere.', whatHappened: ['check the path'] }), {
      details: [],
      solution: Maybe.Nothing,
      summary: 'No patches at nowhere.',
      trace: Maybe.Nothing,
      whatHappened: ['check the path'],
    })
  })

  it('takes what happened from the message of an error of the system, without a trace', () => {
    const missing = Object.assign(new Error("ENOENT: no such file or directory, open 'elm.json'"), { code: 'ENOENT' })
    const error = CliError.fromUnknown('could not read elm.json', missing)

    assert.deepEqual(error.whatHappened, ["ENOENT: no such file or directory, open 'elm.json'"])
    assert.deepEqual(error.trace, Maybe.Nothing)
  })

  it('takes what happened from the standard error of a failed child process, without a trace', () => {
    const caught = Result.fromAttempt(() => execFileSync('git', ['no-such-command'], { stdio: 'pipe' }))

    switch (caught.tag) {
      case 'Ok':
        return assert.fail('git should refuse the command')
      case 'Err': {
        const error = CliError.fromUnknown('git failed', caught.error)

        assert.match(error.whatHappened.join('\n'), /no-such-command/)

        return assert.deepEqual(error.trace, Maybe.Nothing)
      }
    }
  })

  it('keeps the stack of an exception that looks like a bug as the trace', () => {
    const error = CliError.fromUnknown('could not compare the files', new TypeError('list is not iterable'))

    assert.deepEqual(error.whatHappened, ['list is not iterable'])

    switch (error.trace.tag) {
      case 'Just':
        return assert.match(error.trace.value, /^at /)
      case 'Nothing':
        return assert.fail('a likely bug should keep its stack')
    }
  })

  it('treats JSON that does not parse as a problem of the input, without a trace', () => {
    const caught = Result.fromAttempt(() => JSON.parse('{ "patches": [ ') as unknown)

    switch (caught.tag) {
      case 'Ok':
        return assert.fail('the JSON should not parse')
      case 'Err':
        return assert.deepEqual(CliError.fromUnknown('could not read the manifest', caught.error).trace, Maybe.Nothing)
    }
  })

  it('turns a thrown value that is not an Error into what happened', () => {
    assert.deepEqual(CliError.fromUnknown('failed', 'a thrown text').whatHappened, ['a thrown text'])
  })

  it('turns into text with a blank line between the summary and each section', () => {
    const error = CliError.withSolution(
      CliError.create({
        solution: 'first',
        summary: 'patches.tar.gz does not exist.',
        whatHappened: ['in elm-kernel-patcher'],
      }),
      'cli-elm-kernel-patcher archive build'
    )

    assert.equal(
      CliError.toString(error),
      [
        'patches.tar.gz does not exist.',
        '',
        'What happened:',
        '    in elm-kernel-patcher',
        '',
        'How to fix:',
        '    cli-elm-kernel-patcher archive build',
      ].join('\n')
    )
  })

  it('leaves out a section without content', () => {
    assert.equal(CliError.toString(CliError.create({ summary: 'No patches at nowhere.' })), 'No patches at nowhere.')
  })

  it('prints the highlighted summary, then what happened, how to fix it and the stack trace', () => {
    const printed = mock.method(console, 'info', () => undefined)
    const error = CliError.withSolution(
      CliError.fromUnknown('could not read the manifest', new TypeError('broken')),
      'cli-elm-kernel-patcher archive init'
    )

    CliError.print('archive build', error)

    const lines = printed.mock.calls
      .map((call) => call.arguments.join(' '))
      .join('\n')
      .replace(/\x1b\[[0-9;]*m/g, '')
      .split('\n')

    assert.match(lines.find((line) => line.includes('ERROR:')) ?? '', /ERROR:archive build could not read the manifest/)
    assert.deepEqual(lines.slice(lines.indexOf('    What happened:'), lines.indexOf('    What happened:') + 6), [
      '    What happened:',
      '        broken',
      '',
      '    How to fix:',
      '        cli-elm-kernel-patcher archive init',
      '',
    ])
    assert.match(lines[lines.indexOf('    Stack trace:') + 1] ?? '', /^ {8}at /)
  })
})
