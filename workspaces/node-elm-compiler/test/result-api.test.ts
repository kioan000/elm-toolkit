/**
 * Checks the API that returns a `Result`, with the pinned Elm compiler on the
 * fixture project in `fixtures/app`, and the dependency search on
 * `fixtures/imports`. Each failure is checked through its `kind`, and through
 * the message that `CompileError.toCliError` gives a person.
 *
 * @packageDocumentation
 */

import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { CliError, Maybe, type Result } from '@elm-toolkit/cli-lib'

import {
  CompileError,
  type CompilerOptions,
  compile,
  compileSync,
  compileToString,
  compileToStringSync,
  compileWorker,
  dryCompile,
  findAllDependencies,
  prepareProcessArgs,
} from '../result-api.ts'
import { findElmBinary } from './elm-binary.ts'

const elm = findElmBinary()
const missingElm = path.join(import.meta.dirname, 'no-such-elm')
const app = path.join(import.meta.dirname, 'fixtures', 'app')
const imports = path.join(import.meta.dirname, 'fixtures', 'imports')
const source = (name: string): string => path.join(app, 'src', `${name}.elm`)
const inApp: CompilerOptions = { cwd: app, pathToElm: elm }

/**
 * Takes the error out of a result that must have failed.
 *
 * @param result - the result
 * @returns its error
 */
function errorOf<A>(result: Result<CompileError, A>): CompileError {
  switch (result.tag) {
    case 'Ok':
      return assert.fail('expected an Err')
    case 'Err':
      return result.error
  }
}

/**
 * Takes the value out of a result that must have succeeded.
 *
 * @param result - the result
 * @returns its value
 */
function valueOf<A>(result: Result<CompileError, A>): A {
  switch (result.tag) {
    case 'Ok':
      return result.value
    case 'Err':
      return assert.fail(`expected an Ok, got ${CliError.toString(CompileError.toCliError(result.error))}`)
  }
}

/**
 * A compiler that writes the given text and exits, in place of Elm. It records
 * the arguments it received.
 *
 * @param run - what the compiler writes to each stream, in order, and its exit code
 * @param received - receives the arguments of each run
 * @returns a function with the shape of the `spawn` option
 */
function fakeCompiler(
  run: { exitCode: number; writes: ReadonlyArray<['stderr' | 'stdout', string]> },
  received: string[][] = []
): CompilerOptions['spawn'] {
  return (_command: string, args: string[]) => {
    const compiler = Object.assign(new EventEmitter(), { stderr: new EventEmitter(), stdout: new EventEmitter() })

    received.push(args)
    setImmediate(() => {
      for (const [stream, text] of run.writes) {
        compiler[stream].emit('data', text)
      }
      compiler.emit('close', run.exitCode)
    })

    return compiler as never
  }
}

function temporaryDirectories(): string[] {
  return readdirSync(tmpdir()).filter((name) => name.startsWith('node-elm-compiler-'))
}

describe('prepareProcessArgs', () => {
  it('turns the flag options into elm make flags', () => {
    assert.deepEqual(valueOf(prepareProcessArgs(['src/Main.elm'], { debug: true, output: 'main.js' })), [
      'make',
      'src/Main.elm',
      '--debug',
      '--output',
      'main.js',
    ])
  })

  it('returns an unknown option as an error, with a hint for the options that Elm 0.19 removed', () => {
    assert.deepEqual(errorOf(prepareProcessArgs('src/Main.elm', { optimise: true })), {
      hint: 'Remove "optimise", or correct its spelling. The known options are: cwd, debug, docs, help, optimize, output, pathToElm, processOpts, report, runtimeOptions, spawn, verbose.',
      kind: 'unknownOption',
      option: 'optimise',
    })
    assert.deepEqual(errorOf(prepareProcessArgs('src/Main.elm', { pathToMake: 'elm-make' })), {
      hint: 'Rename "pathToMake" to "pathToElm". Elm 0.19 renamed that option.',
      kind: 'unknownOption',
      option: 'pathToMake',
    })
  })
})

