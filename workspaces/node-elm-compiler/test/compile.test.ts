/**
 * Checks how the compiler wrapper turns options into a command line, runs the
 * compiler, and reports a failure.
 *
 * The tests that build code run the real Elm 0.19.2 compiler from the `elm` dev
 * dependency, on the project in `fixtures/app`. The first run
 * on a machine downloads the Elm packages that the project needs.
 *
 * @packageDocumentation
 */

import type { ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  type CompilerOptions,
  type CompilerProcessOptions,
  _prepareProcessArgs,
  compile,
  compileSync,
  compileToString,
  compileToStringSync,
  compileWorker,
} from '../index.ts'
import { findElmBinary } from './elm-binary.ts'

const elm = findElmBinary()
const missingElm = path.join(import.meta.dirname, 'no-such-elm')
const app = path.join(import.meta.dirname, 'fixtures', 'app')
const source = (name: string): string => path.join(app, 'src', `${name}.elm`)
const inApp: CompilerOptions = { cwd: app, pathToElm: elm }

// Present only when Elm adds the debugger; the name alone also appears in builds without it.
const debuggerDefinition = /var _Debugger_element = F4/

/**
 * Waits until a compiler process has closed.
 *
 * @param compiler - the process returned by `compile`
 * @returns the exit code, and the error the process emitted before it closed, if any
 */
function settle(compiler: ChildProcess): Promise<{ code: number | null; error?: Error }> {
  return new Promise((resolve) => {
    let error: Error | undefined

    compiler.on('error', (err) => {
      error = err
    })
    compiler.on('close', (code) => resolve({ code, error }))
  })
}

/**
 * Lists the temporary directories that `compileToString` creates.
 *
 * @returns the names of those directories that exist now
 */
function temporaryDirectories(): string[] {
  return readdirSync(tmpdir()).filter((name) => name.startsWith('node-elm-compiler-'))
}

describe('_prepareProcessArgs', () => {
  it('turns each flag option into the matching elm make flag', () => {
    const args = _prepareProcessArgs(['src/Main.elm', 'src/Admin.elm'], {
      debug: true,
      docs: 'docs.json',
      optimize: true,
      output: 'dist/main.js',
      report: 'json',
      runtimeOptions: ['-A128M', '-H1G'],
    })

    assert.deepEqual(args, [
      'make',
      'src/Main.elm',
      'src/Admin.elm',
      '--debug',
      '--docs',
      'docs.json',
      '--optimize',
      '--output',
      'dist/main.js',
      '--report',
      'json',
      '+RTS',
      '-A128M',
      '-H1G',
      '-RTS',
    ])
  })

  it('adds nothing for false flags or for options about the process', () => {
    const args = _prepareProcessArgs('src/Main.elm', {
      cwd: '/app',
      debug: false,
      optimize: undefined,
      pathToElm: '/usr/local/bin/elm',
      verbose: true,
    })

    assert.deepEqual(args, ['make', 'src/Main.elm'])
  })

  it('rejects an option it does not know, and names it', () => {
    assert.throws(
      () => _prepareProcessArgs('src/Main.elm', { optimise: true }),
      /unrecognized Elm compiler option: optimise/
    )
  })

  it('explains the options that Elm 0.19 removed or renamed', () => {
    assert.throws(() => _prepareProcessArgs('src/Main.elm', { yes: true }), /removed in Elm 0\.19/)
    assert.throws(() => _prepareProcessArgs('src/Main.elm', { pathToMake: 'elm-make' }), /renamed to `pathToElm`/)
  })

  it('rejects sources that are neither a path nor a list of paths', () => {
    assert.throws(
      () => _prepareProcessArgs(42, {}),
      (thrown) => String(thrown).includes('neither an Array nor a String')
    )
  })
})

describe('compile', () => {
  it('starts the given binary in the given directory, with the caller environment added', () => {
    let received: { args: string[]; command: string; options: CompilerProcessOptions } | undefined
    const options: CompilerOptions = {
      cwd: '/app',
      pathToElm: '/opt/elm',
      processOpts: { env: { ELM_HOME: '/cache/elm' } },
      spawn: (command: string, args: string[], spawnOptions: CompilerProcessOptions) => {
        received = { args, command, options: spawnOptions }

        return { on: () => ({}) as never }
      },
    }

    compile('src/Main.elm', options)

    assert.equal(received?.command, '/opt/elm')
    assert.deepEqual(received?.args, ['make', 'src/Main.elm'])
    assert.equal(received?.options.cwd, '/app')
    assert.equal(received?.options.env?.ELM_HOME, '/cache/elm', 'the caller variable should be passed')
    assert.equal(received?.options.env?.PATH, process.env.PATH, 'the current environment should be kept')
  })

  it('reports a missing binary as an error event instead of crashing the process', async () => {
    const result = await settle(compile('src/Main.elm', { pathToElm: missingElm, processOpts: { stdio: 'pipe' } }))

    assert.notEqual(result.code, 0)
    assert.equal(result.error?.message, `Could not find Elm compiler "${missingElm}". Is it installed?`)
  })

  it('builds the program and closes with code zero', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'elm-output-'))
    const output = path.join(directory, 'main.js')

    try {
      const result = await settle(compile([source('Main')], { ...inApp, output, processOpts: { stdio: 'pipe' } }))

      assert.equal(result.code, 0)
      assert.match(readFileSync(output, 'utf8'), /Hello from Elm/)
    } finally {
      rmSync(directory, { force: true, recursive: true })
    }
  })

  it('closes with a non-zero code when the program has a type error', async () => {
    const result = await settle(compile([source('Broken')], { ...inApp, processOpts: { stdio: 'pipe' } }))

    assert.notEqual(result.code, 0)
  })

  it('reports a missing binary through the close event when nobody listens for errors', async () => {
    const compiler = compile('src/Main.elm', { pathToElm: missingElm, processOpts: { stdio: 'pipe' } })
    const code = await new Promise((resolve) => {
      compiler.on('close', resolve)
    })

    assert.notEqual(code, 0)
  })
})

