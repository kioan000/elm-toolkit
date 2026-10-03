/**
 * Checks the Elm loader against a minimal imitation of the webpack loader
 * context: which flags it passes to the compiler, how it reports a failure, and
 * which files it asks webpack to watch.
 *
 * The compiler is the real Elm 0.19.2 from the `elm` dev dependency, and
 * the project is `fixtures/project`. Every run passes that project as `cwd`,
 * because Elm otherwise looks for `elm.json` above the current directory and would
 * find the one at the root of this repository.
 *
 * @packageDocumentation
 */

import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import elmWebpackLoader from '../index.ts'
import { findElmBinary } from './elm-binary.ts'

type LoaderContext = ThisParameterType<typeof elmWebpackLoader>

type LoaderRun = {
  contextDependencies: string[]
  dependencies: string[]
  error: Error | null
  output: string | undefined
}

const project = path.join(import.meta.dirname, 'fixtures', 'project')
const source = (name: string): string => path.join(project, 'src', `${name}.elm`)
const main = source('Main')
const inProject = { cwd: project, pathToElm: findElmBinary() }

// The watch tests below need only what the loader reads before it compiles, and a real compiler
// started in a folder without elm.json would wait for an answer on the terminal.
const missingElm = path.join(import.meta.dirname, 'no-such-elm')

// Present only when Elm adds the debugger; the name alone also appears in builds without it.
const debuggerDefinition = /var _Debugger_element = F4/

/**
 * Runs the loader once, the way webpack would run it for one module.
 *
 * @param settings - the options or query string, the build mode, whether webpack
 * watches, and the module that webpack asks for
 * @returns what the loader passed back to webpack, and the files it asked webpack to watch
 */
async function runLoader(settings: {
  mode?: 'development' | 'none' | 'production'
  query: object | string
  resourcePath?: string
  resourceQuery?: string
  watching?: boolean
}): Promise<LoaderRun> {
  const run: LoaderRun = { contextDependencies: [], dependencies: [], error: null, output: undefined }
  let finish: () => void = () => undefined
  const finished = new Promise<void>((resolve) => {
    finish = resolve
  })

  const context = {
    _compiler: { options: { mode: settings.mode ?? 'development' }, watching: settings.watching ? {} : undefined },
    addContextDependency: (directory: string) => run.contextDependencies.push(directory),
    addDependency: (file: string) => run.dependencies.push(file),
    async:
      () =>
      (error: Error | null, output?: string): void => {
        run.error = error
        run.output = output
        finish()
      },
    cacheable: () => undefined,
    emitError: (error: Error) => {
      run.error = error
    },
    query: settings.query,
    resourcePath: settings.resourcePath ?? main,
    resourceQuery: settings.resourceQuery ?? '',
  } as unknown as LoaderContext

  await elmWebpackLoader.call(context)
  await finished

  return run
}

/**
 * Returns the JavaScript that the loader passed to webpack, after checking that
 * the run succeeded.
 *
 * @param run - the result of `runLoader`
 * @returns the compiled code
 */
function compiled(run: LoaderRun): string {
  assert.equal(run.error, null, 'the loader should succeed')

  return run.output ?? ''
}

