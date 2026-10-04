/**
 * Checks the dependency search on a small Elm project in `fixtures/imports`. The
 * project is only read, never compiled, which is why it may hold an import cycle.
 *
 * In that project `Main` imports `Page.Home` and `Ui.Button`, `Page.Home`
 * imports `Api` from a second source directory, and `Ui.Button` imports
 * `Page.Home` back, so the search meets a cycle. `Ui.Icon` is imported only by
 * `Main`, after the comments in its import section, and `Ui.Badge` only after a
 * block comment that fits on one line. Every module also imports `Html`,
 * which comes from a package and has no local file.
 *
 * @packageDocumentation
 */

/* eslint-disable import-x/no-deprecated -- these tests check the deprecated API, which stays until it is removed */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { findAllDependencies } from '../find-elm-dependencies.ts'

const project = path.join(import.meta.dirname, 'fixtures', 'imports')
const source = (relativePath: string): string => path.join(project, relativePath)

describe('findAllDependencies', () => {
  it('lists direct and indirect imports across every source directory', async () => {
    const dependencies = await findAllDependencies(source('src/Main.elm'))

    assert.deepEqual(
      [...dependencies].sort(),
      [
        source('src/Page/Home.elm'),
        source('src/Ui/Badge.elm'),
        source('src/Ui/Button.elm'),
        source('src/Ui/Icon.elm'),
        source('vendor/Api.elm'),
      ].sort()
    )
  })

  it('reads imports across line comments, block comments and multi line exposing lists', async () => {
    const dependencies = await findAllDependencies(source('src/Main.elm'))

    assert.ok(dependencies.includes(source('src/Ui/Icon.elm')), 'the import after the comments should be found')
  })

  it('reads imports after a block comment that opens and closes on one line', async () => {
    const dependencies = await findAllDependencies(source('src/Main.elm'))

    assert.ok(dependencies.includes(source('src/Ui/Badge.elm')), 'the import after the comment should be found')
  })

  it('notices a change to elm.json, so a new source directory counts at once', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'find-elm-dependencies-'))
    const writeSourceDirectories = (directories: string[]): void =>
      writeFileSync(path.join(directory, 'elm.json'), JSON.stringify({ 'source-directories': directories }))

    try {
      mkdirSync(path.join(directory, 'src'))
      mkdirSync(path.join(directory, 'lib'))
      writeFileSync(
        path.join(directory, 'src', 'Main.elm'),
        'module Main exposing (main)\n\nimport Extra\n\nmain = Extra.value\n'
      )
      writeFileSync(path.join(directory, 'lib', 'Extra.elm'), 'module Extra exposing (value)\n\nvalue = 1\n')

      writeSourceDirectories(['src'])
      assert.deepEqual(await findAllDependencies(path.join(directory, 'src', 'Main.elm')), [])

      writeSourceDirectories(['src', 'lib'])
      assert.deepEqual(await findAllDependencies(path.join(directory, 'src', 'Main.elm')), [
        path.join(directory, 'lib', 'Extra.elm'),
      ])
    } finally {
      rmSync(directory, { force: true, recursive: true })
    }
  })

  it('finds an elm.json that was created after a search that found none', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'find-elm-dependencies-'))
    const main = path.join(directory, 'src', 'Main.elm')

    try {
      mkdirSync(path.join(directory, 'src'))
      writeFileSync(main, 'module Main exposing (main)\n\nimport Extra\n\nmain = Extra.value\n')
      writeFileSync(path.join(directory, 'src', 'Extra.elm'), 'module Extra exposing (value)\n\nvalue = 1\n')

      assert.deepEqual(await findAllDependencies(main), [])

      writeFileSync(path.join(directory, 'elm.json'), JSON.stringify({ 'source-directories': ['src'] }))
      assert.deepEqual(await findAllDependencies(main), [path.join(directory, 'src', 'Extra.elm')])
    } finally {
      rmSync(directory, { force: true, recursive: true })
    }
  })

  it('starts from a port module as well', async () => {
    const dependencies = await findAllDependencies(source('src/Page/Home.elm'))

    assert.ok(dependencies.includes(source('src/Ui/Button.elm')))
    assert.ok(dependencies.includes(source('vendor/Api.elm')))
  })

  it('stops at an import cycle, and then lists the start file as well', async () => {
    const dependencies = await findAllDependencies(source('src/Page/Home.elm'))

    assert.deepEqual(
      [...dependencies].sort(),
      [source('src/Page/Home.elm'), source('src/Ui/Button.elm'), source('vendor/Api.elm')].sort()
    )
  })

  it('returns nothing for a module without local imports', async () => {
    assert.deepEqual(await findAllDependencies(source('vendor/Api.elm')), [])
  })

  it('uses the source directories it is given instead of elm.json', async () => {
    const dependencies = await findAllDependencies(source('src/Page/Home.elm'), [], [source('src')])

    assert.ok(!dependencies.includes(source('vendor/Api.elm')), 'a directory that was not given should not be searched')
    assert.ok(dependencies.includes(source('src/Ui/Button.elm')))
  })

  it('keeps the dependencies it already knew', async () => {
    const known = source('src/Elsewhere.elm')
    const dependencies = await findAllDependencies(source('vendor/Api.elm'), [known])

    assert.deepEqual(dependencies, [known])
  })

  it('returns the known dependencies and logs the problem when the file does not exist', async (t) => {
    const logged = t.mock.method(console, 'error', () => undefined)
    const dependencies = await findAllDependencies(source('src/Missing.elm'))

    assert.deepEqual(dependencies, [])
    assert.equal(logged.mock.callCount(), 1)
  })
})
