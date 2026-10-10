/**
 * Checks the runner the way a user meets it: as a command, started in its own
 * process, on the Elm project in `fixtures/project`.
 *
 * Every run puts the directory of the real Elm 0.19.2 compiler, from the `elm`
 * dev dependency, first on the `PATH`, because the runner calls `elm` by name.
 * The compiler prints its progress to standard output and its problems to
 * standard error, while it builds; the programs print to standard output. Most
 * checks read both streams together, and the checks of the build read each one
 * on its own, so that a change of stream shows up as a failure.
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

  it('shows the progress of Elm on standard output while it builds, before the program prints', () => {
    const { stdout } = run(['src/Main.elm'])

    assert.match(stdout, /Success!/)
    assert.match(stdout, /Main ─+> \S*elm-node-runner-\w+\/elm\.js/)
    assert.ok(stdout.indexOf('Success!') < stdout.indexOf('Hello from Main'), 'the build output comes first')
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

  it('prints the compiler command with --log-info', () => {
    assert.match(run(['--log-info', 'src/Main.elm']).stdout, /^Running \S*elm make src\/Main\.elm/m)
  })

  it('removes the compiled code once the program has started', () => {
    const temporaryDirectories = (): string[] =>
      readdirSync(tmpdir()).filter((name) => name.startsWith('elm-node-runner-'))
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
      assert.match(result.stderr, /^-- TYPE MISMATCH/m, 'the problems of Elm go to standard error, as Elm writes them')
      assert.match(result.stdout, /ERROR:elm-node-runner\S* The Elm compiler reported an error\.$/m)
      assert.doesNotMatch(result.stdout, /TYPE MISMATCH/, 'the summary does not repeat the problems')
    })

    it('when there is no launcher and no module called Main', () => {
      const result = run(['src/Greeter.elm'])

      assert.equal(result.status, 1)
      assert.match(result.output, /No compiled module is called Main; the build exports Greeter/)
    })

    it('when the launcher has no function as its default export', () => {
      const result = run(['--ts', 'not-a-function.ts', 'src/Main.elm'])

      assert.equal(result.status, 1)
      assert.match(result.output, /not-a-function\.ts must export a function as its default export/)
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
        assert.match(result.stdout, /ERROR:elm-node-runner\S* Could not find Elm compiler "elm"\. Is it installed\?$/m)
      } finally {
        rmSync(emptyDirectory, { force: true, recursive: true })
      }
    })
  })
})
