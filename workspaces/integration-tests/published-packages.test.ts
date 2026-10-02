/**
 * Checks that the workspaces still work once they are packed and installed.
 *
 * Inside the monorepo a workspace is reached through a symlink that resolves
 * outside `node_modules`, so a broken package can still appear to work. Packing
 * the archives and installing them into an empty project is the only setup that
 * reproduces what a user gets, which is why these tests are slow on purpose.
 *
 * @packageDocumentation
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

const workspaces = [
  '@elm-toolkit/cli-lib',
  '@elm-toolkit/cli-elm-kernel-patcher',
  '@elm-toolkit/node-elm-compiler',
  '@elm-toolkit/webpack-elm-loader',
  '@elm-toolkit/webpack-elm-kernel-patcher-plugin',
  '@elm-toolkit/elm-node-runner',
]

let consumer: string

/**
 * Runs a command and returns its output, with the repository root as the default
 * working directory.
 *
 * @param command - the program to run
 * @param args - the arguments passed to that program
 * @param cwd - the directory to run in
 * @returns whatever the command wrote to standard output, trimmed
 */
function run(command: string, args: string[], cwd: string = repositoryRoot): string {
  return execFileSync(command, args, { cwd, encoding: 'utf8' }).trim()
}

/**
 * Evaluates a module in the consumer project and returns its output.
 *
 * @param source - the module body, which may use top level await
 * @returns whatever the module wrote to standard output, trimmed
 */
function runInConsumer(source: string): string {
  return run(process.execPath, ['--input-type=module', '-e', source], consumer)
}

describe('the published packages', { concurrency: false, timeout: 300_000 }, () => {
  before(() => {
    consumer = mkdtempSync(path.join(tmpdir(), 'elm-toolkit-consumer-'))

    const archives = workspaces.map((workspace) => {
      const archive = path.join(consumer, `${workspace.replace(/[@/]/gu, '-')}.tgz`)

      run('corepack', ['yarn', 'workspace', workspace, 'pack', '-o', archive])

      return archive
    })

    run('npm', ['init', '-y'], consumer)
    run('npm', ['pkg', 'set', 'type=module'], consumer)
    run('npm', ['install', ...archives], consumer)
  })

  after(() => {
    rmSync(consumer, { force: true, recursive: true })
  })

  it('ships the license with every package', () => {
    for (const workspace of workspaces) {
      const installed = path.join(consumer, 'node_modules', workspace)
      const manifest = JSON.parse(readFileSync(path.join(installed, 'package.json'), 'utf8'))

      assert.equal(manifest.license, 'BSD-3-Clause', `${workspace} should declare its license`)
      assert.ok(existsSync(path.join(installed, 'LICENSE')), `${workspace} should contain LICENSE`)
    }
  })

  it('ships the notices of the projects that some packages come from', () => {
    // These packages contain code under the licenses of other authors, which must travel with it.
    const derived = [
      '@elm-toolkit/cli-elm-kernel-patcher',
      '@elm-toolkit/elm-node-runner',
      '@elm-toolkit/node-elm-compiler',
      '@elm-toolkit/webpack-elm-loader',
    ]

    for (const workspace of derived) {
      const notices = path.join(consumer, 'node_modules', workspace, 'THIRD_PARTY_NOTICES.md')

      assert.ok(existsSync(notices), `${workspace} should contain THIRD_PARTY_NOTICES.md`)
    }
  })

  it('installs an executable that runs', () => {
    const manifest = JSON.parse(
      readFileSync(path.join(repositoryRoot, 'workspaces/cli-elm-kernel-patcher/package.json'), 'utf8')
    )

    const reported = run(path.join(consumer, 'node_modules/.bin/cli-elm-kernel-patcher'), ['--version'], consumer)

    assert.equal(reported, manifest.version, 'the executable should report the version from its manifest')
  })

  it('exposes the patching routines on a subpath', () => {
    const exported = runInConsumer(`
      const patcher = await import('@elm-toolkit/cli-elm-kernel-patcher/patcher')
      console.log(Object.keys(patcher).sort().join(','))
    `)

    assert.equal(exported, 'prepareArgs,replaceKernelPackages')
  })

  it('does not run the command when the package is imported', () => {
    const exported = runInConsumer(`
      const command = await import('@elm-toolkit/cli-elm-kernel-patcher')
      console.log(command.default.constructor.name)
    `)

    assert.equal(exported, 'Command', 'importing the package should expose the command without running it')
  })

  it('exposes the shared library', () => {
    const exported = runInConsumer(`
      const library = await import('@elm-toolkit/cli-lib')
      console.log(typeof library.isEntryPoint, typeof library.readPackageJson)
    `)

    assert.equal(exported, 'function function')
  })

  it('exposes the compiler wrapper', () => {
    const exported = runInConsumer(`
      const compiler = await import('@elm-toolkit/node-elm-compiler')
      console.log(Object.keys(compiler).sort().join(','))
    `)

    assert.equal(
      exported,
      '_prepareProcessArgs,compile,compileSync,compileToString,compileToStringSync,compileWorker,findAllDependencies'
    )
  })

  it('exposes both webpack loaders as default exports', () => {
    const exported = runInConsumer(`
      const loader = await import('@elm-toolkit/webpack-elm-loader')
      const hot = await import('@elm-toolkit/webpack-elm-loader/hot')
      console.log(typeof loader.default, typeof hot.default)
    `)

    assert.equal(exported, 'function function')
  })

  it('exposes the kernel patcher plugin as a default export', () => {
    const exported = runInConsumer(`
      const plugin = await import('@elm-toolkit/webpack-elm-kernel-patcher-plugin')
      console.log(typeof plugin.default, typeof new plugin.default({ isEnabled: false }).apply)
    `)

    assert.equal(exported, 'function function')
  })

  it('installs a runner executable that prints its examples', () => {
    const example = run(path.join(consumer, 'node_modules/.bin/elm-node-runner'), ['--example-elm'], consumer)

    assert.match(example, /^port module Main exposing \(main\)/)
  })

  it('does not run the runner when the package is imported', () => {
    const exported = runInConsumer(`
      const runner = await import('@elm-toolkit/elm-node-runner')
      const library = await import('@elm-toolkit/elm-node-runner/runner')
      console.log(typeof runner.main, Object.keys(library).sort().join(','))
    `)

    assert.equal(exported, 'function compileProgram,runElm,startMain')
  })

  it('ships the hot reload runtime that the hot loader reads', () => {
    // The runtime is copied into dist by the build script, outside tsc, so only an installed
    // package shows whether it arrived. The input is the smallest text that ends like Elm output.
    const injected = runInConsumer(`
      const hot = await import('@elm-toolkit/webpack-elm-loader/hot')
      console.log(hot.default('(function(scope){_Platform_export({});}(this));').includes('HMR BEGIN'))
    `)

    assert.equal(injected, 'true')
  })
})
