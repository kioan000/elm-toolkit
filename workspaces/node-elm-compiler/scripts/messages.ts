/**
 * Prints every message of this package, so that a person can read them all in
 * one place, for example after a change to a message or during a review.
 *
 * The first part prints each case of `CompileError` as a command line tool
 * prints it, with `CliError.print`. The second part runs each path that writes
 * to the console: the log of `verbose`, the warnings about `elm.json`, the
 * error of the deprecated `findAllDependencies`, and the lines that Elm itself
 * prints. Every case comes from a real call on the projects in
 * `test/fixtures`, with the pinned Elm compiler, except `outputNotRead`, which
 * no call can cause on purpose.
 *
 * Run it with `corepack yarn workspace @elm-toolkit/node-elm-compiler messages`.
 * The script is not part of the published package.
 *
 * @packageDocumentation
 */

/* eslint-disable import-x/no-deprecated -- the deprecated API logs messages of its own, which this script shows */

import { EventEmitter } from 'node:events'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { CliError, type Result } from '@elm-toolkit/cli-lib'

import * as legacy from '../index.ts'
import {
  CompileError,
  type CompilerOptions,
  compile,
  compileSync,
  compileToString,
  compileWorker,
  dryCompile,
  findAllDependencies,
  prepareProcessArgs,
} from '../result-api.ts'
import { findElmBinary } from '../test/elm-binary.ts'

const elm = findElmBinary()
const app = path.join(import.meta.dirname, '..', 'test', 'fixtures', 'app')
const inApp: CompilerOptions = { cwd: app, pathToElm: elm }
const scratch = mkdtempSync(path.join(tmpdir(), 'node-elm-compiler-messages-'))

/**
 * Takes the error out of a result that must have failed.
 *
 * @param result - the result of a call that is expected to fail
 * @returns its error
 * @throws an `Error` when the call succeeded, because the script then shows the wrong case
 */
function errorOf<A>(result: Result<CompileError, A>): CompileError {
  switch (result.tag) {
    case 'Ok':
      throw new Error('The call succeeded, so this case of the script is out of date.')
    case 'Err':
      return result.error
  }
}

/**
 * Runs a function with environment variables changed, and restores them after.
 *
 * @param changes - the variables to set
 * @param run - the function to run
 * @returns what the function returns
 */
async function withEnv<A>(changes: Record<string, string>, run: () => Promise<A>): Promise<A> {
  const before = Object.entries(changes).map(([name]): [string, string | undefined] => [name, process.env[name]])

  Object.assign(process.env, changes)

  try {
    return await run()
  } finally {
    for (const [name, value] of before) {
      if (value === undefined) {
        Reflect.deleteProperty(process.env, name)
      } else {
        process.env[name] = value
      }
    }
  }
}

/**
 * Starts a worker from the fixture project. `compileWorker` has no option to
 * choose the binary, so the pinned compiler goes first on the `PATH`.
 *
 * @param file - the name of the Elm file in `src`, without the extension
 * @param moduleName - the module to start
 * @param workerArgs - the argument of `init`
 * @returns whatever `compileWorker` returns
 */
function startWorker(file: string, moduleName: string, workerArgs?: unknown): ReturnType<typeof compileWorker> {
  return withEnv({ PATH: `${path.dirname(elm)}${path.delimiter}${process.env.PATH ?? ''}` }, () =>
    compileWorker(app, `src/${file}.elm`, moduleName, workerArgs)
  )
}

/**
 * A spawn option whose process a signal stops at once, in place of Elm.
 *
 * @param signal - the signal, such as SIGKILL
 * @returns a function with the shape of the `spawn` option
 */
function killedBy(signal: string): CompilerOptions['spawn'] {
  return () => {
    const compiler = Object.assign(new EventEmitter(), { stderr: new EventEmitter(), stdout: new EventEmitter() })

    setImmediate(() => compiler.emit('close', null, signal))

    return compiler as never
  }
}

/**
 * Writes a file into the folder of this run.
 *
 * @param name - the path of the file inside the folder
 * @param content - the text of the file
 * @returns the absolute path of the file
 */
function scratchFile(name: string, content: string): string {
  const file = path.join(scratch, name)

  writeFileSync(file, content)

  return file
}

/**
 * Makes a project with the given `elm.json` and one module, for the warnings
 * of the dependency search.
 *
 * @param elmJson - the text of `elm.json`
 * @returns the path of the module
 */
function projectWith(elmJson: string): string {
  const folder = mkdtempSync(path.join(scratch, 'project-'))

  const module_ = path.join(folder, 'Main.elm')

  writeFileSync(path.join(folder, 'elm.json'), elmJson)
  writeFileSync(module_, 'module Main exposing (main)\n\nimport Helper\n')

  return module_
}

const notExecutable = scratchFile('elm', '#!/bin/sh\n')
const notAModule = scratchFile('Broken.elm', 'module \n')

chmodSync(notExecutable, 0o644)

