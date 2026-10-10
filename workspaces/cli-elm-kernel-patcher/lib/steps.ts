/**
 * The building blocks that the commands of this package share, for steps that
 * return a `Result` instead of throwing.
 *
 * A step that calls Node wraps the call in `Result.attempt` of `cli-lib`, and
 * turns the exception into a `CliError` with `CliError.fromUnknown`, where it
 * knows what failed. `inWorkFolder` gives a step a temporary folder and always
 * removes it. The function that runs a command chains the steps and hands the
 * outcome to `report`, which prints it once.
 *
 * @packageDocumentation
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { CliError, CliSuccess, Result } from '@elm-toolkit/cli-lib'

/**
 * Prints the outcome of a command once: `CliSuccess.print` for a success, or
 * `CliError.print` for a failure.
 *
 * @param title - the command, for the first line
 * @param outcome - the outcome to print
 * @param success - the success to print, built from the value of the outcome
 * @returns the same outcome, for the caller
 */
export function report<A>(
  title: string,
  outcome: Result<CliError, A>,
  success: (value: A) => CliSuccess
): Result<CliError, A> {
  switch (outcome.type_) {
    case 'Ok':
      CliSuccess.print(title, success(outcome.value))

      return outcome
    case 'Err':
      CliError.print(title, outcome.error)

      return outcome
  }
}

/**
 * Shortens a path for a message, relative to the current directory when it is
 * inside it.
 *
 * @param file - an absolute path
 * @returns the path relative to the current directory, or the absolute path
 */
export function shown(file: string): string {
  const relative = path.relative(process.cwd(), file)

  return relative.startsWith('..') ? file : relative
}

/**
 * Runs some work in a new temporary folder, and removes the folder afterwards,
 * whatever the outcome.
 *
 * @param work - the work, which receives the folder
 * @returns the outcome of the work, or `Err` when the folder cannot be created
 */
export function inWorkFolder<A>(work: (folder: string) => Result<CliError, A>): Result<CliError, A> {
  return Result.fromAttempt(() => fs.mkdtempSync(path.join(os.tmpdir(), 'elm-kernel-patcher-')))
    .mapError((caught) => CliError.fromUnknown('could not create a temporary folder', caught))
    .andThen((folder) => {
      try {
        return work(folder)
      } finally {
        fs.rmSync(folder, { force: true, recursive: true })
      }
    })
}

/**
 * Writes the `archive` command that a message suggests, with the options that
 * the person used, so that the suggestion works when it is copied as it is.
 *
 * @example
 *
 * Suggest a build for a project in a subfolder
 * ```TypeScript
 *   archiveCommand('build', { elmJsonFolder: 'frontend', folder: 'kernel' })
 *   // 'cli-elm-kernel-patcher archive build --elmJsonFolder frontend --folder kernel'
 * ```
 *
 * @param step - the archive subcommand
 * @param options - the folder of elm.json and the patch folder that the person gave
 * @returns the command, with an option only where it differs from the default
 */
export function archiveCommand(
  step: 'build' | 'check' | 'init',
  options: { elmJsonFolder?: string; folder?: string }
): string {
  const elmJsonFolder = options.elmJsonFolder === undefined ? [] : ['--elmJsonFolder', options.elmJsonFolder]
  const folder =
    options.folder === undefined || options.folder === 'elm-kernel-patcher' ? [] : ['--folder', options.folder]

  return ['cli-elm-kernel-patcher', 'archive', step, ...elmJsonFolder, ...folder].join(' ')
}

/**
 * Writes the patch command that a message suggests after an archive is built,
 * with the folder of elm.json that the person used.
 *
 * @example
 *
 * Suggest the patch of a project in a subfolder
 * ```TypeScript
 *   patchCommand({ elmJsonFolder: 'frontend', folder: 'kernel' })
 *   // 'cli-elm-kernel-patcher --elmJsonFolder frontend --patches kernel'
 * ```
 *
 * @param options - the folder of elm.json and the patch folder that the person gave
 * @returns the command
 */
export function patchCommand(options: { elmJsonFolder?: string; folder?: string }): string {
  const elmJsonFolder = options.elmJsonFolder === undefined ? [] : ['--elmJsonFolder', options.elmJsonFolder]

  return ['cli-elm-kernel-patcher', ...elmJsonFolder, '--patches', options.folder ?? 'elm-kernel-patcher'].join(' ')
}
