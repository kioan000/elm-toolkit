/**
 * What a compiler run receives, described for a person who debugs a build: the
 * binary that runs, the flags, the working directory and the `ELM_HOME`.
 *
 * The module is internal; the package does not export it. Node does not report
 * which file `spawn` runs, so `findBinary` repeats the lookup of the system.
 * `describeRun` collects the facts of one run, `printRun` shows them when
 * `verbose` is set, and `lookupLines` gives the part that explains a compiler
 * that did not start.
 *
 * @packageDocumentation
 */

import { accessSync, constants, statSync } from 'node:fs'
import { homedir } from 'node:os'
import * as path from 'node:path'
import * as process from 'node:process'

import { Maybe, prettyInfo } from '@elm-toolkit/cli-lib'

import type { CompilerOptions, CompilerProcessOptions } from './process.ts'

/**
 * Where the system looks for the compiler, and what it finds.
 *
 * @example
 *
 * A compiler found through the `PATH`
 * ```TypeScript
 *   const lookup: BinaryLookup = {
 *     binary: Maybe.Just('/app/node_modules/.bin/elm'),
 *     cwd: '/app',
 *     pathToElm: 'elm',
 *     searchPath: ['/app/node_modules/.bin', '/opt/homebrew/bin'],
 *   }
 * ```
 */
export type BinaryLookup = {
  /** The absolute path of the file that runs, or `Nothing` when no file was found. */
  readonly binary: Maybe<string>
  /** The absolute working directory of the compiler. */
  readonly cwd: string
  /** The command as the options give it, such as `elm` or `node_modules/.bin/elm`. */
  readonly pathToElm: string
  /** The folders of the `PATH`, in the order of the search, when the command is a name; empty for a path. */
  readonly searchPath: ReadonlyArray<string>
}

/**
 * The facts of one compiler run, as `printRun` shows them.
 *
 * @example
 *
 * An optimized build with the default Elm home
 * ```TypeScript
 *   const details: RunDetails = {
 *     customElmHome: false,
 *     debug: false,
 *     elmHome: '/Users/ada/.elm',
 *     lookup,
 *     optimize: true,
 *     output: Maybe.Just('/app/dist/main.js'),
 *     report: Maybe.Nothing,
 *     runtimeOptions: Maybe.Nothing,
 *     sources: ['/app/src/Main.elm'],
 *   }
 * ```
 */
export type RunDetails = {
  /** True when `ELM_HOME` is set, in the environment or in `processOpts.env`. */
  readonly customElmHome: boolean
  readonly debug: boolean
  /** The `ELM_HOME` that the compiler uses, the default of Elm when none is set. */
  readonly elmHome: string
  readonly lookup: BinaryLookup
  readonly optimize: boolean
  /** The absolute path of the output. */
  readonly output: Maybe<string>
  readonly report: Maybe<string>
  readonly runtimeOptions: Maybe<ReadonlyArray<string>>
  /** The absolute paths of the Elm files. */
  readonly sources: ReadonlyArray<string>
}

/**
 * Finds the file that `spawn` runs for a command, with the working directory
 * and the environment of the compiler. Use it to name that file in a message,
 * because Node only reports the command.
 *
 * A command with a path separator is a path from `cwd`. A name is looked up in
 * the directories of `PATH`, in order, and the first executable file wins; an
 * empty entry of `PATH` is the working directory, as for the system. On
 * Windows the lookup follows other rules, so a name stays as it is, with the
 * folders of `PATH` that the system searches.
 *
 * @example
 *
 * Find the compiler that a build in `/app` runs
 * ```TypeScript
 *   findBinary('elm', { cwd: '/app', env: { PATH: '/app/node_modules/.bin:/opt/homebrew/bin' } })
 *   // { binary: Just '/app/node_modules/.bin/elm', cwd: '/app', pathToElm: 'elm', searchPath: [...] }
 * ```
 *
 * @param pathToElm - the command, as `spawn` receives it
 * @param processOptions - the options of the child process, with its `cwd` and `env`
 * @returns where the system looks, and the file it finds, if any
 */
export function findBinary(pathToElm: string, processOptions: CompilerProcessOptions): BinaryLookup {
  const cwd = path.resolve(processOptions.cwd ?? process.cwd())

  // Windows takes both separators, so a path written with `/` is a path there too.
  if (pathToElm.includes('/') || pathToElm.includes(path.sep)) {
    return { binary: Maybe.Just(path.resolve(cwd, pathToElm)), cwd, pathToElm, searchPath: [] }
  }

  const searchPath = (processOptions.env?.PATH ?? '').split(path.delimiter)

  if (process.platform === 'win32') {
    return { binary: Maybe.Just(pathToElm), cwd, pathToElm, searchPath }
  }
  const binary = searchPath
    .map((directory) => path.resolve(cwd, directory, pathToElm))
    .find((candidate) => isExecutableFile(candidate))

  return { binary: binary === undefined ? Maybe.Nothing : Maybe.Just(binary), cwd, pathToElm, searchPath }
}

/**
 * Collects the facts of one run, from the options and the settings that the
 * child process receives.
 *
 * @example
 *
 * Describe a debug build
 * ```TypeScript
 *   describeRun(['src/Main.elm'], { debug: true, output: 'main.js' }, 'elm', { cwd: '/app', env: process.env })
 *   // { debug: true, sources: ['/app/src/Main.elm'], output: Just '/app/main.js', … }
 * ```
 *
 * @param sources - the Elm files, as the options give them
 * @param options - the compiler options
 * @param pathToElm - the command that `spawn` receives
 * @param processOptions - the options of the child process
 * @returns the facts that `printRun` shows
 */
