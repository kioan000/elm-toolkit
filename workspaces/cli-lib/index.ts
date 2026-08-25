/**
 * Utilities shared by the command line tools in this repository.
 *
 * The module covers three needs that every one of those tools runs into. The
 * logging helpers make progress visible in a terminal. `spawnCommand` runs
 * another program and keeps its output attached to the current process. The last
 * pair answers questions a module has about itself: whether it was started by
 * Node or imported, and where its own manifest is.
 *
 * The two self inspection functions take the caller's `import.meta.url`, because
 * the answer concerns the calling module and not this one.
 *
 * @packageDocumentation
 */

import { type SpawnOptionsWithoutStdio, spawn } from 'node:child_process'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/**
 * A parsed `package.json`, with the two fields this library reads named and the
 * rest left opaque.
 *
 * @example
 *
 * Read the version of the package a module belongs to
 * ```TypeScript
 *   const manifest: PackageManifest = readPackageJson(import.meta.url)
 *   manifest.version // '0.0.1'
 * ```
 */
export type PackageManifest = {
  [field: string]: unknown
  name: string
  version: string
}

/**
 * Reports something the user should notice but that does not stop the tool. The
 * title is printed on a yellow background so it stands out in a busy terminal.
 *
 * @example
 *
 * Warn and carry on
 * ```TypeScript
 *   prettyWarn('Skipping', 'no elm.json in this folder')
 * ```
 *
 * @param title - the short label shown on the coloured background
 * @param optionalParams - further values, printed after the title
 */
export function prettyWarn(title: string, ...optionalParams: any[]): void {
  console.info(`\n\x1b[43mWARNING:${title}\x1b[0m`, ...optionalParams)
}

/**
 * Reports a failure. The title is printed on a red background. This function only
 * writes to the console; raising or exiting is left to the caller.
 *
 * @example
 *
 * Report a caught error before exiting
 * ```TypeScript
 *   prettyError('Patching failed', error)
 * ```
 *
 * @param title - the short label shown on the coloured background
 * @param optionalParams - further values, printed after the title, such as the error
 */
export function prettyError(title: string, ...optionalParams: any[]): void {
  console.info(`\n\x1b[41mERROR:${title}\x1b[0m`, ...optionalParams)
}

/**
 * Reports normal progress. The title is printed on a green background, which is
 * how a long running command tells the user which step it has reached.
 *
 * @example
 *
 * Announce a step
 * ```TypeScript
 *   prettyInfo('Building', 'starting webpack')
 * ```
 *
 * @param title - the short label shown on the coloured background
 * @param optionalParams - further values, printed after the title
 */
export function prettyInfo(title: string, ...optionalParams: any[]): void {
  console.info(`\n\x1b[48;5;2m${title}\x1b[0m`, ...optionalParams)
}

/**
 * Runs another program and keeps it attached to the current process, so its
 * output appears as if this tool had printed it and it can still read the input.
 *
 * Use it when the child program is part of the work the user asked for, rather
 * than a detail to hide.
 *
 * @example
 *
 * Run a build and wait for it
 * ```TypeScript
 *   await spawnCommand('Transpiling in DEV mode', 'yarn', ['webpack', '--mode', 'DEV'])
 * ```
 *
 * @param logMsg - a description of the step, announced before the program starts
 * @param command - the program to run
 * @param args - the arguments passed to that program
 * @param spawnOptions - options forwarded to `child_process.spawn`
 * @returns a promise that resolves when the program exits with code zero, and
 * rejects on any other exit code or when the program cannot be started
 */
export async function spawnCommand(
  logMsg: string,
  command: string,
  args?: readonly string[],
  spawnOptions?: SpawnOptionsWithoutStdio
): Promise<void> {
  prettyInfo('> Running:', logMsg)

  return new Promise<void>((resolve, reject) => {
    const spawnProcess = spawn(command, args, spawnOptions)

    // Ties together cross pipe current process input -> spawn process input
    process.stdin.pipe(spawnProcess.stdin)
    // Ties together spawn process output -> Current process output
    spawnProcess.stdout.pipe(process.stdout)
    spawnProcess.stderr.pipe(process.stderr)

    spawnProcess.on('error', (error: Error) => reject(error))
    spawnProcess.on('close', (code: number) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`Command exited with non zero code: ${code}`))
      }
    })
  })
}

/**
 * Tells a module whether Node started it or whether something imported it. Use it
 * to keep a command line module quiet on import, so that reading its exports does
 * not run the command.
 *
 * The caller passes its own `import.meta.url`. This function cannot answer for
 * another module, because its own location is never the entry point.
 *
 * The check follows the symlink before it compares the two paths. An installed
 * executable is started through the link in `node_modules/.bin`, while a module
 * URL is always the file that link points to. A comparison that skips this step
 * is false for every installed command line tool.
 *
 * Returns false when Node was started without a script, for example in the REPL,
 * and when the started path no longer exists.
 *
 * @example
 *
 * Parse arguments only when the module is run directly
 * ```TypeScript
 *   if (isEntryPoint(import.meta.url)) {
 *     program.parse()
 *   }
 * ```
 *
 * @param moduleUrl - the calling module's `import.meta.url`
 * @returns true when that module is the program Node started
 */
export function isEntryPoint(moduleUrl: string): boolean {
  const entry = process.argv[1]

  if (entry === undefined) {
    return false
  }

  try {
    return moduleUrl === pathToFileURL(realpathSync(entry)).href
  } catch {
    // A non existent or unreadable argv[1] means we cannot claim to be the entry point
    return false
  }
}

/**
 * Reads the manifest of the package a module belongs to. Use it to take a value
 * such as the version from `package.json` instead of repeating it in the code.
 *
 * The search starts at the module and moves upwards until a `package.json`
 * appears. Compiled code sits one directory below its source, so no fixed
 * relative path reaches the manifest from both places, and searching upwards is
 * correct from either one.
 *
 * Importing the manifest instead would be shorter, but TypeScript then copies it
 * into the build output, where a second `package.json` breaks module resolution.
 *
 * @example
 *
 * Keep the reported version in step with the manifest
 * ```TypeScript
 *   program.version(readPackageJson(import.meta.url).version)
 * ```
 *
 * @param moduleUrl - the calling module's `import.meta.url`
 * @returns the parsed manifest of the nearest package above that module
 * @throws Error when no manifest exists above the module
 */
export function readPackageJson(moduleUrl: string): PackageManifest {
  let directory = path.dirname(fileURLToPath(moduleUrl))

  for (;;) {
    const candidate = path.join(directory, 'package.json')

    if (existsSync(candidate)) {
      return JSON.parse(readFileSync(candidate, 'utf8')) as PackageManifest
    }

    const parent = path.dirname(directory)

    if (parent === directory) {
      throw new Error(`No package.json found above ${moduleUrl}`)
    }

    directory = parent
  }
}

/**
 * Waits for a while. Use it to space out repeated attempts, or to leave a moment
 * between steps that a user is watching.
 *
 * @example
 *
 * Pause between two steps
 * ```TypeScript
 *   await sleep(500)
 * ```
 *
 * @param ms - how long to wait, in milliseconds
 * @returns a promise that resolves once that time has passed
 */
export async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}
