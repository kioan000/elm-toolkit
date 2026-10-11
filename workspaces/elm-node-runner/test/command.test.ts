/**
 * Checks the command as a user runs it: in its own process, on
 * `fixtures/project`, with the pinned Elm first on the `PATH`.
 *
 * A build that succeeds prints one report, before the program prints. A failure
 * prints one error, with a short title that says what went wrong, and the problems of Elm
 * under "Details". Both go to standard output. The checks read each stream
 * on its own, so a change of stream fails a test. A long line of an error wraps,
 * so the checks read errors with `flat`.
 *
 * @packageDocumentation
 */

import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { findElmBinary } from './elm-binary.ts'

const command = path.join(import.meta.dirname, '..', 'command.ts')
const project = path.join(import.meta.dirname, 'fixtures', 'project')
const pathWithElm = `${path.dirname(findElmBinary())}${path.delimiter}${process.env.PATH}`

/**
 * Runs the command and waits for it to end.
 *
 * @param args - the arguments after the command name
 * @param settings - the directory to run in, and the `PATH` to give the command
 * @returns the exit code and everything the command printed
 */
function run(
  args: string[],
  settings: { cwd?: string; path?: string } = {}
): { output: string; status: number | null; stderr: string; stdout: string } {
  const result = spawnSync(process.execPath, [command, ...args], {
    cwd: settings.cwd ?? project,
    encoding: 'utf8',
    env: { ...process.env, PATH: settings.path ?? pathWithElm },
  })

  return { output: result.stdout + result.stderr, status: result.status, stderr: result.stderr, stdout: result.stdout }
}

/**
 * Removes the colour codes, and joins the lines that an error wraps.
 *
 * @param text - what the command printed
 * @returns the text, with every run of spaces and line breaks as one space
 */
function flat(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, '').replace(/\s+/g, ' ')
}