describe('compileToString', () => {
  it('returns the generated JavaScript, and removes its temporary directory', async () => {
    const before = temporaryDirectories()
    const javascript = await compileToString(source('Main'), inApp)

    assert.match(javascript, /Hello from Elm/)
    assert.deepEqual(temporaryDirectories(), before)
  })

  it('adds the debugger with debug, and leaves it out with optimize', async () => {
    assert.match(await compileToString(source('Counter'), { ...inApp, debug: true }), debuggerDefinition)
    assert.doesNotMatch(await compileToString(source('Counter'), { ...inApp, optimize: true }), debuggerDefinition)
  })

  it('produces a page when the requested output ends in .html', async () => {
    const page = await compileToString(source('Main'), { ...inApp, output: 'index.html' })

    assert.match(page, /^<!DOCTYPE HTML>/)
  })

  it('resolves relative sources from the given directory', async () => {
    assert.match(await compileToString('src/Main.elm', inApp), /Hello from Elm/)
  })

  it('rejects with the compiler message when the program has a type error', async () => {
    await assert.rejects(compileToString(source('Broken'), inApp), /TYPE MISMATCH/)
  })

  it('removes its temporary directory when the build fails', async () => {
    const before = temporaryDirectories()

    await assert.rejects(compileToString(source('Broken'), inApp))

    assert.deepEqual(temporaryDirectories(), before)
  })

  it('passes the report format to the compiler', async () => {
    await assert.rejects(compileToString(source('Broken'), { ...inApp, report: 'json' }), (error: Error) => {
      const report = JSON.parse(error.message.slice(error.message.indexOf('{')))

      assert.equal(report.errors[0].problems[0].title, 'TYPE MISMATCH')

      return true
    })
  })

  it('rejects with a readable message when the binary is missing', async () => {
    await assert.rejects(
      compileToString(source('Main'), { ...inApp, pathToElm: missingElm }),
      /Could not find Elm compiler/
    )
  })
})

describe('compileSync and compileToStringSync', () => {
  const quiet: CompilerOptions = { ...inApp, processOpts: { stdio: 'ignore' } }

  it('waits for the compiler and returns its exit status', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'elm-output-'))
    const output = path.join(directory, 'main.js')

    try {
      assert.equal(compileSync(source('Main'), { ...quiet, output }).status, 0)
      assert.ok(existsSync(output))
    } finally {
      rmSync(directory, { force: true, recursive: true })
    }
  })

  it('returns the generated JavaScript as text', () => {
    assert.match(compileToStringSync(source('Main'), quiet), /Hello from Elm/)
  })

  it('throws when the program has a type error', () => {
    assert.throws(
      () => compileToStringSync(source('Broken'), quiet),
      (thrown) => thrown === 'Compilation failed.'
    )
  })
})

describe('compileWorker', () => {
  /**
   * Starts a worker from the fixture project. `compileWorker` has no option to
   * choose the binary, so the directory of the pinned compiler goes first on the
   * `PATH` while it runs.
   *
   * @param file - the name of the Elm file in `src`, without the extension
   * @param moduleName - the module to start
   * @param workerArgs - the argument of `init`
   * @returns whatever `compileWorker` returns
   */
  function startWorker(file: string, moduleName: string, workerArgs?: unknown): ReturnType<typeof compileWorker> {
    const originalPath = process.env.PATH

    process.env.PATH = `${path.dirname(elm)}${path.delimiter}${originalPath}`

    return compileWorker(app, `src/${file}.elm`, moduleName, workerArgs).finally(() => {
      process.env.PATH = originalPath
    })
  }

  it('starts the module, which answers through its ports', async () => {
    const worker = await startWorker('Doubler', 'Doubler', { flags: 3 })
    const ports = worker.ports as {
      input: { send: (value: number) => void }
      output: { subscribe: (listener: (value: number) => void) => void }
    }
    const answer = new Promise((resolve) => {
      ports.output.subscribe(resolve)
    })

    ports.input.send(14)

    assert.equal(await answer, 42)
  })

  it('leaves the working directory of the process unchanged, and removes its temporary directory', async () => {
    const before = process.cwd()
    const directoriesBefore = temporaryDirectories()
    let cwdDuringCompile = before
    const watcher = setInterval(() => {
      cwdDuringCompile = process.cwd() === before ? cwdDuringCompile : process.cwd()
    }, 1)

    try {
      await startWorker('Doubler', 'Doubler', { flags: 3 })
    } finally {
      clearInterval(watcher)
    }

    assert.equal(cwdDuringCompile, before, 'the working directory should not change while the compiler runs')
    assert.equal(process.cwd(), before)
    assert.deepEqual(temporaryDirectories(), directoriesBefore)
  })

  it('suggests the module that exists when the name is wrong', async () => {
    await assert.rejects(
      startWorker('Doubler', 'Dubler', { flags: 3 }),
      /couldn't find the entry module Dubler[^]*Maybe you meant: Doubler/
    )
  })

  it('refuses a module without ports', async () => {
    await assert.rejects(startWorker('NoPorts', 'NoPorts'), /doesn't expose any ports/)
  })

  it('fails when the program has a type error', async () => {
    await assert.rejects(startWorker('Broken', 'Broken'), /Errored with exit code 1/)
  })
})
