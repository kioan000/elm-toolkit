/**
 * Checks the functions of `@elm-toolkit/elm-node-runner/runner` from inside the
 * test process, on the Elm project in `fixtures/project`: what each one returns,
 * what it throws, and what it prints.
 *
 * These checks fix the behaviour of the current API, so that a change of its
 * implementation cannot change it unnoticed. The compiler is called by name, so
 * the pinned Elm compiler goes first on the `PATH`, and the functions run in
 * the fixture project, because the compiler looks for `elm.json` there. Each
 * test file runs in its own process, so these changes stay in this file.
 * Temporary folders go to a folder of this file alone, whose name does not start
 * like theirs, so that the checks of their removal here and in the command tests
 * do not see each other's folders.
 *
 * @packageDocumentation
 */

import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { compileProgram, runElm, startMain } from '../lib/runner.ts'
import { findElmBinary } from './elm-binary.ts'

const project = path.join(import.meta.dirname, 'fixtures', 'project')
const originalDirectory = process.cwd()
const originalEnv = { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR }
const privateTemporary = mkdtempSync(path.join(tmpdir(), 'runner-api-tests-'))

/**
 * Lists the temporary folders that the runner left behind.
 *
 * @returns the names of the folders in the temporary folder of this file
 */
function leftovers(): string[] {
  return readdirSync(privateTemporary)
}

/**
 * Waits until the queued work of Elm has run, such as a value sent through a
 * port by `init`.
 *
 * @returns a promise that resolves after the queue
 */
function settle(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

before(() => {
  process.chdir(project)
  process.env.PATH = `${path.dirname(findElmBinary())}${path.delimiter}${originalEnv.PATH ?? ''}`
  process.env.TMPDIR = privateTemporary
})

after(() => {
  process.chdir(originalDirectory)
  process.env.PATH = originalEnv.PATH

  if (originalEnv.TMPDIR === undefined) {
    Reflect.deleteProperty(process.env, 'TMPDIR')
  } else {
    process.env.TMPDIR = originalEnv.TMPDIR
  }

  rmSync(privateTemporary, { force: true, recursive: true })
})

describe('compileProgram', () => {
  it('returns the Elm object, with one entry for each compiled module', async () => {
    const Elm = await compileProgram(['src/Main.elm', 'src/Greeter.elm'])

    assert.ok(typeof Elm.Main?.init === 'function')
    assert.ok(typeof Elm.Greeter?.init === 'function')
  })

  it('removes its temporary folder after a build that succeeds', async () => {
    await compileProgram(['src/Main.elm'])

    assert.deepEqual(leftovers(), [])
  })

  it('rejects a type error with an Error whose message is only the summary', async () => {
    await assert.rejects(compileProgram(['src/Broken.elm']), (error) => {
      assert.ok(error instanceof Error)
      assert.equal(error.message, 'The Elm compiler reported an error.')

      return true
    })
  })

  it('removes its temporary folder after a build that fails', async () => {
    await compileProgram(['src/Broken.elm']).catch(() => undefined)

    assert.deepEqual(leftovers(), [])
  })

  it('rejects a missing compiler with an Error that names it', async () => {
    const pathWithElm = process.env.PATH

    process.env.PATH = privateTemporary

    const compiled = compileProgram(['src/Main.elm']).finally(() => {
      process.env.PATH = pathWithElm
    })

    await assert.rejects(compiled, (error) => {
      assert.ok(error instanceof Error)
      assert.equal(error.message, 'Could not find Elm compiler "elm". Is it installed?')

      return true
    })
  })

  it('prints the compiler command with verbose, and nothing of its own without it', async (t) => {
    const logged = t.mock.method(console, 'log', () => undefined)

    await compileProgram(['src/Main.elm'], { verbose: true })

    assert.match(String(logged.mock.calls[0]?.arguments[0]), /^Running \S*elm make src\/Main\.elm --output \S+elm\.js$/)

    logged.mock.resetCalls()
    await compileProgram(['src/Main.elm'])

    assert.equal(logged.mock.callCount(), 0)
  })
})

describe('startMain', () => {
  it('starts Main, makes it the global app, and connects the log and eval ports', async (t) => {
    const logged = t.mock.method(console, 'log', () => undefined)
    const app = startMain(await compileProgram(['src/Main.elm']))

    await settle()

    assert.equal((globalThis as { app?: unknown }).app, app)
    assert.deepEqual(
      logged.mock.calls.map((call) => call.arguments[0]),
      ['eval can reach function', 'Hello from Main']
    )
  })

  it('throws an Error that lists the modules when none is called Main', async () => {
    const Elm = await compileProgram(['src/Greeter.elm'])

    assert.throws(
      () => startMain(Elm),
      new Error(
        'No compiled module is called Main; the build exports Greeter. Name the entry module Main, or start the module from a launcher with --ts.'
      )
    )
  })
})

describe('runElm', () => {
  it('gives the launcher the Elm object, without starting any module', async (t) => {
    const logged = t.mock.method(console, 'log', () => undefined)

    await runElm({ elmFiles: ['src/Main.elm', 'src/Greeter.elm'], launcher: 'launcher.ts' })
    await settle()

    assert.deepEqual(
      logged.mock.calls.map((call) => call.arguments[0]),
      ['modules: Greeter,Main', 'Hello, launcher']
    )
  })

  it('rejects a launcher without a function as its default export', async () => {
    await assert.rejects(
      runElm({ elmFiles: ['src/Main.elm'], launcher: 'not-a-function.ts' }),
      new Error('not-a-function.ts must export a function as its default export.')
    )
  })

  it('rejects a build without Main when there is no launcher', async () => {
    await assert.rejects(runElm({ elmFiles: ['src/Greeter.elm'] }), /No compiled module is called Main/)
  })
})
