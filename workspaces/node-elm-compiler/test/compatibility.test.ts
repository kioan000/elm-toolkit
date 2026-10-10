/**
 * Fixes the behaviour of the deprecated API against the original
 * `node-elm-compiler` 5.0.6 and `find-elm-dependencies` 2.0.4, which are no
 * longer maintained.
 *
 * Each check was compared with the original package once, by hand, with the
 * same calls. The first group holds what must stay as the original did it: a
 * failure there is a regression for code written for the original. The second
 * group holds what this package does differently on purpose, and each check
 * says what the original did; the README lists the same differences. A change
 * of behaviour moves a check from one group to the other, or adds one, so that
 * the difference stays written down.
 *
 * @packageDocumentation
 */

/* eslint-disable import-x/no-deprecated -- these tests check the deprecated API, which stays until it is removed */

import type { ChildProcess } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  type CompilerOptions,
  _prepareProcessArgs,
  compile,
  compileSync,
  compileToString,
  compileToStringSync,
  compileWorker,
  findAllDependencies,
} from '../index.ts'
import { findElmBinary } from './elm-binary.ts'

const elm = findElmBinary()
const missingElm = path.join(import.meta.dirname, 'no-such-elm')
const app = path.join(import.meta.dirname, 'fixtures', 'app')
const imports = path.join(import.meta.dirname, 'fixtures', 'imports')
const source = (name: string): string => path.join(app, 'src', `${name}.elm`)
const inApp: CompilerOptions = { cwd: app, pathToElm: elm }
const quiet: CompilerOptions = { ...inApp, processOpts: { stdio: 'pipe' } }

// A spawn option that fails with an Error that has no system code, and one that has the code of a file that cannot run.
const ownError = new Error('own failure')
const throwsOwnError = (): never => {
  throw ownError
}
const throwsEacces = (): never => {
  throw Object.assign(new Error(`spawn ${elm} EACCES`), { code: 'EACCES' })
}
const throwsString = (): never => {
  throw 'the build server is offline'
}

const eaccesMessage = `Elm compiler "${elm}" did not have permission to run. Do you need to give it executable permissions?`
const stringMessage = `Exception thrown when attempting to run Elm compiler ${JSON.stringify(elm)}`
const yesMessage =
  'node-elm-compiler received the `yes` option, but that was removed in Elm 0.19. Try re-running without passing the `yes` option.'

/**
 * Waits until a compiler process has closed.
 *
 * @param compiler - the process that `compile` returned
 * @returns the exit code, and the message of the error the process emitted, if any
 */
function settle(compiler: ChildProcess): Promise<{ code: number | null; message?: string }> {
  return new Promise((resolve) => {
    let message: string | undefined

    compiler.on('error', (err) => {
      message = err.message
    })
    compiler.on('close', (code) => resolve({ code, message }))
  })
}

/**
 * Runs a function with the given `PATH`, and restores the original one after.
 *
 * @param pathValue - the `PATH` to use
 * @param run - the function to run
 * @returns what the function returns
 */
function withPath<A>(pathValue: string, run: () => Promise<A>): Promise<A> {
  const originalPath = process.env.PATH

  process.env.PATH = pathValue

  return run().finally(() => {
    process.env.PATH = originalPath
  })
}

/**
 * Starts a worker from the fixture project, with the pinned compiler first on
 * the `PATH`, because `compileWorker` calls `elm` by name.
 *
 * @param file - the name of the Elm file in `src`, without the extension
 * @param moduleName - the module to start
 * @param workerArgs - the argument of `init`
 * @returns whatever `compileWorker` returns
 */
function startWorker(file: string, moduleName: string, workerArgs?: unknown): ReturnType<typeof compileWorker> {
  return withPath(`${path.dirname(elm)}${path.delimiter}${process.env.PATH ?? ''}`, () =>
    compileWorker(app, `src/${file}.elm`, moduleName, workerArgs)
  )
}

/**
 * Sends a value to a running Doubler and waits for its answer.
 *
 * @param worker - a worker of the Doubler module
 * @param value - the value to send
 * @returns the value that the worker answers
 */