describe('compile', () => {
  it('names the binary in an error event, and keeps the message of the system for the compile error', async () => {
    const compiler = valueOf(compile(source('Main'), { ...inApp, pathToElm: missingElm }))
    const error = await new Promise<Error>((resolve) => {
      compiler.on('error', resolve)
    })

    assert.match(error.message, /Could not find Elm compiler/)

    const reported = errorOf(await dryCompile(source('Main'), { ...inApp, pathToElm: missingElm }))

    assert.match(reported.kind === 'compilerNotStarted' ? reported.cause : '', /^spawn .* ENOENT$/)
  })

  it('returns the running process, which closes with code zero', async () => {
    const output = path.join(mkdtempSync(path.join(tmpdir(), 'result-api-')), 'main.js')

    try {
      const compiler = valueOf(compile(source('Main'), { ...inApp, output, processOpts: { stdio: 'ignore' } }))
      const exitCode = await new Promise((resolve) => {
        compiler.on('close', resolve)
      })

      assert.equal(exitCode, 0)
      assert.ok(existsSync(output))
    } finally {
      rmSync(path.dirname(output), { force: true, recursive: true })
    }
  })

  it('returns an unknown option as an error, before it starts anything', () => {
    let started = false
    const outcome = compile(source('Main'), {
      spawn: () => {
        started = true

        throw new Error('should not run')
      },
      yes: true,
    })

    assert.equal(errorOf(outcome).kind, 'unknownOption')
    assert.equal(started, false)
  })

  it('returns a spawn function that throws as a compiler that did not start', () => {
    const outcome = compile(source('Main'), {
      pathToElm: '/opt/elm',
      spawn: () => {
        throw Object.assign(new Error('spawn EACCES'), { code: 'EACCES' })
      },
    })

    assert.deepEqual(errorOf(outcome), {
      cause: 'spawn EACCES',
      code: Maybe.Just('EACCES'),
      kind: 'compilerNotStarted',
      pathToElm: '/opt/elm',
    })
  })
})

describe('compileToString', () => {
  it('returns the generated JavaScript, and removes its temporary directory', async () => {
    const before = temporaryDirectories()

    assert.match(valueOf(await compileToString(source('Main'), inApp)), /Hello from Elm/)
    assert.deepEqual(temporaryDirectories(), before)
  })

  it('returns a type error as a failed build, with the messages of Elm', async () => {
    const error = errorOf(await compileToString(source('Broken'), inApp))

    assert.equal(error.kind, 'compileFailed')
    assert.match(error.kind === 'compileFailed' ? error.output : '', /TYPE MISMATCH/)
  })

  it('returns a missing binary as a compiler that did not start', async () => {
    const error = errorOf(await compileToString(source('Main'), { ...inApp, pathToElm: missingElm }))

    assert.equal(error.kind, 'compilerNotStarted')
    assert.deepEqual(error.kind === 'compilerNotStarted' ? error.code : undefined, Maybe.Just('ENOENT'))
  })
})

describe('dryCompile', () => {
  it('keeps only the problems of a first build, without the downloads and the progress', async () => {
    const spawn = fakeCompiler({
      exitCode: 1,
      writes: [
        [
          'stdout',
          'Starting downloads...\n\n  ● elm/core 1.0.5\n\nVerifying dependencies (0/7)\rDependencies ready!    \n',
        ],
        ['stdout', 'Compiling ...'],
        ['stderr', '-- TYPE MISMATCH ----- src/Broken.elm\n\nSomething is off.\n'],
        ['stdout', '\rDetected problems in 1 module.\n'],
      ],
    })
    const error = errorOf(await dryCompile('src/Broken.elm', { spawn }))

    assert.equal(
      error.kind === 'compileFailed' ? error.output : '',
      '-- TYPE MISMATCH ----- src/Broken.elm\n\nSomething is off.\n'
    )
  })

  it('leaves out the docs option, which would write a file', async () => {
    const received: string[][] = []

    valueOf(
      await dryCompile('src/Main.elm', {
        docs: 'docs.json',
        spawn: fakeCompiler({ exitCode: 0, writes: [] }, received),
      })
    )
    assert.deepEqual(received, [['make', 'src/Main.elm', '--output', '/dev/null']])
  })

  it('succeeds for a program that compiles, and writes nothing', async () => {
    const before = temporaryDirectories()
    const filesBefore = readdirSync(app)

    assert.equal(valueOf(await dryCompile(source('Main'), inApp)), undefined)
    assert.deepEqual(temporaryDirectories(), before)
    assert.deepEqual(readdirSync(app), filesBefore, 'no output should appear next to the project')
  })

  it('ignores an output that the caller asked for', async () => {
    const output = path.join(mkdtempSync(path.join(tmpdir(), 'result-api-')), 'main.js')

    try {
      valueOf(await dryCompile(source('Main'), { ...inApp, output }))
      assert.equal(existsSync(output), false)
    } finally {
      rmSync(path.dirname(output), { force: true, recursive: true })
    }
  })

  it('returns a type error as a failed build, with the messages of Elm', async () => {
    const error = errorOf(await dryCompile(source('Broken'), inApp))

    assert.equal(error.kind, 'compileFailed')
    assert.match(error.kind === 'compileFailed' ? error.output : '', /^-- TYPE MISMATCH/, 'no progress line before it')
  })

  it('returns a missing binary as a compiler that did not start', async () => {
    assert.equal(
      errorOf(await dryCompile(source('Main'), { ...inApp, pathToElm: missingElm })).kind,
      'compilerNotStarted'
    )
  })
})

