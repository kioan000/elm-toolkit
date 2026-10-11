/**
 * Checks the functions of `./runner` inside the test process, on
 * `fixtures/project`: what each one returns, and what it prints. Each case of
 * `RunnerError` has a check.
 *
 * The tests run in the fixture project with the pinned Elm first on the `PATH`.
 * Temporary folders go to a private folder, so the check of their removal does
 * not see the folders of the command tests, which run in parallel.
 *
 * @packageDocumentation
 */

import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { type Result } from '@elm-toolkit/cli-lib'

import { type ElmNamespace, RunnerError, compileProgram, runElm, startMain } from '../lib/runner.ts'
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

/**
 * Takes the value out of a result that must have succeeded.
 *
 * @param result - the result
 * @returns its value
 */
function valueOf<A>(result: Result<RunnerError, A>): A {
  switch (result.type_) {
    case 'Ok':
      return result.value
    case 'Err':
      return assert.fail(`expected an Ok, got ${JSON.stringify(RunnerError.toCliError(result.error).summary)}`)
  }
}

/**
 * Takes the error out of a result that must have failed.
 *
 * @param result - the result
 * @returns its error
 */
function errorOf<A>(result: Result<RunnerError, A>): RunnerError {
  switch (result.type_) {
    case 'Ok':
      return assert.fail('expected an Err')
    case 'Err':
      return result.error
  }
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
    const Elm = valueOf(await compileProgram(['src/Main.elm', 'src/Greeter.elm']))

    assert.deepEqual(Object.keys(Elm).sort(), ['Greeter', 'Main'])
    assert.equal(typeof Elm.Main?.init, 'function')
  })

  it('removes its temporary folder after a build that succeeds, and after one that fails', async () => {
    await compileProgram(['src/Main.elm'])
    await compileProgram(['src/Broken.elm'])

    assert.deepEqual(leftovers(), [])
  })

  it('returns a type error as BuildFailed, with the messages of Elm', async () => {
    const error = errorOf(await compileProgram(['src/Broken.elm']))

    assert.equal(error.type_, 'BuildFailed')
    assert.equal(error.type_ === 'BuildFailed' ? error.compileError.type_ : undefined, 'CompileFailed')
    assert.match(RunnerError.toCliError(error).details.join('\n'), /TYPE MISMATCH/)
  })

  it('returns a missing compiler as BuildFailed, with a compiler that did not start', async () => {
    const pathWithElm = process.env.PATH

    process.env.PATH = privateTemporary

    const compiled = compileProgram(['src/Main.elm']).finally(() => {
      process.env.PATH = pathWithElm
    })
    const error = errorOf(await compiled)

    assert.equal(error.type_ === 'BuildFailed' ? error.compileError.type_ : undefined, 'CompilerNotStarted')
  })

  it('returns a program that throws while it loads as ProgramNotLoaded', async () => {
    const error = errorOf(await compileProgram(['src/CrashesOnLoad.elm']))

    assert.equal(error.type_, 'ProgramNotLoaded')
    assert.equal(RunnerError.toCliError(error).summary, 'The compiled Elm program failed while it loaded.')
  })

  it('prints the compiler command and the messages of Elm with verbose, and nothing without it', async (t) => {
    const logged = t.mock.method(console, 'log', () => undefined)

    await compileProgram(['src/Main.elm'], { verbose: true })

    assert.match(String(logged.mock.calls[0]?.arguments[0]), /^Running \S*elm make src\/Main\.elm --output \S+\.js$/)
    assert.ok(logged.mock.callCount() >= 2, 'the messages of Elm follow the command')

    logged.mock.resetCalls()
    await compileProgram(['src/Main.elm'])

    assert.equal(logged.mock.callCount(), 0)
  })
})