function answer(worker: { ports: Record<string, unknown> }, value: number): Promise<unknown> {
  const ports = worker.ports as {
    input: { send: (value: number) => void }
    output: { subscribe: (listener: (value: unknown) => void) => void }
  }
  const answered = new Promise((resolve) => {
    ports.output.subscribe(resolve)
  })

  ports.input.send(value)

  return answered
}

/**
 * Counts the temporary folders of this package.
 *
 * @returns how many there are
 */
function temporaryFolders(): number {
  return readdirSync(tmpdir()).filter((name) => name.startsWith('node-elm-compiler')).length
}

/**
 * Writes an Elm file into a new temporary folder.
 *
 * @param content - the text of the file
 * @returns the path of the file
 */
function elmFile(content: string): string {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'compatibility-')), 'Main.elm')

  writeFileSync(file, content)

  return file
}

describe('as the original package', () => {
  describe('compile', () => {
    it('closes with code zero for a program that compiles, and with one for a type error', async () => {
      assert.equal((await settle(compile(source('Main'), { ...quiet, output: '/dev/null' }))).code, 0)
      assert.equal((await settle(compile(source('Broken'), { ...quiet, output: '/dev/null' }))).code, 1)
    })

    it('throws a string for a spawn error with a system code, and for a thrown value that is not an Error', () => {
      assert.throws(
        () => compile(source('Main'), { ...inApp, spawn: throwsEacces }),
        (thrown) => thrown === eaccesMessage
      )
      assert.throws(
        () => compile(source('Main'), { ...inApp, spawn: throwsString }),
        (thrown) => thrown === stringMessage
      )
    })
  })

  describe('compileSync', () => {
    it('returns the result of spawnSync: status zero, one for a type error, and the error of a missing binary', () => {
      assert.equal(compileSync(source('Main'), { ...quiet, output: '/dev/null' }).status, 0)
      assert.equal(compileSync(source('Broken'), { ...quiet, output: '/dev/null' }).status, 1)

      const missing = compileSync(source('Main'), { ...quiet, pathToElm: missingElm })

      assert.equal(missing.status, null)
      assert.equal((missing.error as { code?: string } | undefined)?.code, 'ENOENT')
    })

    it('throws the same strings as compile when spawn throws', () => {
      assert.throws(
        () => compileSync(source('Main'), { ...quiet, spawn: throwsEacces }),
        (thrown) => thrown === eaccesMessage
      )
      assert.throws(
        () => compileSync(source('Main'), { ...quiet, spawn: throwsString }),
        (thrown) => thrown === stringMessage
      )
    })
  })

  describe('compileToString', () => {
    it('returns the generated JavaScript', async () => {
      assert.match(await compileToString(source('Main'), inApp), /Hello from Elm/)
    })

    it('rejects with the same strings as compile when spawn throws', async () => {
      await assert.rejects(
        compileToString(source('Main'), { ...inApp, spawn: throwsEacces }),
        (thrown) => thrown === eaccesMessage
      )
      await assert.rejects(
        compileToString(source('Main'), { ...inApp, spawn: throwsString }),
        (thrown) => thrown === stringMessage
      )
    })
  })

  describe('compileToStringSync', () => {
    it('returns the generated JavaScript', () => {
      assert.match(compileToStringSync(source('Main'), quiet), /Hello from Elm/)
    })

    it('throws the string Compilation failed. for a type error, a missing binary, a timeout and a full buffer', () => {
      const failures: ReadonlyArray<[string, CompilerOptions]> = [
        ['Broken', quiet],
        ['Main', { ...quiet, pathToElm: missingElm }],
        ['Main', { ...inApp, processOpts: { stdio: 'pipe', timeout: 1 } }],
        ['Broken', { ...inApp, processOpts: { maxBuffer: 1, stdio: 'pipe' } }],
      ]

      for (const [name, options] of failures) {
        assert.throws(
          () => compileToStringSync(source(name), options),
          (thrown) => thrown === 'Compilation failed.'
        )
      }
    })

    it('throws the same strings as compile when spawn throws', () => {
      assert.throws(
        () => compileToStringSync(source('Main'), { ...quiet, spawn: throwsEacces }),
        (thrown) => thrown === eaccesMessage
      )
      assert.throws(
        () => compileToStringSync(source('Main'), { ...quiet, spawn: throwsString }),
        (thrown) => thrown === stringMessage
      )
    })
  })

  describe('compileWorker', () => {
    it('returns a worker with only the ports of the program, and adds nothing to the globals', async () => {
      const worker = await startWorker('Doubler', 'Doubler', { flags: 3 })

      assert.deepEqual(Object.keys(worker), ['ports'])
      assert.deepEqual(Object.keys(worker.ports).sort(), ['input', 'output'])
      assert.equal('Elm' in globalThis, false)
    })

    it('gives each call its own instance of the program', async () => {
      const triple = await startWorker('Doubler', 'Doubler', { flags: 3 })
      const quintuple = await startWorker('Doubler', 'Doubler', { flags: 5 })

      assert.deepEqual(await Promise.all([answer(triple, 2), answer(quintuple, 2)]), [6, 10])
    })

    it('accepts a project directory relative to the working directory, and leaves that directory as it was', async () => {
      const before = process.cwd()
      const worker = await withPath(`${path.dirname(elm)}${path.delimiter}${process.env.PATH ?? ''}`, () =>
        compileWorker(path.relative(process.cwd(), app), 'src/Doubler.elm', 'Doubler', { flags: 3 })
      )

      assert.equal(await answer(worker, 7), 21)
      assert.equal(process.cwd(), before)

      await startWorker('Broken', 'Broken').catch(() => undefined)

      assert.equal(process.cwd(), before, 'also after a failure')
    })

    it('rejects a wrong module name with an Error that suggests the modules that exist', async () => {
      await assert.rejects(
        startWorker('Doubler', 'Dubler', { flags: 3 }),
        new Error(
          "I couldn't find the entry module Dubler.\n\nMaybe you meant: Doubler\nYou can pass me a different module to use with --module=<moduleName>"
        )
      )
    })

    it('rejects flags of the wrong type, or missing ones, with an Error that holds the message of Elm', async () => {
      await assert.rejects(startWorker('Doubler', 'Doubler', { flags: 'x' }), (error) => {
        assert.ok(error instanceof Error)
        assert.match(error.message, /^Error: Problem with the flags given to your Elm program on initialization\./)

        return true
      })
      await assert.rejects(startWorker('Doubler', 'Doubler'), (error) => {
        assert.ok(error instanceof Error)
        assert.match(error.message, /^Error: Problem with the flags[^]*undefined/)

        return true
      })
    })
  })

  describe('_prepareProcessArgs', () => {
    it('returns the arguments of elm make, and throws an Error for an option it does not know', () => {
      assert.deepEqual(_prepareProcessArgs('src/Main.elm', { debug: true, output: 'a.js', report: 'json' }), [
        'make',
        'src/Main.elm',
        '--debug',
        '--output',
        'a.js',
        '--report',
        'json',
      ])
      assert.throws(
        () => _prepareProcessArgs('src/Main.elm', { foo: 1 }),
        new Error('node-elm-compiler was given an unrecognized Elm compiler option: foo')
      )
    })
  })

  describe('findAllDependencies', () => {
    it('lists the local imports of a module', async () => {
      assert.ok((await findAllDependencies(path.join(imports, 'src', 'Page', 'Home.elm'))).length > 0)
    })

    it('rejects with the error of the file system when the entry file does not exist', async () => {
      await assert.rejects(findAllDependencies(path.join(imports, 'src', 'Missing.elm')), { code: 'ENOENT' })
    })

    it('returns the known dependencies when the entry file does not exist and the source directories are given', async () => {
      assert.deepEqual(
        await findAllDependencies(
          path.join(imports, 'src', 'Missing.elm'),
          ['/known.elm'],
          [path.join(imports, 'src')]
        ),
        ['/known.elm']
      )
    })

    it('rejects with a string when the first line is not a valid module declaration', async () => {
      const file = elmFile('module \n')

      try {
        await assert.rejects(
          findAllDependencies(file),
          (thrown) =>
            thrown ===
            `${file} is not a syntactically valid Elm module. Try running \`elm make\` on it manually to figure out what the problem is.`
        )
      } finally {
        rmSync(path.dirname(file), { force: true, recursive: true })
      }
    })

    it('accepts a file without a module declaration', async () => {
      const file = elmFile('import Html\nmain = Html.text "hi"\n')

      try {
        assert.deepEqual(await findAllDependencies(file), [])
      } finally {
        rmSync(path.dirname(file), { force: true, recursive: true })
      }
    })
  })
})

