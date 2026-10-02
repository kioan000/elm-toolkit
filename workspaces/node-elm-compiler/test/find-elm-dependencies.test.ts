/**
 * Checks the dependency search on a small Elm project in `fixtures/imports`. The
 * project is only read, never compiled, which is why it may hold an import cycle.
 *
 * In that project `Main` imports `Page.Home` and `Ui.Button`, `Page.Home`
 * imports `Api` from a second source directory, and `Ui.Button` imports
 * `Page.Home` back, so the search meets a cycle. `Ui.Icon` is imported only by
 * `Main`, after the comments in its import section. Every module also imports `Html`,
 * which comes from a package and has no local file.
 *
 * @packageDocumentation
 */

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