export function describeRun(
  sources: ReadonlyArray<string>,
  options: CompilerOptions,
  pathToElm: string,
  processOptions: CompilerProcessOptions
): RunDetails {
  const lookup = findBinary(pathToElm, processOptions)
  const elmHome = processOptions.env?.ELM_HOME ?? ''

  return {
    customElmHome: elmHome !== '',
    debug: Boolean(options.debug),
    elmHome: elmHome !== '' ? elmHome : defaultElmHome(processOptions.env ?? {}),
    lookup,
    optimize: Boolean(options.optimize),
    output: options.output ? Maybe.Just(path.resolve(lookup.cwd, options.output)) : Maybe.Nothing,
    report: options.report ? Maybe.Just(options.report) : Maybe.Nothing,
    runtimeOptions: options.runtimeOptions?.length ? Maybe.Just(options.runtimeOptions) : Maybe.Nothing,
    sources: sources.map((source) => path.resolve(lookup.cwd, source)),
  }
}

/**
 * Prints the command that runs, then the facts of the run under "Details:",
 * one label for each line, and a blank line that separates them from the
 * messages of Elm. A run
 * with `verbose` calls it before the compiler starts.
 *
 * @example
 *
 * Show an optimized build
 * ```TypeScript
 *   printRun('elm', ['make', 'src/Main.elm', '--optimize'], details)
 *   // > Running: elm make src/Main.elm --optimize
 *   //
 *   //     Details:
 *   //         Binary:           /app/node_modules/.bin/elm
 *   //         Sources:          /app/src/Main.elm
 *   //         Debug:            no
 *   //         Optimize:         yes
 *   //         …
 * ```
 *
 * @param pathToElm - the command that `spawn` receives
 * @param args - its arguments
 * @param details - the facts of the run
 */
export function printRun(pathToElm: string, args: ReadonlyArray<string>, details: RunDetails): void {
  const notSet = 'not set'

  // The command names only the file, because Binary below gives its full path.
  prettyInfo('> Running:', [path.basename(pathToElm), ...args].join(' '))
  // The same layout as the sections of an error: a bold label, then the lines below it.
  console.info(
    `\n    \x1b[1mDetails:\x1b[0m\n${labelledLines([
      ['Binary:', [binaryText(details.lookup)]],
      ['Sources:', details.sources],
      ['Debug:', [yesOrNo(details.debug)]],
      ['Optimize:', [yesOrNo(details.optimize)]],
      ['Output:', [details.output.withDefault(notSet)]],
      ['Report:', [details.report.withDefault(notSet)]],
      ['Runtime options:', [details.runtimeOptions.map((each) => each.join(' ')).withDefault(notSet)]],
      ['CWD:', [details.lookup.cwd]],
      ['ELM_HOME:', [details.elmHome]],
      ['Custom ELM_HOME:', [yesOrNo(details.customElmHome)]],
    ])
      .map((line) => `        ${line}`)
      .join('\n')}\n`
  )
}

/**
 * Describes where the system looked for a compiler that did not start: the
 * file it tried, the folders of the `PATH` that it searched for a name, and
 * the working directory.
 *
 * @example
 *
 * A compiler that is in no folder of the `PATH`
 * ```TypeScript
 *   lookupLines({ binary: Maybe.Nothing, cwd: '/app', pathToElm: 'elm', searchPath: ['/usr/bin', '/bin'] })
 *   // ['Searched:  /usr/bin', '           /bin', 'CWD:       /app']
 * ```
 *
 * @param lookup - where the system looked
 * @returns the lines, without colors, for the details of an error
 */
export function lookupLines(lookup: BinaryLookup): ReadonlyArray<string> {
  return labelledLines([
    ['Binary:', lookup.binary.map((binary) => [binary]).withDefault([])],
    ['Searched:', lookup.searchPath],
    ['CWD:', [lookup.cwd]],
  ])
}

/**
 * Lays out labels and values in two columns. A label with several values has
 * one value on each line, and a label with no values is left out.
 *
 * @param entries - each label with its values
 * @returns the lines, with the values aligned
 */
function labelledLines(entries: ReadonlyArray<readonly [string, ReadonlyArray<string>]>): ReadonlyArray<string> {
  const shown = entries.filter(([, values]) => values.length > 0)
  const width = Math.max(...shown.map(([label]) => label.length)) + 2

  return shown.flatMap(([label, values]) =>
    values.map((value, index) => `${(index === 0 ? label : '').padEnd(width)}${value}`)
  )
}

/**
 * Names the binary of a lookup.
 *
 * @param lookup - where the system looked
 * @returns the path of the file, or why there is none
 */
function binaryText(lookup: BinaryLookup): string {
  return lookup.binary.withDefault(`"${lookup.pathToElm}" not found on PATH`)
}

/**
 * Writes a flag as a word.
 *
 * @param flag - the flag
 * @returns `yes` or `no`
 */
function yesOrNo(flag: boolean): string {
  return flag ? 'yes' : 'no'
}

/**
 * The `ELM_HOME` that Elm uses when none is set: a folder in the data
 * directory of the user.
 *
 * @param env - the environment of the compiler
 * @returns the absolute path of the folder
 */
function defaultElmHome(env: NodeJS.ProcessEnv): string {
  return process.platform === 'win32'
    ? path.join(env.APPDATA ?? path.join(homedir(), 'AppData', 'Roaming'), 'elm')
    : path.join(env.HOME ?? homedir(), '.elm')
}

/**
 * Tells whether a path is a file that the current user can run.
 *
 * @param candidate - the path to check
 * @returns true for an executable file
 */
function isExecutableFile(candidate: string): boolean {
  try {
    accessSync(candidate, constants.X_OK)

    return statSync(candidate).isFile()
  } catch {
    return false
  }
}
