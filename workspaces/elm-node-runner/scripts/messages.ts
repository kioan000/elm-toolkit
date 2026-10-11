/**
 * Prints every message that a user of the `elm-node-runner` command can see,
 * to read them all in one place.
 *
 * Each case runs the real command, with the pinned Elm, on
 * `test/fixtures/project`, and prints to this terminal with colours. A `Main`
 * with flags and a module with a dot in its name are written into a copy of
 * that project.
 *
 * Run it with `corepack yarn workspace @elm-toolkit/elm-node-runner messages`.
 *
 * @packageDocumentation
 */

import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { findElmBinary } from '../test/elm-binary.ts'

const command = path.join(import.meta.dirname, '..', 'command.ts')
const project = path.join(import.meta.dirname, '..', 'test', 'fixtures', 'project')
const pathWithElm = `${path.dirname(findElmBinary())}${path.delimiter}${process.env.PATH ?? ''}`
const scratch = mkdtempSync(path.join(tmpdir(), 'elm-node-runner-messages-'))

/**
 * Copies the fixture project, with a `Main` that expects flags and a module
 * `Tools.Echo`.
 *
 * @returns the folder of the copy
 */
function projectWithFlags(): string {
  const folder = path.join(scratch, 'project')

  cpSync(project, folder, { filter: (source) => !source.includes('elm-stuff'), recursive: true })
  mkdirSync(path.join(folder, 'src', 'Tools'))
  writeFileSync(
    path.join(folder, 'src', 'Main.elm'),
    'module Main exposing (main)\n\n\nmain : Program String () ()\nmain =\n    Platform.worker\n        { init = \\_ -> ( (), Cmd.none )\n        , update = \\_ model -> ( model, Cmd.none )\n        , subscriptions = \\_ -> Sub.none\n        }\n'
  )
  writeFileSync(
    path.join(folder, 'src', 'Tools', 'Echo.elm'),
    'module Tools.Echo exposing (main)\n\n\nmain : Program () () ()\nmain =\n    Platform.worker\n        { init = \\_ -> ( (), Cmd.none )\n        , update = \\_ model -> ( model, Cmd.none )\n        , subscriptions = \\_ -> Sub.none\n        }\n'
  )

  return folder
}

/**
 * One run of the command.
 */
type Case = {
  /** The arguments after the command name. */
  readonly args: ReadonlyArray<string>
  /** The folder to run in; the fixture project by default. */
  readonly cwd?: string
  /** The `PATH`; the pinned Elm first by default. */
  readonly path?: string
  /** What the case shows. */
  readonly title: string
}

const otherProject = projectWithFlags()
const noElm = mkdtempSync(path.join(scratch, 'no-elm-'))

const cases: ReadonlyArray<Case> = [
  { args: ['--help'], title: 'the help' },
  { args: ['--version'], title: 'the version' },
  { args: ['--example-elm'], title: 'the example of Main.elm' },
  { args: ['--example-ts'], title: 'the example of a launcher' },
  { args: ['src/Main.elm'], title: 'a program that runs, without a launcher' },
  { args: ['--ts', 'launcher.ts', 'src/Main.elm', 'src/Greeter.elm'], title: 'a program that runs, with a launcher' },
  { args: ['--log-info', 'src/Main.elm'], title: 'a program that runs, with --log-info' },
  { args: ['--optimize', 'src/Main.elm'], title: 'a program that runs, with --optimize' },
  { args: [], title: 'arguments: no Elm file' },
  { args: ['--optimise', 'src/Main.elm'], title: 'arguments: an unknown option' },
  { args: ['--ts'], title: 'arguments: an option without its value' },
  { args: ['--ts', 'missing.ts', 'src/Main.elm'], title: 'arguments: a launcher that does not exist' },
  { args: ['src/Broken.elm'], title: 'BuildFailed: a type error' },
  { args: ['--log-info', 'src/Broken.elm'], title: 'BuildFailed: a type error, with --log-info' },
  { args: ['src/Missing.elm'], title: 'BuildFailed: an Elm file that does not exist' },
  { args: ['src/Main.elm'], path: noElm, title: 'BuildFailed: the Elm compiler is not installed' },
  { args: ['src/CrashesOnLoad.elm'], title: 'ProgramNotLoaded: the program throws while it loads' },
  { args: ['src/Greeter.elm'], title: 'NoMain: no module is called Main' },
  {
    args: ['src/Tools/Echo.elm'],
    cwd: otherProject,
    title: 'NoMain: the only module has a dot in its name',
  },
  { args: ['src/Main.elm'], cwd: otherProject, title: 'MainNotStarted: Main expects flags' },
  { args: ['--ts', 'cannot-load.ts', 'src/Main.elm'], title: 'LauncherNotLoaded: the launcher cannot be imported' },
  { args: ['--ts', 'not-a-function.ts', 'src/Main.elm'], title: 'LauncherNotAFunction' },
  { args: ['--ts', 'throws.ts', 'src/Main.elm'], title: 'LauncherFailed: the launcher throws' },
]

try {
  for (const { args, cwd, path: searchPath, title } of cases) {
    console.log(`\n========== ${title}\n$ elm-node-runner ${args.join(' ')}\n`)

    const result = spawnSync(process.execPath, [command, ...args], {
      cwd: cwd ?? project,
      env: { ...process.env, PATH: searchPath ?? pathWithElm },
      stdio: 'inherit',
    })

    console.log(`\n(exit code ${String(result.status)})`)
  }
} finally {
  rmSync(scratch, { force: true, recursive: true })
}
