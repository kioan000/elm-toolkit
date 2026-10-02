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

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'

import { prepareArgs } from '@elm-toolkit/cli-elm-kernel-patcher/patcher'
import createWebpackCompiler from 'webpack'

import ElmKernelReplacementPlugin from '../index.ts'

// The versions of the packages inside the patch archive of the patcher.
const patchedVersions = { 'elm/browser': '1.0.2', 'elm/html': '1.0.1', 'elm/virtual-dom': '1.0.5' }

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
 * @returns the path of the `source.txt` file that the patcher copies with each package
 */
function sourceRecord(packageName: keyof typeof patchedVersions): string {
  return path.join(elmHome, '0.19.1', 'packages', packageName, patchedVersions[packageName], 'source.txt')
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

  it('copies the patched packages into ELM_HOME when webpack starts', () => {
    writeElmJson(patchedVersions)

    createCompiler(new ElmKernelReplacementPlugin({ elmJsonFolder: project, isEnabled: true }))

    for (const packageName of Object.keys(patchedVersions) as Array<keyof typeof patchedVersions>) {
      assert.ok(existsSync(sourceRecord(packageName)), `${packageName} should be patched`)
    }
  })

  it('removes the compiled cache of the project, so Elm compiles again', () => {
    const elmStuff = path.join(project, 'elm-stuff', '0.19.1')

    writeElmJson(patchedVersions)
    mkdirSync(elmStuff, { recursive: true })

    createCompiler(new ElmKernelReplacementPlugin({ elmJsonFolder: project, isEnabled: true }))

    assert.equal(existsSync(elmStuff), false)
  })

  it('stops webpack when elm.json pins a version that the patches do not cover', () => {
    writeElmJson({ ...patchedVersions, 'elm/virtual-dom': '1.0.3' })

    assert.throws(
      () => createCompiler(new ElmKernelReplacementPlugin({ elmJsonFolder: project, isEnabled: true })),
      /Expected version 1\.0\.5[^]*elm\/virtual-dom[^]*1\.0\.3/
    )
    assert.equal(existsSync(path.join(elmHome, '0.19.1')), false, 'nothing should be copied')
    assert.equal(existsSync(prepareArgs(true).PATCH_DIR), false, 'the extracted archive should be removed')
    assert.ok(
      printed.mock.calls.some((call) => String(call.arguments[0]).includes('ERROR:[ElmKernelReplacementPlugin]')),
      'the plugin should print its own failure message'
    )
  })

  it('stops webpack when the project is not an Elm 0.19.1 project', () => {
    writeElmJson(patchedVersions, '0.19.2')

    assert.throws(
      () => createCompiler(new ElmKernelReplacementPlugin({ elmJsonFolder: project, isEnabled: true })),
      /The patches are for Elm 0\.19\.1, but elm\.json declares 0\.19\.2/
    )
    assert.equal(existsSync(path.join(elmHome, '0.19.1')), false, 'nothing should be copied')
    assert.equal(existsSync(prepareArgs(true).PATCH_DIR), false, 'nothing should be extracted')
  })

  it('stops webpack when there is no elm.json', () => {
    assert.throws(
      () => createCompiler(new ElmKernelReplacementPlugin({ elmJsonFolder: project, isEnabled: true })),
      /Failed to parse elm\.json/
    )
  })

  it('does nothing when it is disabled', () => {
    writeElmJson(patchedVersions)

    createCompiler(new ElmKernelReplacementPlugin({ elmJsonFolder: project, isEnabled: false }))

    assert.equal(existsSync(path.join(elmHome, '0.19.1')), false)
  })
})