describe('startMain', () => {
  it('starts Main, makes it the global app, and connects the log and eval ports', async (t) => {
    const logged = t.mock.method(console, 'log', () => undefined)
    const app = valueOf(startMain(valueOf(await compileProgram(['src/Main.elm']))))

    await settle()

    assert.equal((globalThis as { app?: unknown }).app, app)
    assert.deepEqual(
      logged.mock.calls.map((call) => call.arguments[0]),
      ['eval can reach function', 'Hello from Main']
    )
  })

  it('returns NoMain with the modules of the build when none is called Main', async () => {
    const Elm = valueOf(await compileProgram(['src/Greeter.elm']))

    assert.deepEqual(errorOf(startMain(Elm)), { modules: ['Greeter'], type_: 'NoMain' })
  })

  it('lists a module whose name has a dot with its full name in NoMain', () => {
    const Elm = {
      Tools: {
        Echo: {
          init: () => {
            return {}
          },
        },
      },
    } as unknown as ElmNamespace

    assert.deepEqual(errorOf(startMain(Elm)), { modules: ['Tools.Echo'], type_: 'NoMain' })
  })

  it('returns NoMain when Main is only the first part of a nested module, such as Main.Report', () => {
    const Elm = {
      Main: {
        Report: {
          init: () => {
            return {}
          },
        },
      },
    } as unknown as ElmNamespace

    assert.deepEqual(errorOf(startMain(Elm)), { modules: ['Main.Report'], type_: 'NoMain' })
  })

  it('returns MainNotStarted when the init of Main throws', () => {
    const failure = new Error('Problem with the flags given to your Elm program on initialization.')
    const Elm: ElmNamespace = {
      Main: {
        init: () => {
          throw failure
        },
      },
    }

    assert.deepEqual(errorOf(startMain(Elm)), {
      cause: 'Problem with the flags given to your Elm program on initialization.',
      original: failure,
      type_: 'MainNotStarted',
    })
  })

  it('explains MainNotStarted with the advice about flags', () => {
    const error = RunnerError.toCliError({
      cause: 'Problem with the flags',
      original: undefined,
      type_: 'MainNotStarted',
    })

    assert.equal(error.summary, 'The module Main failed to start.')
    assert.match(error.solution.withDefault(''), /^Without --ts, Main starts without flags\./)
  })
})

describe('runElm', () => {
  it('gives the launcher the Elm object, without starting any module', async (t) => {
    const logged = t.mock.method(console, 'log', () => undefined)

    valueOf(await runElm({ elmFiles: ['src/Main.elm', 'src/Greeter.elm'], launcher: 'launcher.ts' }))
    await settle()

    assert.deepEqual(
      logged.mock.calls.map((call) => call.arguments[0]),
      ['modules: Greeter,Main', 'Hello, launcher']
    )
  })

  it('returns LauncherNotAFunction for a launcher without a function as its default export', async () => {
    assert.deepEqual(errorOf(await runElm({ elmFiles: ['src/Main.elm'], launcher: 'not-a-function.ts' })), {
      launcher: 'not-a-function.ts',
      type_: 'LauncherNotAFunction',
    })
  })

  it('returns LauncherNotLoaded for a launcher that Node cannot import', async () => {
    const error = errorOf(await runElm({ elmFiles: ['src/Main.elm'], launcher: 'cannot-load.ts' }))

    assert.equal(error.type_, 'LauncherNotLoaded')
    assert.match(error.type_ === 'LauncherNotLoaded' ? error.cause : '', /enum is not supported/)
  })

  it('returns LauncherFailed for a launcher that throws', async () => {
    const error = errorOf(await runElm({ elmFiles: ['src/Main.elm'], launcher: 'throws.ts' }))

    assert.equal(error.type_, 'LauncherFailed')
    assert.equal(error.type_ === 'LauncherFailed' ? error.cause : '', 'the launcher broke')
  })

  it('returns NoMain for a build without Main when there is no launcher', async () => {
    assert.equal(errorOf(await runElm({ elmFiles: ['src/Greeter.elm'] })).type_, 'NoMain')
  })
})