const errors: ReadonlyArray<[string, () => CompileError | Promise<CompileError>]> = [
  [
    'unknownOption: an option that Elm 0.19 removed',
    (): CompileError => errorOf(prepareProcessArgs('src/Main.elm', { yes: true })),
  ],
  [
    'unknownOption: an option that Elm 0.19 renamed',
    (): CompileError => errorOf(prepareProcessArgs('src/Main.elm', { pathToMake: 'elm' } as CompilerOptions)),
  ],
  [
    'unknownOption: a misspelled option',
    (): CompileError => errorOf(prepareProcessArgs('src/Main.elm', { optimise: true } as CompilerOptions)),
  ],
  [
    'compilerNotStarted: ENOENT',
    async (): Promise<CompileError> => errorOf(await dryCompile('src/Main.elm', { cwd: app, pathToElm: 'elm-0.19' })),
  ],
  [
    'compilerNotStarted: EACCES',
    async (): Promise<CompileError> =>
      errorOf(await dryCompile('src/Main.elm', { cwd: app, pathToElm: notExecutable })),
  ],
  [
    'compilerNotStarted: a custom spawn that throws',
    (): CompileError =>
      errorOf(
        compile('src/Main.elm', {
          ...inApp,
          spawn: (): never => {
            throw new Error('the build server is offline')
          },
        })
      ),
  ],
  [
    'compilerStopped: timeout',
    async (): Promise<CompileError> =>
      errorOf(await dryCompile('src/Main.elm', { ...inApp, processOpts: { timeout: 1 } })),
  ],
  [
    'compilerStopped: maxBuffer',
    (): CompileError =>
      errorOf(
        compileSync('src/Broken.elm', { ...inApp, output: '/dev/null', processOpts: { maxBuffer: 10, stdio: 'pipe' } })
      ),
  ],
  [
    'compilerStopped: signal',
    async (): Promise<CompileError> => errorOf(await dryCompile('src/Main.elm', { spawn: killedBy('SIGKILL') })),
  ],
  ['compileFailed', async (): Promise<CompileError> => errorOf(await dryCompile('src/Broken.elm', inApp))],
  [
    'tempFolderNotCreated',
    (): Promise<CompileError> =>
      withEnv({ TMPDIR: '/no/such/folder' }, async (): Promise<CompileError> =>
        errorOf(await compileToString('src/Main.elm', inApp))
      ),
  ],
  [
    'outputNotRead (built by hand, because no call can cause it on purpose)',
    (): CompileError => {
      const cause = "ENOENT: no such file or directory, open '/tmp/node-elm-compiler-x1/elm-output.js'"

      return {
        cause,
        file: '/tmp/node-elm-compiler-x1/elm-output.js',
        kind: 'outputNotRead',
        original: new Error(cause),
      }
    },
  ],
  ['moduleNotFound', async (): Promise<CompileError> => errorOf(await startWorker('Doubler', 'Dubler', { flags: 3 }))],
  [
    'workerNotStarted',
    async (): Promise<CompileError> => errorOf(await startWorker('Doubler', 'Doubler', { flags: 'three' })),
  ],
  ['noPorts', async (): Promise<CompileError> => errorOf(await startWorker('NoPorts', 'NoPorts'))],
  [
    'entryNotRead',
    async (): Promise<CompileError> => errorOf(await findAllDependencies(path.join(app, 'src', 'Missing.elm'))),
  ],
  ['invalidModule', async (): Promise<CompileError> => errorOf(await findAllDependencies(notAModule))],
]

const logs: ReadonlyArray<[string, () => unknown]> = [
  ['verbose, a build that succeeds', (): unknown => compileToString('src/Main.elm', { ...inApp, verbose: true })],
  ['verbose, a build that fails', (): unknown => dryCompile('src/Broken.elm', { ...inApp, verbose: true })],
  [
    'verbose, compileSync of the deprecated API, where Elm prints to the terminal',
    (): unknown => legacy.compileSync('src/Main.elm', { ...inApp, output: '/dev/null', verbose: true }),
  ],
  ['warning: an elm.json that is not JSON', (): unknown => findAllDependencies(projectWith('{ not json'))],
  [
    'warning: an elm.json without source-directories',
    (): unknown => findAllDependencies(projectWith('{ "type": "application" }')),
  ],
  [
    'error: findAllDependencies of the deprecated API, for a file that does not exist',
    (): unknown => legacy.findAllDependencies(path.join(app, 'src', 'Missing.elm')),
  ],
  [
    'the Elm runtime, when compileWorker starts a module built without --optimize',
    (): unknown => startWorker('Doubler', 'Doubler', { flags: 3 }),
  ],
]

try {
  console.log('#################### Errors, as CompileError.toCliError describes them')

  for (const [name, make] of errors) {
    const error = await make()

    console.log(`\n========== ${name}`)
    CliError.print('elm make', CompileError.toCliError(error))
  }

  console.log('\n#################### Everything else that reaches the console')

  for (const [name, run] of logs) {
    console.log(`\n========== ${name}\n`)
    await run()
  }
} finally {
  rmSync(scratch, { force: true, recursive: true })
}