describe('compileSync and compileToStringSync', () => {
  const quiet: CompilerOptions = { ...inApp, processOpts: { stdio: 'pipe' } }

  it('returns the messages of the compiler when the build succeeds, without the progress line', () => {
    // Elm prints Success! only when it compiled something; with a warm cache it prints nothing.
    assert.doesNotMatch(valueOf(compileSync(source('Main'), { ...quiet, output: '/dev/null' })), /Compiling/)
  })

  it('returns a type error as a failed build, with its exit code', () => {
    const error = errorOf(compileSync(source('Broken'), { ...quiet, output: '/dev/null' }))

    assert.equal(error.kind, 'compileFailed')
    assert.equal(error.kind === 'compileFailed' ? error.exitCode : undefined, 1)
  })

  it('returns a missing binary as a compiler that did not start', () => {
    assert.equal(errorOf(compileSync(source('Main'), { ...quiet, pathToElm: missingElm })).kind, 'compilerNotStarted')
  })

  it('returns the generated JavaScript as text', () => {
    assert.match(valueOf(compileToStringSync(source('Main'), quiet)), /Hello from Elm/)
  })

  it('returns a type error as a failed build', () => {
    assert.equal(errorOf(compileToStringSync(source('Broken'), quiet)).kind, 'compileFailed')
  })
})

