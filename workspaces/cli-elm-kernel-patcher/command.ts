#!/usr/bin/env node

/**
 * The command line interface of the Elm kernel patcher.
 *
 * The module builds the command and exports it, and only parses the arguments
 * when Node started this file. Importing it therefore has no effect, which lets a
 * caller read the command definition without running the patcher.
 *
 * Without a subcommand the tool patches the Elm home. The `archive` subcommands
 * start a manifest of Git commits, build a patch archive from it, and check that
 * the archive still matches; `lib/archive-builder.ts` does that work.
 *
 * @packageDocumentation
 */

import { type CliError, type Result, isEntryPoint, readPackageJson } from '@elm-toolkit/cli-lib'
import { Command } from 'commander'
import * as ArchiveBuilder from './lib/archive-builder.ts'
import * as Patcher from './lib/patcher.ts'

const program = command()

/**
 * The patcher command, built but not yet parsed.
 *
 * Import it to inspect the options or to run the command with arguments of your
 * own. Nothing happens until `parse` is called.
 *
 * @example
 *
 * Run the command with explicit arguments
 * ```TypeScript
 *   program.parse(['--elmJsonFolder', '/path/to/project'], { from: 'user' })
 * ```
 */
export default program

if (isEntryPoint(import.meta.url)) {
  program.parse()
}

/**
 * Builds the command, with its options and the action that runs the patcher.
 *
 * The command is returned unparsed, so that building it stays free of side
 * effects.
 *
 * @returns the command, ready to be parsed by the caller
 */
function command(): Command {
  const program = new Command()

  // The archive subcommands have their own --elmJsonFolder, so the options of the patcher stop at a subcommand.
  program.enablePositionalOptions()
  program
    .name('cli-elm-kernel-patcher')
    .description('This scripts changes your current ELM_HOME folder with a given set of kernel patches')
    .version(readPackageJson(import.meta.url).version)
  program
    .option(
      '--patches <path>',
      'A patch folder made by the archive commands, a .tar.gz archive of a patches/ folder, or that folder; the archive of this package is the default'
    )
    .option('--elmHome <path>', 'The Elm home to patch; ELM_HOME, or ~/.elm, is the default')
    .option(
      '--elmJsonFolder <type>',
      'Your project folder where elm.json stands, if not specified current working dir is used instead'
    )
    .action((options) => exitOnError(Patcher.patchKernel(options)))

  const archive = program
    .command('archive')
    .description('Build a patch archive from a manifest of Git commits, to pass to --patches')

  archive
    .command('init')
    .description('Create the patch folder with a manifest of the patches of this package, as a starting point')
    .option('--folder <path>', 'The patch folder, relative to the elm.json folder', 'elm-kernel-patcher')
    .option('--elmJsonFolder <path>', 'The folder that holds elm.json; the current working dir is the default')
    .action((options) => exitOnError(ArchiveBuilder.initManifest(options)))

  archive
    .command('build')
    .description('Fetch every commit of the manifest and write the archive of the patch folder')
    .option('--folder <path>', 'The patch folder, relative to the elm.json folder', 'elm-kernel-patcher')
    .option('--elmJsonFolder <path>', 'The folder that holds elm.json; the current working dir is the default')
    .action((options) => exitOnError(ArchiveBuilder.buildArchive(options)))

  archive
    .command('check')
    .description('Build the manifest again and compare it with the archive, file by file')
    .option('--folder <path>', 'The patch folder, relative to the elm.json folder', 'elm-kernel-patcher')
    .option('--elmJsonFolder <path>', 'The folder that holds elm.json; the current working dir is the default')
    .action((options) => exitOnError(ArchiveBuilder.checkArchive(options)))

  return program
}

/**
 * Sets a non-zero exit code after a failed step. The step has already printed
 * its outcome.
 *
 * @param outcome - the outcome of the step
 */
function exitOnError(outcome: Result<CliError, unknown>): void {
  switch (outcome.type_) {
    case 'Ok':
      return
    case 'Err':
      process.exitCode = 1
  }
}