describe('the Elm loader', () => {
  it('compiles the requested module with the debugger in development mode', async () => {
    const javascript = compiled(await runLoader({ query: inProject }))

    assert.match(javascript, /Hello from Elm/)
    assert.match(javascript, debuggerDefinition)
  })

  it('compiles an optimized build without the debugger in production mode', async () => {
    const javascript = compiled(await runLoader({ mode: 'production', query: inProject }))

    assert.match(javascript, /Hello from Elm/)
    assert.doesNotMatch(javascript, debuggerDefinition)
  })

  it('lets the options replace the defaults of the mode', async () => {
    assert.doesNotMatch(compiled(await runLoader({ query: { ...inProject, debug: false } })), debuggerDefinition)
  })

  it('reads the options from a query string', async () => {
    const query = `?cwd=${encodeURIComponent(project)}&pathToElm=${encodeURIComponent(inProject.pathToElm)}&debug=false`

    assert.doesNotMatch(compiled(await runLoader({ query })), debuggerDefinition)
  })

  it('compiles the listed files into one bundle instead of the requested module', async () => {
    const javascript = compiled(await runLoader({ query: { ...inProject, files: [main, source('Admin')] } }))

    assert.match(javascript, /Hello from Elm/)
    assert.match(javascript, /Admin panel/)
  })

  it('refuses a files option that is empty or not a list', async () => {
    const empty = await runLoader({ query: { ...inProject, files: [] } })
    const notAList = await runLoader({ query: { ...inProject, files: main } })

    assert.match(empty.error?.message ?? '', /didn't list any files/)
    assert.match(notAList.error?.message ?? '', /must be an array/)
  })

  it('passes a failed build to webpack as an error', async () => {
    const run = await runLoader({ query: inProject, resourcePath: source('Broken') })

    assert.equal(run.error?.message, 'Compiler process exited with error: Compilation failed')
  })

  it('removes its temporary directory when the build fails', async () => {
    const temporaryDirectories = (): string[] => readdirSync(tmpdir()).filter((name) => name.startsWith('elm-webpack-'))
    const before = temporaryDirectories()

    await runLoader({ query: inProject, resourcePath: source('Broken') })

    assert.deepEqual(temporaryDirectories(), before)
  })

  it('passes a missing compiler to webpack as an error instead of crashing', async () => {
    const run = await runLoader({ query: { ...inProject, pathToElm: missingElm } })

    assert.match(run.error?.message ?? '', /Could not find Elm compiler/)
  })

  for (const [kind, elmHome, expected] of [
    ['a relative', 'elm-home/elm-stuff', path.join(project, 'elm-home', 'elm-stuff')],
    ['an absolute', path.join(tmpdir(), 'elm-home'), path.join(tmpdir(), 'elm-home')],
  ]) {
    it(`starts the compiler with ${kind} elmHome as ELM_HOME, resolved against cwd`, async () => {
      const directory = mkdtempSync(path.join(tmpdir(), 'elm-loader-home-'))
      const record = path.join(directory, 'elm-home.txt')
      const fakeElm = path.join(directory, 'elm')

      // A stand-in for the compiler that only records the Elm home it receives.
      writeFileSync(fakeElm, `#!/bin/sh\nprintf '%s' "$ELM_HOME" > '${record}'\nexit 1\n`, { mode: 0o755 })

      try {
        await runLoader({ query: { cwd: project, elmHome, pathToElm: fakeElm } })

        assert.equal(readFileSync(record, 'utf8'), expected)
      } finally {
        rmSync(directory, { force: true, recursive: true })
      }
    })
  }

  it('watches elm.json, the source directories and every local module the entry imports', async () => {
    const run = await runLoader({ query: inProject, watching: true })

    assert.deepEqual(run.dependencies, [path.join(project, 'elm.json'), source('Greeting')])
    assert.deepEqual(run.contextDependencies, [path.join(project, 'src')])
  })

  it('ignores the query of the requested module when the rule has no options', async () => {
    const originalPath = process.env.PATH
    const originalCwd = process.cwd()

    // Without options the loader finds the compiler on the PATH and the project in the current directory.
    process.env.PATH = `${path.dirname(inProject.pathToElm)}${path.delimiter}${originalPath}`
    process.chdir(project)

    const run = runLoader({ query: '', resourceQuery: '?v=2' }).finally(() => {
      process.env.PATH = originalPath
      process.chdir(originalCwd)
    })

    assert.match(compiled(await run), /Hello from Elm/)
  })

  it('watches the src folder of a package, whose elm.json lists no source directories', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'elm-package-'))

    try {
      writeFileSync(path.join(directory, 'elm.json'), JSON.stringify({ type: 'package' }))

      const run = await runLoader({ query: { cwd: directory, pathToElm: missingElm }, watching: true })

      assert.deepEqual(run.contextDependencies, [path.join(directory, 'src')])
    } finally {
      rmSync(directory, { force: true, recursive: true })
    }
  })

  it('leaves a missing elm.json to the compiler instead of failing to read it', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'elm-nothing-'))

    try {
      const run = await runLoader({ query: { cwd: directory, pathToElm: missingElm }, watching: true })

      assert.match(run.error?.message ?? '', /Could not find Elm compiler/, 'the error should come from the compiler')
      assert.deepEqual(run.contextDependencies, [])
    } finally {
      rmSync(directory, { force: true, recursive: true })
    }
  })

  it('watches nothing outside watch mode', async () => {
    const run = await runLoader({ query: inProject })

    assert.deepEqual(run.dependencies, [])
    assert.deepEqual(run.contextDependencies, [])
  })
})
