/**
 * Checks how a run is described for a person: the lookup of the binary on
 * fake folders of executables, the facts of a run, and the lines that
 * `verbose` prints, with the pinned compiler on the fixture project.
 *
 * @packageDocumentation
 */

import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { Maybe, findElmBinary } from '@elm-toolkit/cli-lib'

import { compileSync } from '../result-api.ts'
import { describeRun, findBinary, lookupLines, printRun } from '../run-details.ts'

const elm = findElmBinary(import.meta.url)
const app = path.join(import.meta.dirname, 'fixtures', 'app')
const root = mkdtempSync(path.join(tmpdir(), 'run-details-'))

after(() => rmSync(root, { force: true, recursive: true }))

/**
 * Creates a file inside the temporary root.
 *
 * @param relative - the path of the file inside the root
 * @param executable - whether the file can run
 * @returns the absolute path of the file
 */
function fakeBinary(relative: string, executable: boolean): string {
  const file = path.join(root, relative)

  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, '#!/bin/sh\n')
  chmodSync(file, executable ? 0o755 : 0o644)

  return file
}

const projectElm = fakeBinary('app/node_modules/.bin/elm', true)
const homebrewElm = fakeBinary('homebrew/bin/elm', true)
fakeBinary('plain/elm', false)
const project = path.join(root, 'app')

describe('findBinary', () => {
  it('takes the first executable file in the order of the PATH', () => {
    const searchPath = [path.join(root, 'plain'), path.dirname(projectElm), path.dirname(homebrewElm)]
    const lookup = findBinary('elm', { cwd: project, env: { PATH: searchPath.join(path.delimiter) } })

    assert.deepEqual(lookup, { binary: Maybe.Just(projectElm), cwd: project, pathToElm: 'elm', searchPath })
  })

  it('reports no binary when no folder of the PATH has one', () => {
    const lookup = findBinary('elm', { cwd: project, env: { PATH: path.join(root, 'plain') } })

    assert.deepEqual(lookup.binary, Maybe.Nothing)
    assert.deepEqual(lookup.searchPath, [path.join(root, 'plain')])
  })

  it('reads an empty entry of the PATH as the working directory', () => {
    const lookup = findBinary('elm', { cwd: path.dirname(homebrewElm), env: { PATH: '' } })

    assert.deepEqual(lookup.binary, Maybe.Just(homebrewElm))
  })

  it('resolves a relative path from the working directory, without the PATH', () => {
    const lookup = findBinary('node_modules/.bin/elm', { cwd: project, env: { PATH: path.dirname(homebrewElm) } })

    assert.deepEqual(lookup, {
      binary: Maybe.Just(projectElm),
      cwd: project,
      pathToElm: 'node_modules/.bin/elm',
      searchPath: [],
    })
  })

  it('keeps a path that does not exist, so that the error can name it', () => {
    const lookup = findBinary('/opt/no-such-elm', { cwd: project, env: {} })

    assert.deepEqual(lookup.binary, Maybe.Just('/opt/no-such-elm'))
  })
})

describe('describeRun', () => {
  it('resolves the files from the working directory, and reads the flags', () => {
    const details = describeRun(
      ['src/Main.elm'],
      { optimize: true, output: 'dist/main.js', report: 'json', runtimeOptions: ['-M2g'] },
      'elm',
      { cwd: project, env: { HOME: '/home/ada', PATH: path.dirname(projectElm) } }
    )

    assert.deepEqual(details, {
      customElmHome: false,
      debug: false,
      elmHome: '/home/ada/.elm',
      lookup: {
        binary: Maybe.Just(projectElm),
        cwd: project,
        pathToElm: 'elm',
        searchPath: [path.dirname(projectElm)],
      },
      optimize: true,
      output: Maybe.Just(path.join(project, 'dist', 'main.js')),
      report: Maybe.Just('json'),
      runtimeOptions: Maybe.Just(['-M2g']),
      sources: [path.join(project, 'src', 'Main.elm')],
    })
  })

  it('marks an ELM_HOME of the environment as custom', () => {
    const details = describeRun(['src/Main.elm'], {}, 'elm', { cwd: project, env: { ELM_HOME: '/cache/elm' } })

    assert.equal(details.elmHome, '/cache/elm')
    assert.equal(details.customElmHome, true)
  })
})

describe('printRun', () => {
  it('prints the command, then one aligned label for each fact', (t) => {
    const printed = t.mock.method(console, 'info', () => undefined)
    const details = describeRun(['src/Main.elm', 'src/Admin.elm'], { debug: true }, 'elm', {
      cwd: project,
      env: { HOME: '/home/ada', PATH: path.dirname(projectElm) },
    })

    printRun('elm', ['make', 'src/Main.elm', 'src/Admin.elm', '--debug'], details)

    assert.deepEqual(printed.mock.calls[0]?.arguments.slice(1), ['elm make src/Main.elm src/Admin.elm --debug'])
    assert.equal(
      printed.mock.calls[1]?.arguments[0],
      [
        '',
        '    \x1b[1mDetails:\x1b[0m',
        `        Binary:           ${projectElm}`,
        `        Sources:          ${path.join(project, 'src', 'Main.elm')}`,
        `                          ${path.join(project, 'src', 'Admin.elm')}`,
        '        Debug:            yes',
        '        Optimize:         no',
        '        Output:           not set',
        '        Report:           not set',
        '        Runtime options:  not set',
        `        CWD:              ${project}`,
        '        ELM_HOME:         /home/ada/.elm',
        '        Custom ELM_HOME:  no',
        '',
      ].join('\n')
    )
  })

  it('runs before the compiler, when verbose is set', (t) => {
    const printed = t.mock.method(console, 'info', () => undefined)

    compileSync(path.join(app, 'src', 'Main.elm'), {
      cwd: app,
      output: '/dev/null',
      pathToElm: elm,
      processOpts: { stdio: 'pipe' },
      verbose: true,
    })

    assert.match(String(printed.mock.calls[0]?.arguments[1]), /^elm make /)
    assert.match(String(printed.mock.calls[1]?.arguments[0]), new RegExp(`Binary: +${elm}\n`))
  })
})

describe('a compiler that does not start', () => {
  it('carries where the system looked for it', () => {
    const outcome = compileSync(path.join(app, 'src', 'Main.elm'), {
      cwd: app,
      pathToElm: 'no-such-elm',
      processOpts: { env: { PATH: path.join(root, 'plain') }, stdio: 'pipe' },
    })

    assert.equal(outcome.type_, 'Err')
    assert.deepEqual(
      outcome.type_ === 'Err' && outcome.error.type_ === 'CompilerNotStarted'
        ? [outcome.error.binary, outcome.error.cwd, outcome.error.searchPath]
        : undefined,
      [Maybe.Nothing, app, [path.join(root, 'plain')]]
    )
  })
})

describe('lookupLines', () => {
  it('lists the folders that the system searched for a name that it did not find', () => {
    assert.deepEqual(
      lookupLines({ binary: Maybe.Nothing, cwd: project, pathToElm: 'elm', searchPath: ['/usr/bin', '/bin'] }),
      ['Searched:  /usr/bin', '           /bin', `CWD:       ${project}`]
    )
  })

  it('shows the PATH only when the command is a name', () => {
    assert.deepEqual(
      lookupLines({ binary: Maybe.Just(projectElm), cwd: project, pathToElm: projectElm, searchPath: [] }),
      [`Binary:  ${projectElm}`, `CWD:     ${project}`]
    )
  })
})
