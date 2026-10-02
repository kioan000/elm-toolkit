/**
 * Checks that the plugin patches the Elm kernel when webpack creates a compiler,
 * and that a failed patch stops webpack.
 *
 * Every test runs in a temporary `ELM_HOME` and a temporary Elm project, so the
 * real `~/.elm` is never touched. Webpack calls the `initialize` hook while it
 * creates the compiler, so creating one is enough and no build runs.
 *
 * @packageDocumentation
 */

import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'

import createWebpackCompiler from 'webpack'

import ElmKernelPatcherPlugin from '../index.ts'
import { findElmBinary } from './elm-binary.ts'

// The versions of the packages inside the patch archive of the patcher.
const patchedVersions = {
  'elm/browser': '1.0.2',
  'elm/core': '1.0.5',
  'elm/html': '1.0.1',
  'elm/virtual-dom': '1.0.5',
}

// The Elm versions that the patcher supports.
const supportedElmVersions = ['0.19.1', '0.19.2']

// The patcher extracts its archive next to its own module, inside the installed package.
const extractedPatches = path.join(
  path.dirname(fileURLToPath(import.meta.resolve('@elm-toolkit/cli-elm-kernel-patcher/patcher'))),
  'patches'
)

let elmHome: string
let project: string
let originalElmHome: string | undefined
let printed: ReturnType<typeof mock.method>

/**
 * Writes an `elm.json` that pins the given versions as direct dependencies.
 *
 * @param versions - the package names mapped to the versions to pin
 * @param elmVersion - the version of Elm that the project declares
 */
function writeElmJson(versions: Record<string, string>, elmVersion = '0.19.1'): void {
  const elmJson = {
    dependencies: { direct: versions, indirect: {} },
    'elm-version': elmVersion,
    'source-directories': ['src'],
    'test-dependencies': { direct: {}, indirect: {} },
    type: 'application',
  }

  writeFileSync(path.join(project, 'elm.json'), JSON.stringify(elmJson))
}

/**
 * Creates a webpack compiler with the plugin, which runs the `initialize` hook.
 *
 * @param plugin - the plugin to attach
 */
function createCompiler(plugin: ElmKernelPatcherPlugin): void {
  createWebpackCompiler({ context: project, entry: './src/index.js', mode: 'none', plugins: [plugin] })
}

/**
 * Builds the path of one patched file inside the temporary `ELM_HOME`.
 *
 * @param packageName - the package, for example `elm/virtual-dom`
 * @param elmVersion - the Elm version whose package folder holds the file
 * @returns the path of the `source.txt` file that the patcher copies with each package
 */
function sourceRecord(packageName: keyof typeof patchedVersions, elmVersion: string): string {
  return path.join(elmHome, elmVersion, 'packages', packageName, patchedVersions[packageName], 'source.txt')
}