describe('compileWorker', () => {
  /**
   * Starts a worker from the fixture project, with the pinned compiler first on
   * the `PATH`, because `compileWorker` has no option to choose the binary.
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
    const worker = valueOf(await startWorker('Doubler', 'Doubler', { flags: 3 }))
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

  it('returns a wrong module name with the modules that exist', async () => {
    assert.deepEqual(errorOf(await startWorker('Doubler', 'Dubler', { flags: 3 })), {
      file: 'src/Doubler.elm',
      kind: 'moduleNotFound',
      moduleName: 'Dubler',
      suggestions: ['Doubler'],
    })
  })

  it('returns flags of the wrong type as a worker that did not start', async () => {
    const error = errorOf(await startWorker('Doubler', 'Doubler', { flags: 'not a number' }))

    assert.equal(error.kind, 'workerNotStarted')
    assert.match(error.kind === 'workerNotStarted' ? error.cause : '', /Problem with the flags/)
  })

  it('returns a module without ports as an error', async () => {
    assert.deepEqual(errorOf(await startWorker('NoPorts', 'NoPorts')), {
      file: 'src/NoPorts.elm',
      kind: 'noPorts',
      moduleName: 'NoPorts',
    })
  })

  it('returns a type error as a failed build, with the messages of Elm', async () => {
    const error = errorOf(await startWorker('Broken', 'Broken'))

    assert.equal(error.kind, 'compileFailed')
    assert.match(error.kind === 'compileFailed' ? error.output : '', /TYPE MISMATCH/)
  })
})

describe('findAllDependencies', () => {
  it('lists the local imports of a module', async () => {
    const found = valueOf(await findAllDependencies(path.join(imports, 'src', 'Page', 'Home.elm')))

    assert.ok(found.includes(path.join(imports, 'vendor', 'Api.elm')), 'an import from the second source directory')
    assert.ok(found.includes(path.join(imports, 'src', 'Ui', 'Button.elm')))
  })

  it('returns a missing file as an error, and logs nothing', async (t) => {
    const logged = t.mock.method(console, 'error', () => undefined)
    const file = path.join(imports, 'src', 'Missing.elm')
    const error = errorOf(await findAllDependencies(file))

    assert.equal(error.kind, 'entryNotRead')
    assert.equal(logged.mock.callCount(), 0)
  })

  it('returns a broken module declaration as an error', async () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'result-api-'))
    const file = path.join(folder, 'Broken.elm')

    try {
      writeFileSync(file, 'module \n')
      assert.deepEqual(errorOf(await findAllDependencies(file)), { file, kind: 'invalidModule' })
    } finally {
      rmSync(folder, { force: true, recursive: true })
    }
  })
})

describe('CompileError.toCliError', () => {
  it('points to the flags when a worker did not start', () => {
    const error = CompileError.toCliError({
      cause: 'Problem with the flags given to your Elm program on initialization.',
      file: 'src/Doubler.elm',
      kind: 'workerNotStarted',
      moduleName: 'Doubler',
    })

    assert.equal(error.summary, 'compileWorker: the module "Doubler" failed to start.')
    assert.match(error.solution.withDefault(''), /flags passed to compileWorker/)
  })

  it('names the temporary folder that could not be used', () => {
    const error = CompileError.toCliError({ cause: 'ENOSPC', folder: '/tmp', kind: 'tempFolderNotCreated' })

    assert.match(error.solution.withDefault(''), /Check that \/tmp exists/)
  })

  it('names a missing compiler and says how to install it', () => {
    const error = CompileError.toCliError({
      cause: 'spawn elm ENOENT',
      code: Maybe.Just('ENOENT'),
      kind: 'compilerNotStarted',
      pathToElm: 'elm',
    })

    assert.equal(error.summary, 'The Elm compiler "elm" was not found.')
    assert.match(error.solution.withDefault(''), /npm install --save-dev elm/)
  })

  it('keeps the messages of Elm as the details of a failed build, and points to them', () => {
    const error = CompileError.toCliError({
      exitCode: 1,
      kind: 'compileFailed',
      output: '-- TYPE MISMATCH --\n\nline\n',
      sources: ['src/Broken.elm'],
    })

    assert.equal(error.summary, 'Could not compile src/Broken.elm.')
    assert.deepEqual(error.whatHappened, ['The Elm compiler reported an error.'])
    assert.deepEqual(error.details, ['-- TYPE MISMATCH --', '', 'line'])
    assert.match(error.solution.withDefault(''), /Follow the instructions of the Elm compiler/)
  })

  it('uses the hint of an option that Elm 0.19 removed as the solution', () => {
    const error = CompileError.toCliError({
      hint: 'Remove "yes" from the options. Elm 0.19 removed it.',
      kind: 'unknownOption',
      option: 'yes',
    })

    assert.deepEqual(error.solution, Maybe.Just('Remove "yes" from the options. Elm 0.19 removed it.'))
  })

  it('suggests the modules that exist for a wrong module name', () => {
    const error = CompileError.toCliError({
      file: 'src/Doubler.elm',
      kind: 'moduleNotFound',
      moduleName: 'Dubler',
      suggestions: ['Doubler'],
    })

    assert.equal(error.summary, 'compileWorker: src/Doubler.elm has no module called "Dubler".')
    assert.equal(error.solution.withDefault(''), 'Change moduleName from "Dubler" to "Doubler".')
  })

  it('explains why a worker without ports is an error, and where to learn about ports', () => {
    const error = CompileError.toCliError({ file: 'src/NoPorts.elm', kind: 'noPorts', moduleName: 'NoPorts' })

    assert.equal(error.summary, 'compileWorker: attempt to compile a worker without ports.')
    assert.match(error.whatHappened.join('\n'), /only through ports/)
    assert.match(error.solution.withDefault(''), /guide\.elm-lang\.org\/interop\/ports/)
  })

  it('asks for a bug report when the output cannot be read', () => {
    const error = CompileError.toCliError({ cause: 'ENOENT', file: '/tmp/elm-output.js', kind: 'outputNotRead' })

    assert.match(error.solution.withDefault(''), /bug of node-elm-compiler/)
  })
})
