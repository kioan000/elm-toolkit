#!/usr/bin/env node

/**
 * The command line interface of the Elm runner.
 *
 * `main` reads the arguments, prints help or an example when asked, and
 * otherwise compiles and starts the program. It returns an exit code instead of
 * ending the process, because a running Elm program may still have work to do
 * when `main` returns. The module only runs `main` when Node started this file,
 * so importing it has no effect.
 *
 * @packageDocumentation
 */

import { existsSync } from 'node:fs'
import { parseArgs } from 'node:util'

import { CliError, CliSuccess, isEntryPoint, prettyWarn, readPackageJson } from '@elm-toolkit/cli-lib'

import { exampleElm, exampleLauncher } from './lib/examples.ts'
import { RunnerError, compileProgram, startProgram } from './lib/runner.ts'

/**
 * The help text that `--help` prints, and that wrong usage prints as well.
 *
 * @example
 *
 * Show the help next to an error of your own
 * ```TypeScript
 *   console.log(`Unknown project.\n\n${usage}`)
 * ```
 */
export const usage = `elm-node-runner [--ts launcher.ts] [--optimize] Main.elm [More.elm ...]

Compiles the Elm files and runs the program in Node.

Without --ts, the module called Main starts, and its "log" and "eval" ports
are connected. With --ts, the default export of the launcher receives the Elm
object and starts the program itself.

  --ts <file>     a TypeScript or JavaScript launcher
  --optimize      build with elm make --optimize
  --log-info      deprecated: an error already shows the messages of Elm
  --example-elm   print a starter Main.elm
  --example-ts    print a starter launcher for it
  --version       print the version
  --help          print this help
`

/**
 * Runs the command with the given arguments. Help, version, examples and the
 * error of a failed run go to standard output. Wrong arguments go to standard
 * error, followed by the help.
 *
 * @example
 *
 * Run a program as the command line would
 * ```TypeScript
 *   process.exitCode = await main(['--ts', 'src/main.ts', 'src/Main.elm'])
 * ```
 *
 * @param args - the arguments after the command name
 * @returns the exit code: zero when the program started or the help was asked
 * for, one otherwise
 */
export async function main(args: string[]): Promise<number> {
  let parsed

  try {
    parsed = parseArgs({
      allowPositionals: true,
      args,
      options: {
        'example-elm': { type: 'boolean' },
        'example-ts': { type: 'boolean' },
        help: { type: 'boolean' },
        'log-info': { type: 'boolean' },
        optimize: { type: 'boolean' },
        ts: { type: 'string' },
        version: { type: 'boolean' },
      },
    })
  } catch (error) {
    console.error(`${error instanceof Error ? error.message : String(error)}\n\n${usage}`)

    return 1
  }

  const { positionals: elmFiles, values } = parsed

  if (values.help) {
    console.log(usage)

    return 0
  }

  if (values.version) {
    console.log(readPackageJson(import.meta.url).version)

    return 0
  }

  if (values['example-elm']) {
    console.log(exampleElm)

    return 0
  }

  if (values['example-ts']) {
    console.log(exampleLauncher)

    return 0
  }

  if (elmFiles.length === 0) {
    console.error(`Give at least one Elm file to run.\n\n${usage}`)

    return 1
  }

  if (values.ts && !existsSync(values.ts)) {
    console.error(`The launcher '${values.ts}' does not exist.\n\n${usage}`)

    return 1
  }

  if (values['log-info']) {
    prettyWarn('deprecated option', '--log-info will be removed in a later release.')
    console.info('    An error already shows the messages of Elm, so the option adds only the compiler command.')
  }

  const compileProgramResult = await compileProgram(elmFiles, {
    optimize: values.optimize,
    verbose: values['log-info'],
  })

  if (compileProgramResult.type_ === 'Err') {
    return failed(compileProgramResult.error)
  }

  const launcher = values.ts

  CliSuccess.print(
    'compiled successfully',
    CliSuccess.create({
      summary: elmFiles.join(', '),
      whatHappened: [
        launcher === undefined
          ? 'Main starts now. What the program prints follows.'
          : `${launcher} starts the program now. What the program prints follows.`,
      ],
    })
  )
  // A blank line keeps the output of the program apart from the report.
  console.info()

  const startProgramResult = await startProgram(compileProgramResult.value, launcher)

  return startProgramResult.type_ === 'Err' ? failed(startProgramResult.error) : 0
}

/**
 * Prints a failed run, with a title that says what went wrong.
 *
 * @param error - the failure
 * @returns the exit code of a failure
 */
function failed(error: RunnerError): number {
  CliError.print(RunnerError.title(error), RunnerError.toCliError(error))

  return 1
}

if (isEntryPoint(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2))
}
