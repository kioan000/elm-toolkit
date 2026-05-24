import { type SpawnOptionsWithoutStdio, spawn } from 'node:child_process'

/**
 * Logs a formatted WARNING message to the console with a highlighted title (yellow).
 *
 * @param title - The title of the warning message, displayed prominently.
 * @param optionalParams - Additional parameters to include in the warning message.
 */
export function prettyWarn(title: string, ...optionalParams: any[]): void {
  console.info(`\n\x1b[43mWARNING:${title}\x1b[0m`, ...optionalParams)
}

/**
 * Logs a formatted ERROR message to the console with a red background for the title.
 *
 * @param title - The title or main message to display in the error log.
 * @param optionalParams - Additional parameters to include in the error log.
 */
export function prettyError(title: string, ...optionalParams: any[]): void {
  console.info(`\n\x1b[41mERROR:${title}\x1b[0m`, ...optionalParams)
}

/**
 * Logs a formatted message to the console with a styled title.
 *
 * @param  title - The main title to be styled and displayed.
 * @param optionalParams - Additional parameters to log after the title.
 */
export function prettyInfo(title: string, ...optionalParams: any[]): void {
  console.info(`\n\x1b[48;5;2m${title}\x1b[0m`, ...optionalParams)
}

/**
 * Executes a command in a child process while tying together the input and output streams with the current process.
 *
 * @example
 *
 * Launch a command with arguments
 * ```TypeScript
 *   await spawnCommand('Transpiling in DEV mode', 'yarn', ['webpack', '--mode', 'DEV'])
 * ```
 *
 * @param  logMsg - A message describing the command to be executed, logged for informational purposes.
 * @param  command - The command to run in the child process.
 * @param  args - An optional array of arguments to pass to the command.
 * @param spawnOptions - Optional configuration for the spawned process.
 *
 * @returns A promise that resolves when the command completes successfully, or rejects if the command
 * fails or encounters an error.
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
 * A set timeout wrapped in a promise
 * @param ms - milliseconds to sleep
 */
export async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}
