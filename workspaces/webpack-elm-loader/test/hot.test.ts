/**
 * Checks where the hot reload loader puts its runtime, and which compiler output
 * it refuses.
 *
 * The inputs are compiled by the real Elm 0.19.2 compiler from the `elm` dev
 * dependency, from the programs in `fixtures/project`. Only the inputs that
 * Elm 0.19 cannot produce, such as Elm 0.18 output, are written by hand.
 *
 * @packageDocumentation
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { before, describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { compileToString } from '@elm-toolkit/node-elm-compiler'

import elmHotWebpackLoader from '../hot/index.ts'
import { inject } from '../hot/inject.ts'
import { findElmBinary } from './elm-binary.ts'

const project = path.join(import.meta.dirname, 'fixtures', 'project')
const wrapperEnd = '}(this));'
const navigationKeyTag = "key['elm-hot-nav-key'] = true;"

/**
 * Compiles one program of the fixture project.
 *
 * @param name - the module, which is also the name of its file in `src`
 * @param mode - which kind of build to produce
 * @returns the JavaScript that Elm produced
 */
function compileFixture(name: string, mode: 'debug' | 'optimize'): Promise<string> {
  return compileToString(path.join(project, 'src', `${name}.elm`), {
    cwd: project,
    [mode]: true,
    pathToElm: findElmBinary(),
  })
}

describe('inject', () => {
  const builds: Record<string, string> = {}

  before(async () => {
    for (const name of ['Main', 'Application']) {
      for (const mode of ['debug', 'optimize'] as const) {
        builds[`${name} ${mode}`] = await compileFixture(name, mode)
      }
    }
  })

  for (const mode of ['debug', 'optimize']) {
    it(`puts the runtime inside the Elm wrapper, after the export, in the ${mode} build`, () => {
      const original = builds[`Main ${mode}`]
      const result = inject(original)
      const runtimeStart = result.indexOf('HMR BEGIN')
      const wrapperClose = result.lastIndexOf(wrapperEnd)

      assert.ok(runtimeStart > result.lastIndexOf('_Platform_export('), 'the runtime should follow the export')
      assert.ok(runtimeStart < wrapperClose, 'the runtime should stay inside the Elm wrapper')
      assert.ok(result.startsWith(original.slice(0, original.lastIndexOf('_Platform_export('))))
    })

    it(`keeps the elm-hot runtime off when the kernel offers Elm.hot, in the ${mode} build`, () => {
      const result = inject(builds[`Main ${mode}`])

      assert.ok(
        result.lastIndexOf("if (!(scope['Elm'] && scope['Elm'].hot)) {") < result.indexOf('HMR BEGIN'),
        'the elm-hot runtime should be guarded by a check for Elm.hot'
      )
    })

    it(`hands updates to Elm.hot.reload after the Elm wrapper, in the ${mode} build`, () => {
      const result = inject(builds[`Main ${mode}`])
      const coreReloadStart = result.indexOf('ELM CORE HOT RELOAD BEGIN')

      assert.ok(coreReloadStart > result.lastIndexOf(wrapperEnd), 'the Elm.hot code should follow the wrapper')
      assert.match(result.slice(coreReloadStart), /running\.hot\.reload\(\{ Elm: Elm \}\)/)
    })

    it(`tags the navigation key of an application in the ${mode} build`, () => {
      assert.ok(inject(builds[`Application ${mode}`]).includes(navigationKeyTag))
    })

    it(`leaves a program that is not an application without the tag in the ${mode} build`, () => {
      assert.ok(!inject(builds[`Main ${mode}`]).includes(navigationKeyTag))
    })
  }

  it('tags the navigation key of a kernel that calls impl.onUrlChange', () => {
    // The browser fork of elm/core#1155 reads onUrlChange from impl instead of a local variable.
    const withImpl = builds['Application debug'].replace(/key\.a\(\s*onUrlChange\(/u, 'key.a(impl.onUrlChange(')

    assert.notEqual(withImpl, builds['Application debug'], 'the test should rewrite the key definition')
    assert.ok(inject(withImpl).includes(navigationKeyTag))
  })

  it('refuses an application whose navigation key it cannot find', () => {
    const withoutKey = builds['Application debug'].replace(/var key = function\s*\(\)\s*\{[^}]*\};/u, '')

    assert.notEqual(withoutKey, builds['Application debug'], 'the test should remove the key definition')
    assert.throws(() => inject(withoutKey), /Browser\.Navigation\.Key def not found/)
  })

  it('refuses the output of Elm 0.18', () => {
    assert.throws(() => inject('_elm_lang$core$Native_Platform.initialize({});'), /Elm 0\.18 is not supported/)
  })

  it('refuses text that does not end like Elm output', () => {
    assert.throws(() => inject('console.log("not Elm")'), /must use the Elm 0\.19 compiler/)
  })
})

describe('the hot reload loader', () => {
  it('accepts the source as text or as a buffer', async () => {
    const compiled = await compileFixture('Main', 'debug')

    assert.equal(elmHotWebpackLoader(Buffer.from(compiled, 'utf8')), elmHotWebpackLoader(compiled))
  })

  it('names the fix when it receives Elm source, because it runs before the Elm loader', () => {
    const elmSource = readFileSync(path.join(project, 'src', 'Main.elm'), 'utf8')

    assert.throws(() => elmHotWebpackLoader(elmSource), /List it before the Elm loader in `use`/)
  })
})
