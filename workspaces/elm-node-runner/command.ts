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

import { isEntryPoint, prettyError, readPackageJson } from '@elm-toolkit/cli-lib'

import { exampleElm, exampleLauncher } from './lib/examples.ts'
import { runElm } from './lib/runner.ts'

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
export const usage = `elm-node-runner [--ts launcher.ts] [--optimize] [--log-info] Main.elm [More.elm ...]

Compiles the Elm files and runs the program in Node.

Without --ts, the module called Main starts, and its "log" and "eval" ports
are connected. With --ts, the default export of the launcher receives the Elm
object and starts the program itself.

  --ts <file>     a TypeScript or JavaScript launcher
  --optimize      build with elm make --optimize
  --log-info      print the compiler command before it runs
  --example-elm   print a starter Main.elm
  --example-ts    print a starter launcher for it
  --version       print the version
  --help          print this help
`

/**
 * Runs the command with the given arguments. Help, version and examples go to
 * standard output; problems go to the console as errors, followed by the help
 * when the arguments were wrong.
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

  try {
    await runElm({ elmFiles, launcher: values.ts, optimize: values.optimize, verbose: values['log-info'] })

    return 0
  } catch (error) {
    prettyError('elm-node-runner', error instanceof Error ? error.message : String(error))

    return 1
  }
}

if (isEntryPoint(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2))
}
