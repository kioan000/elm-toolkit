/**
 * Checks the functions of `./runner` inside the test process, on
 * `fixtures/project`: what each one returns, and what it prints. Each case of
 * `RunnerError` has a check.
 *
 * The tests run in the fixture project with the pinned Elm first on the `PATH`.
 * Temporary folders go to a private folder, so the check of their removal sees
 * only the folders of this file.
 *
 * @packageDocumentation
 */

import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { Maybe, type Result, findElmBinary } from '@elm-toolkit/cli-lib'

import { type ElmNamespace, RunnerError, compileProgram, runElm, startMain, startProgram } from '../lib/runner.ts'

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
  process.env.PATH = `${path.dirname(findElmBinary(import.meta.url))}${path.delimiter}${originalEnv.PATH ?? ''}`
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
    assert.match(RunnerError.toCliError(error).summary, /^TODO in module `CrashesOnLoad` on line \d+$/)
  })

  it('prints the compiler command, its summary and the messages of Elm with verbose, and nothing without it', async (t) => {
    const informed = t.mock.method(console, 'info', () => undefined)
    const logged = t.mock.method(console, 'log', () => undefined)

    await compileProgram(['src/Main.elm'], { verbose: true })

    assert.match(String(informed.mock.calls[0]?.arguments[1]), /^\S*elm make src\/Main\.elm --output \S+\.js$/)
    assert.match(String(informed.mock.calls[1]?.arguments[0]), /^ {8}Binary: +\S*elm$/m)
    assert.ok(logged.mock.callCount() >= 1, 'the messages of Elm follow the command')

    informed.mock.resetCalls()
    logged.mock.resetCalls()
    await compileProgram(['src/Main.elm'])

    assert.equal(informed.mock.callCount(), 0)
    assert.equal(logged.mock.callCount(), 0)
  })
})

describe('startMain', () => {
  it('starts Main, makes it the global app, and connects the log and eval ports', async (t) => {
    const logged = t.mock.method(console, 'log', () => undefined)
    const app = valueOf(startMain(valueOf(await compileProgram(['src/Main.elm']))))

    await settle()

    assert.equal((globalThis as { app?: unknown }).app, app)
    // Elm runs a batch port by port, in the order of the compiled code: by name up to 0.19.2, as declared from 0.19.3.
    assert.deepEqual(logged.mock.calls.map((call) => call.arguments[0]).sort(), [
      'Hello from Main',
      'eval can reach function',
    ])
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

  it('explains MainNotStarted with the first line of the message, and the advice about flags', () => {
    const error = RunnerError.toCliError({
      cause: 'Problem with the flags given to your Elm program on initialization.\nExpecting a STRING',
      original: undefined,
      type_: 'MainNotStarted',
    })

    assert.equal(error.summary, 'Problem with the flags given to your Elm program on initialization.')
    assert.equal(error.whatHappened.at(-1), 'Expecting a STRING')
    assert.match(error.solution.withDefault(''), /^Without --ts, Main starts without flags\./)
  })
})

describe('startProgram', () => {
  it('starts Main without a launcher', async () => {
    let started = false
    const Elm = {
      Main: {
        init: () => {
          started = true

          return {}
        },
      },
    } as unknown as ElmNamespace

    valueOf(await startProgram(Elm, undefined))
    assert.ok(started)
  })

  it('gives the Elm object to the launcher when there is one', async () => {
    assert.equal(errorOf(await startProgram({}, 'not-a-function.ts')).type_, 'LauncherNotAFunction')
  })
})

describe('RunnerError.title', () => {
  it('says in a few words what went wrong, for each failure', () => {
    const titles = (
      [
        { compileError: { exitCode: 1, output: '', sources: [], type_: 'CompileFailed' }, type_: 'BuildFailed' },
        {
          compileError: {
            cause: '',
            code: Maybe.Just('ENOENT'),
            original: undefined,
            pathToElm: 'elm',
            type_: 'CompilerNotStarted',
          },
          type_: 'BuildFailed',
        },
        { loadError: { cause: '', original: undefined, type_: 'ScriptFailed' }, type_: 'ProgramNotLoaded' },
        { loadError: { type_: 'NoElmObject' }, type_: 'ProgramNotLoaded' },
        { modules: [], type_: 'NoMain' },
        { cause: '', original: undefined, type_: 'MainNotStarted' },
        { cause: '', launcher: 'main.ts', original: undefined, type_: 'LauncherNotLoaded' },
        { launcher: 'main.ts', type_: 'LauncherNotAFunction' },
        { cause: '', launcher: 'main.ts', original: undefined, type_: 'LauncherFailed' },
      ] as ReadonlyArray<RunnerError>
    ).map(RunnerError.title)

    assert.deepEqual(titles, [
      'Elm code does not compile',
      'Elm compiler not found',
      'Elm program crashed before it started',
      'compiled code is not an Elm program',
      'no Main module to run',
      'Main failed to start',
      'launcher cannot be loaded',
      'launcher exports no function',
      'launcher threw an error',
    ])
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

  it('continues the summary of a launcher that throws in lower case, as after any colon', () => {
    const error = RunnerError.toCliError({
      cause: 'Cannot read properties of undefined',
      launcher: 'src/main.ts',
      original: undefined,
      type_: 'LauncherFailed',
    })

    assert.equal(error.summary, 'src/main.ts: cannot read properties of undefined')
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
