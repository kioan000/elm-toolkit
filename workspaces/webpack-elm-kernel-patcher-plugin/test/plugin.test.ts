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

import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'

import createWebpackCompiler from 'webpack'

import ElmKernelReplacementPlugin from '../index.ts'

// The versions of the packages inside the patch archive of the patcher.
const patchedVersions = { 'elm/browser': '1.0.2', 'elm/html': '1.0.1', 'elm/virtual-dom': '1.0.5' }

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
function createCompiler(plugin: ElmKernelReplacementPlugin): void {
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

describe('ElmKernelReplacementPlugin', () => {
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
    process.env.ELM_HOME = originalElmHome
    rmSync(elmHome, { force: true, recursive: true })
    rmSync(project, { force: true, recursive: true })
  })

  for (const elmVersion of supportedElmVersions) {
    it(`copies the patched packages into the ${elmVersion} folder of ELM_HOME when webpack starts`, () => {
      writeElmJson(patchedVersions, elmVersion)

      createCompiler(new ElmKernelReplacementPlugin({ elmJsonFolder: project, isEnabled: true }))

      for (const packageName of Object.keys(patchedVersions) as Array<keyof typeof patchedVersions>) {
        assert.ok(existsSync(sourceRecord(packageName, elmVersion)), `${packageName} should be patched`)
      }
      assert.deepEqual(readdirSync(elmHome), [elmVersion], 'only the folder of that version should change')
    })

    it(`removes the ${elmVersion} cache of the project, so Elm compiles again`, () => {
      const elmStuff = path.join(project, 'elm-stuff', elmVersion)

      writeElmJson(patchedVersions, elmVersion)
      mkdirSync(elmStuff, { recursive: true })

      createCompiler(new ElmKernelReplacementPlugin({ elmJsonFolder: project, isEnabled: true }))

      assert.equal(existsSync(elmStuff), false)
    })
  }

  it('stops webpack when elm.json pins a version that the patches do not cover', () => {
    writeElmJson({ ...patchedVersions, 'elm/virtual-dom': '1.0.3' })

    assert.throws(
      () => createCompiler(new ElmKernelReplacementPlugin({ elmJsonFolder: project, isEnabled: true })),
      /Expected version 1\.0\.5[^]*elm\/virtual-dom[^]*1\.0\.3/
    )
    assert.deepEqual(readdirSync(elmHome), [], 'nothing should be copied')
    assert.equal(existsSync(extractedPatches), false, 'the extracted archive should be removed')
    assert.ok(
      printed.mock.calls.some((call) => String(call.arguments[0]).includes('ERROR:[ElmKernelReplacementPlugin]')),
      'the plugin should print its own failure message'
    )
  })

  // 0.19.0 is not supported, and a package declares a range instead of one version.
  for (const elmVersion of ['0.19.0', '0.19.0 <= v < 0.20.0']) {
    it(`stops webpack, before touching anything, when elm.json declares ${elmVersion}`, () => {
      writeElmJson(patchedVersions, elmVersion)

      assert.throws(
        () => createCompiler(new ElmKernelReplacementPlugin({ elmJsonFolder: project, isEnabled: true })),
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
      () => createCompiler(new ElmKernelReplacementPlugin({ elmJsonFolder: project, isEnabled: true })),
      /Failed to read elm\.json/
    )
  })

  it('does nothing when it is disabled', () => {
    writeElmJson(patchedVersions)

    createCompiler(new ElmKernelReplacementPlugin({ elmJsonFolder: project, isEnabled: false }))

    assert.deepEqual(readdirSync(elmHome), [])
  })
})