describe('elm-node-runner', () => {
  it('prints the help', () => {
    const result = run(['--help'])

    assert.equal(result.status, 0)
    assert.match(result.stdout, /^elm-node-runner \[--ts launcher\.ts\]/)
  })

  it('prints the version from its manifest', () => {
    const manifest = JSON.parse(readFileSync(path.join(import.meta.dirname, '..', 'package.json'), 'utf8'))

    assert.equal(run(['--version']).stdout.trim(), manifest.version)
  })

  it('runs Main and connects its log and eval ports', () => {
    const result = run(['src/Main.elm'])

    assert.equal(result.status, 0)
    assert.match(result.stdout, /^Hello from Main$/m)
    assert.match(result.stdout, /^eval can reach function$/m, 'the evaluated code should see the global app')
  })

  it('reports the build that succeeds, before what the program prints', () => {
    const lines = flat(run(['src/Main.elm']).stdout)

    assert.match(
      lines,
      /^ DONE:compiled successfully\S* src\/Main\.elm What happened: Main starts now\. What the program prints follows\. eval can reach function Hello from Main $/
    )
  })

  it('names the launcher in the report of the build', () => {
    assert.match(
      flat(run(['--ts', 'launcher.ts', 'src/Main.elm', 'src/Greeter.elm']).stdout),
      /launcher\.ts starts the program now\./
    )
  })

  it('gives the launcher the Elm object, with every compiled module', () => {
    const result = run(['--ts', 'launcher.ts', 'src/Main.elm', 'src/Greeter.elm'])

    assert.equal(result.status, 0)
    assert.match(result.stdout, /^modules: Greeter,Main$/m)
    assert.match(result.stdout, /^Hello, launcher$/m)
  })

  it('builds with --optimize when asked', () => {
    assert.match(run(['src/Main.elm']).output, /Compiled in DEV mode/)
    assert.doesNotMatch(run(['--optimize', 'src/Main.elm']).output, /Compiled in DEV mode/)
  })

  it('warns that --log-info is deprecated, and still prints the compiler command and the messages of Elm', () => {
    const { status, stdout } = run(['--log-info', 'src/Main.elm'])

    assert.equal(status, 0)
    assert.match(stdout, /WARNING:deprecated option\S* --log-info will be removed in a later release\./)
    assert.match(stdout, /^Running \S*elm make src\/Main\.elm/m)
    assert.match(stdout, /^Success!/m)
  })

  it('removes the compiled code once the program has started', () => {
    const temporaryDirectories = (): string[] =>
      readdirSync(tmpdir()).filter((name) => name.startsWith('node-elm-compiler-'))
    const before = temporaryDirectories()

    run(['src/Main.elm'])

    assert.deepEqual(temporaryDirectories(), before)
  })

  it('prints examples that run alone and together', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'elm-node-runner-example-'))

    try {
      mkdirSync(path.join(directory, 'src'))
      copyFileSync(path.join(project, 'elm.json'), path.join(directory, 'elm.json'))
      writeFileSync(path.join(directory, 'src', 'Main.elm'), run(['--example-elm']).stdout)
      writeFileSync(path.join(directory, 'main.ts'), run(['--example-ts']).stdout)

      assert.match(run(['src/Main.elm'], { cwd: directory }).stdout, /^Main application initialized$/m)
      assert.match(
        run(['--ts', 'main.ts', 'src/Main.elm'], { cwd: directory }).stdout,
        /^\[launcher\] Main application initialized$/m
      )
    } finally {
      rmSync(directory, { force: true, recursive: true })
    }
  })

  describe('fails with exit code 1', () => {
    it('when the program has a type error', () => {
      const result = run(['src/Broken.elm'])

      assert.equal(result.status, 1)
      assert.match(result.stdout, /ERROR:Elm code does not compile\S* src\/Broken\.elm$/m)
      assert.match(result.stdout, /Details:\S*\n\s+-- TYPE MISMATCH/, 'the problems of Elm are part of the error')
      assert.doesNotMatch(result.stderr, /TYPE MISMATCH/, 'nothing of the build goes to standard error')
    })

    it('when there is no launcher and no module called Main', () => {
      const result = run(['src/Greeter.elm'])

      assert.equal(result.status, 1)
      assert.match(result.stdout, /ERROR:no Main module to run\S* the build has only Greeter\.$/m)
    })

    it('when the launcher has no function as its default export', () => {
      const result = run(['--ts', 'not-a-function.ts', 'src/Main.elm'])

      assert.equal(result.status, 1)
      assert.match(
        result.stdout,
        /ERROR:launcher exports no function\S* check the default export of not-a-function\.ts\.$/m
      )
    })

    it('when the launcher cannot be imported', () => {
      const result = run(['--ts', 'cannot-load.ts', 'src/Main.elm'])

      assert.equal(result.status, 1)
      assert.match(
        result.stdout,
        /ERROR:launcher cannot be loaded\S* cannot-load\.ts: TypeScript enum is not supported/m
      )
    })

    it('when the launcher throws', () => {
      const result = run(['--ts', 'throws.ts', 'src/Main.elm'])

      assert.equal(result.status, 1)
      assert.match(result.stdout, /ERROR:launcher threw an error\S* throws\.ts: the launcher broke$/m)
    })

    it('when the compiled program throws while it loads', () => {
      const result = run(['src/CrashesOnLoad.elm'])

      assert.equal(result.status, 1)
      assert.match(
        result.stdout,
        /ERROR:Elm program crashed before it started\S* TODO in module `CrashesOnLoad` on line 11$/m
      )
    })

    it('when the launcher does not exist', () => {
      const result = run(['--ts', 'missing.ts', 'src/Main.elm'])

      assert.equal(result.status, 1)
      assert.match(result.output, /The launcher 'missing\.ts' does not exist/)
    })

    it('when no Elm file is given', () => {
      const result = run([])

      assert.equal(result.status, 1)
      assert.match(result.output, /Give at least one Elm file to run/)
    })

    it('when an option is unknown', () => {
      const result = run(['--optimise', 'src/Main.elm'])

      assert.equal(result.status, 1)
      assert.match(result.output, /Unknown option '--optimise'/)
    })

    it('when the Elm compiler is not installed', () => {
      const emptyDirectory = mkdtempSync(path.join(tmpdir(), 'elm-node-runner-no-elm-'))

      try {
        const result = run(['src/Main.elm'], { path: emptyDirectory })

        assert.equal(result.status, 1)
        assert.match(result.stdout, /ERROR:Elm compiler not found\S* "elm"$/m)
        assert.match(flat(result.stdout), /start elm-node-runner from a script of package\.json/)
        assert.doesNotMatch(result.stdout, /pathToElm/, 'the command has no option to choose the binary')
      } finally {
        rmSync(emptyDirectory, { force: true, recursive: true })
      }
    })
  })
})