describe('unlike the original package, on purpose', () => {
  it('throws an Error for an option it does not know, where the original threw its message as a JSON string', async () => {
    assert.throws(() => compile(source('Main'), { ...inApp, yes: true }), new Error(yesMessage))
    assert.throws(() => compileSync(source('Main'), { ...quiet, yes: true }), new Error(yesMessage))
    await assert.rejects(compileToString(source('Main'), { ...inApp, yes: true }), new Error(yesMessage))
    assert.throws(() => compileToStringSync(source('Main'), { ...quiet, yes: true }), new Error(yesMessage))
  })

  it('throws the Error of a custom spawn unchanged, where the original threw its message as a JSON string', async () => {
    assert.throws(
      () => compile(source('Main'), { ...inApp, spawn: throwsOwnError }),
      (thrown) => thrown === ownError
    )
    assert.throws(
      () => compileSync(source('Main'), { ...quiet, spawn: throwsOwnError }),
      (thrown) => thrown === ownError
    )
    await assert.rejects(
      compileToString(source('Main'), { ...inApp, spawn: throwsOwnError }),
      (thrown) => thrown === ownError
    )
    assert.throws(
      () => compileToStringSync(source('Main'), { ...quiet, spawn: throwsOwnError }),
      (thrown) => thrown === ownError
    )
  })

  it('names the problem of sources that are neither a string nor a list, where the original blamed the compiler', () => {
    assert.throws(
      () => compile(42, inApp),
      (thrown) => thrown === 'compile() received neither an Array nor a String for its sources argument.'
    )
  })

  it('reports a missing binary, where the original crashed the whole process', async () => {
    assert.deepEqual(await settle(compile(source('Main'), { ...quiet, pathToElm: missingElm })), {
      code: -2,
      message: `Could not find Elm compiler "${missingElm}". Is it installed?`,
    })
    await assert.rejects(
      compileToString(source('Main'), { ...inApp, pathToElm: missingElm }),
      new Error(`Compilation failed\nCould not find Elm compiler "${missingElm}". Is it installed?`)
    )

    const empty = mkdtempSync(path.join(tmpdir(), 'compatibility-'))

    try {
      await assert.rejects(
        withPath(empty, () => compileWorker(app, 'src/Doubler.elm', 'Doubler', { flags: 3 })),
        new Error('Could not find Elm compiler "elm". Is it installed?')
      )
    } finally {
      rmSync(empty, { force: true, recursive: true })
    }
  })

  it('keeps only the problems of Elm in a failed compileToString, where the original also kept the progress lines', async () => {
    await assert.rejects(compileToString(source('Broken'), inApp), (error) => {
      assert.ok(error instanceof Error)
      assert.match(error.message, /^Compilation failed\n-- TYPE MISMATCH/)

      return true
    })
  })

  it('holds the problems of Elm in a failed compileWorker, where the original printed them and said only the exit code', async () => {
    await assert.rejects(startWorker('Broken', 'Broken'), (error) => {
      assert.ok(error instanceof Error)
      assert.match(error.message, /^Errored with exit code 1\n-- TYPE MISMATCH/)

      return true
    })
  })

  it('names a module without ports, where the original failed with a TypeError of its own code', async () => {
    await assert.rejects(
      startWorker('NoPorts', 'NoPorts'),
      new Error(
        "The module NoPorts doesn't expose any ports!\n\n\nTry adding something likeport foo : Value\nport foo =\n    someValue\n\nto NoPorts!"
      )
    )
  })

  it('removes the temporary folder of compileWorker at once, where the original removed it when the process ended', async () => {
    const before = temporaryFolders()

    await startWorker('Doubler', 'Doubler', { flags: 3 })

    assert.equal(temporaryFolders(), before)
  })

  it('returns a promise for a file that is already known, where the original returned the array itself', () => {
    const file = path.join(imports, 'src', 'Page', 'Home.elm')

    assert.ok(findAllDependencies(file, ['/known.elm'], [path.join(imports, 'src')], [file]) instanceof Promise)
  })
})