describe('ElmKernelPatcherPlugin', () => {
  beforeEach(() => {
    elmHome = mkdtempSync(path.join(tmpdir(), 'elm-home-'))
    project = mkdtempSync(path.join(tmpdir(), 'elm-project-'))
    originalElmHome = process.env.ELM_HOME
    process.env.ELM_HOME = elmHome

    // The patcher and the plugin report every step; the tests read the files instead.
    printed = mock.method(console, 'info', () => undefined)
  })

  afterEach(() => {
    mock.restoreAll()
    // Assigning undefined would store the string "undefined", so a variable that was not set is removed.
    if (originalElmHome === undefined) {
      delete process.env.ELM_HOME
    } else {
      process.env.ELM_HOME = originalElmHome
    }
    rmSync(elmHome, { force: true, recursive: true })
    rmSync(project, { force: true, recursive: true })
  })

  for (const elmVersion of supportedElmVersions) {
    it(`copies the patched packages into the ${elmVersion} folder of ELM_HOME when webpack starts`, () => {
      writeElmJson(patchedVersions, elmVersion)

      createCompiler(new ElmKernelPatcherPlugin({ elmHome, elmJsonFolder: project, isEnabled: true }))

      for (const packageName of Object.keys(patchedVersions) as Array<keyof typeof patchedVersions>) {
        assert.ok(existsSync(sourceRecord(packageName, elmVersion)), `${packageName} should be patched`)
      }
      assert.deepEqual(readdirSync(elmHome), [elmVersion], 'only the folder of that version should change')
    })

    it(`removes the ${elmVersion} cache of the project, so Elm compiles again`, () => {
      const elmStuff = path.join(project, 'elm-stuff', elmVersion)

      writeElmJson(patchedVersions, elmVersion)
      mkdirSync(elmStuff, { recursive: true })

      createCompiler(new ElmKernelPatcherPlugin({ elmHome, elmJsonFolder: project, isEnabled: true }))

      assert.equal(existsSync(elmStuff), false)
    })
  }

  it('makes the Elm 0.19.2 compiler build against the patched kernel', () => {
    const fixture = path.join(import.meta.dirname, 'fixtures', 'project')
    const output = path.join(elmHome, 'main.js')
    const compile = (home: string | undefined, to: string): void => {
      const env = { ...process.env, ELM_HOME: home }

      if (home === undefined) {
        delete env.ELM_HOME
      }
      execFileSync(findElmBinary(), ['make', 'src/Main.elm', `--output=${to}`], { cwd: fixture, env, stdio: 'ignore' })
    }

    // The first build fills the usual ELM_HOME, which CI caches, so the temporary one is a copy
    // and the packages are downloaded once; the usual ELM_HOME itself is never patched.
    compile(originalElmHome, '/dev/null')
    cpSync(path.join(originalElmHome ?? path.join(homedir(), '.elm'), '0.19.2'), path.join(elmHome, '0.19.2'), {
      recursive: true,
    })
    rmSync(path.join(fixture, 'elm-stuff'), { force: true, recursive: true })

    createCompiler(new ElmKernelPatcherPlugin({ elmHome, elmJsonFolder: fixture, isEnabled: true }))
    compile(elmHome, output)

    const compiled = readFileSync(output, 'utf8')
    const scope: { Elm?: { hot?: { reload?: unknown } } } = {}

    // Running the compiled code only defines the program; nothing renders until init is called.
    mock.method(console, 'warn', () => undefined)
    new Function(compiled).call(scope)

    // Only the patched elm/virtual-dom defines this function, and only the patched elm/core offers Elm.hot.
    assert.match(compiled, /_VirtualDom_createTNode/)
    assert.equal(typeof scope.Elm?.hot?.reload, 'function', 'a development build should reload itself')
  })

  it('stops webpack when elm.json pins a version that the patches do not cover', () => {
    writeElmJson({ ...patchedVersions, 'elm/virtual-dom': '1.0.3' })

    assert.throws(
      () => createCompiler(new ElmKernelPatcherPlugin({ elmHome, elmJsonFolder: project, isEnabled: true })),
      /Expected version 1\.0\.5[^]*elm\/virtual-dom[^]*1\.0\.3/
    )
    assert.deepEqual(readdirSync(elmHome), [], 'nothing should be copied')
    assert.equal(existsSync(extractedPatches), false, 'the extracted archive should be removed')
    assert.ok(
      printed.mock.calls.some((call) => String(call.arguments[0]).includes('ERROR:[ElmKernelPatcherPlugin]')),
      'the plugin should print its own failure message'
    )
  })

  // 0.19.0 is not supported, and a package declares a range instead of one version.
  for (const elmVersion of ['0.19.0', '0.19.0 <= v < 0.20.0']) {
    it(`stops webpack, before touching anything, when elm.json declares ${elmVersion}`, () => {
      writeElmJson(patchedVersions, elmVersion)

      assert.throws(
        () => createCompiler(new ElmKernelPatcherPlugin({ elmHome, elmJsonFolder: project, isEnabled: true })),
        (thrown) =>
          thrown instanceof Error &&
          thrown.message.includes(`The patches support Elm 0.19.1 and 0.19.2, but elm.json declares ${elmVersion}.`)
      )
      assert.deepEqual(readdirSync(elmHome), [], 'nothing should be copied')
      assert.equal(existsSync(extractedPatches), false, 'nothing should be extracted')
    })
  }

  it('stops webpack when there is no elm.json', () => {
    assert.throws(
      () => createCompiler(new ElmKernelPatcherPlugin({ elmHome, elmJsonFolder: project, isEnabled: true })),
      /Failed to read elm\.json/
    )
  })

  it('resolves a relative elmHome against the elm.json folder, and uses it as the ELM_HOME of the process', () => {
    writeElmJson(patchedVersions)

    createCompiler(
      new ElmKernelPatcherPlugin({ elmHome: 'elm-home/elm-stuff', elmJsonFolder: project, isEnabled: true })
    )

    const dedicated = path.join(project, 'elm-home', 'elm-stuff')

    // The Elm loader starts the compiler later in this process, so it reads the same folder.
    assert.equal(process.env.ELM_HOME, dedicated)
    assert.ok(existsSync(path.join(dedicated, '0.19.1', 'packages', 'elm', 'core', '1.0.5', 'source.txt')))
    assert.deepEqual(readdirSync(elmHome), [], 'the ELM_HOME of the environment should stay untouched')
  })

  it("keeps the ELM_HOME of the environment with elmHome: 'default'", () => {
    writeElmJson(patchedVersions)

    createCompiler(new ElmKernelPatcherPlugin({ elmHome: 'default', elmJsonFolder: project, isEnabled: true }))

    assert.equal(process.env.ELM_HOME, elmHome)
    assert.ok(existsSync(sourceRecord('elm/core', '0.19.1')))
  })

  it('patches when the isEnabled function says so, and passes it the compiler', () => {
    const modes: Array<string | undefined> = []

    writeElmJson(patchedVersions)

    createCompiler(
      new ElmKernelPatcherPlugin({
        elmHome,
        elmJsonFolder: project,
        isEnabled: (compiler): boolean => {
          modes.push(compiler.options.mode)

          return true
        },
      })
    )

    assert.deepEqual(modes, ['none'])
    assert.ok(existsSync(sourceRecord('elm/core', '0.19.1')))
  })

  it('touches nothing when the isEnabled function says no', () => {
    writeElmJson(patchedVersions)

    createCompiler(
      new ElmKernelPatcherPlugin({
        elmHome: 'elm-home/elm-stuff',
        elmJsonFolder: project,
        isEnabled: (): boolean => false,
      })
    )

    assert.equal(process.env.ELM_HOME, elmHome, 'ELM_HOME should not change')
    assert.equal(existsSync(path.join(project, 'elm-home')), false)
    assert.deepEqual(readdirSync(elmHome), [])
  })

  it('stops webpack when the isEnabled function throws', () => {
    writeElmJson(patchedVersions)

    assert.throws(
      () =>
        createCompiler(
          new ElmKernelPatcherPlugin({
            elmHome,
            elmJsonFolder: project,
            isEnabled: (): boolean => {
              throw new Error('no mode given')
            },
          })
        ),
      /no mode given/
    )
  })

  it('stops webpack when it may patch but elmHome is missing', () => {
    writeElmJson(patchedVersions)

    assert.throws(
      // @ts-expect-error elmHome is required unless isEnabled is false; plain JavaScript can still leave it out.
      () => createCompiler(new ElmKernelPatcherPlugin({ elmJsonFolder: project, isEnabled: true })),
      /The plugin is enabled but elmHome is missing; set it to 'default' or to a folder\./
    )
    assert.deepEqual(readdirSync(elmHome), [], 'nothing should be copied')
  })

  it('does nothing when it is disabled', () => {
    writeElmJson(patchedVersions)

    createCompiler(new ElmKernelPatcherPlugin({ elmJsonFolder: project, isEnabled: false }))

    assert.deepEqual(readdirSync(elmHome), [])
  })
})
