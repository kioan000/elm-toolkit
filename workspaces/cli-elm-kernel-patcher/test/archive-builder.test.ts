/**
 * Checks that the archive builder turns a manifest of Git commits into an
 * archive that the patcher accepts, and that it refuses a manifest or a commit
 * it cannot trust.
 *
 * The tests need no network. Each fork is a small Git repository in a temporary
 * folder, and the manifest points at it with a local path, which `git fetch`
 * reads like any other server.
 *
 * @packageDocumentation
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'

import { CliError, Result } from '@elm-toolkit/cli-lib'

import { buildArchive, checkArchive, initManifest } from '../lib/archive-builder.ts'
import { patchKernel, prepareArgs } from '../lib/patcher.ts'

let work: string
let folder: string
let manifest: string
let archive: string

/**
 * Creates a Git repository that looks like a fork of an Elm package, with one
 * commit.
 *
 * @param name - the package that its `elm.json` declares, for example `elm/html`
 * @param options - the version to declare, and whether to leave the license out
 * @returns the folder of the repository and the hash of its commit
 */
function createFork(
  name: string,
  options: { version?: string; withoutLicense?: boolean } = {}
): { commit: string; folder: string } {
  const folder = mkdtempSync(path.join(work, 'fork-'))

  mkdirSync(path.join(folder, 'src'))
  writeFileSync(
    path.join(folder, 'elm.json'),
    JSON.stringify({ name, type: 'package', version: options.version ?? '1.0.1' })
  )
  writeFileSync(path.join(folder, 'src', 'Html.elm'), 'module Html exposing (text)\n')
  writeFileSync(path.join(folder, 'README.md'), 'Not kept in the archive.\n')
  if (!options.withoutLicense) {
    writeFileSync(path.join(folder, 'LICENSE'), 'Copyright the fork.\n')
  }

  return { commit: commitAll(folder, 'first'), folder }
}

/**
 * Commits every file of a repository.
 *
 * @param folder - the repository
 * @param message - the commit message
 * @returns the hash of the new commit
 */
function commitAll(folder: string, message: string): string {
  const git = (...args: string[]): string =>
    execFileSync('git', ['-c', 'user.email=test@example.org', '-c', 'user.name=Test', ...args], {
      cwd: folder,
      encoding: 'utf8',
    }).trim()

  if (!existsSync(path.join(folder, '.git'))) {
    git('init', '--quiet')
  }
  git('add', '--all')
  git('commit', '--quiet', '--message', message)

  return git('rev-parse', 'HEAD')
}

/**
 * Writes the manifest of the test.
 *
 * @param patches - the value of its `patches` key
 */
function writeManifest(patches: unknown): void {
  mkdirSync(folder, { recursive: true })
  writeFileSync(manifest, JSON.stringify({ patches }))
}

/**
 * Takes the text of the error out of a failed outcome, and fails the test when
 * the outcome is a success.
 *
 * @param outcome - the outcome of an archive step
 * @returns the summary and the details of the error, one per line
 */
function errorOf(outcome: Result<CliError, unknown>): string {
  switch (outcome.tag) {
    case 'Ok':
      return assert.fail('the step should fail')
    case 'Err':
      return CliError.toString(outcome.error)
  }
}

/**
 * Lists the files inside an archive, without the folders.
 *
 * @param file - the archive
 * @returns the paths inside it, sorted
 */
function archiveFiles(file: string): string[] {
  return execFileSync('tar', ['-tzf', file], { encoding: 'utf8' })
    .split('\n')
    .filter((entry) => entry !== '' && !entry.endsWith('/'))
    .sort()
}

describe('the archive builder', () => {
  beforeEach(() => {
    work = mkdtempSync(path.join(tmpdir(), 'archive-builder-'))
    folder = path.join(work, 'elm-kernel-patcher')
    manifest = path.join(folder, 'elm-kernel-patcher.json')
    archive = path.join(folder, 'patches.tar.gz')

    // The builder reports each step; the tests read the files instead.
    mock.method(console, 'info', () => undefined)
  })

  afterEach(() => {
    mock.restoreAll()
    rmSync(work, { force: true, recursive: true })
  })

  it('creates the patch folder next to elm.json, with the manifest of this package, and never overwrites it', () => {
    initManifest({ elmJsonFolder: work })

    const written = JSON.parse(readFileSync(manifest, 'utf8')) as { patches: Array<{ packageName: string }> }

    assert.deepEqual(written.patches.map((entry) => entry.packageName).sort(), [
      'elm/browser',
      'elm/core',
      'elm/html',
      'elm/virtual-dom',
    ])
    assert.match(errorOf(initManifest({ elmJsonFolder: work })), /already exists/)
  })

  it('keeps elm.json, LICENSE and src of each commit, and records where it came from', () => {
    const fork = createFork('elm/html')

    writeManifest([{ commit: fork.commit, git: fork.folder, packageName: 'elm/html' }])
    buildArchive({ elmJsonFolder: work })

    assert.deepEqual(archiveFiles(archive), [
      'patches/elm/html/1.0.1/LICENSE',
      'patches/elm/html/1.0.1/elm.json',
      'patches/elm/html/1.0.1/source.txt',
      'patches/elm/html/1.0.1/src/Html.elm',
    ])

    const extracted = path.join(work, 'extracted')

    mkdirSync(extracted)
    execFileSync('tar', ['-xzf', archive, '-C', extracted])
    // A server other than GitHub has no commit page, so the record is the Git address and the commit.
    assert.equal(
      readFileSync(path.join(extracted, 'patches/elm/html/1.0.1/source.txt'), 'utf8'),
      `${fork.folder}#${fork.commit}`
    )
  })

  it('takes the commit of the manifest, not the latest one of the fork', () => {
    const fork = createFork('elm/html')

    writeFileSync(path.join(fork.folder, 'src', 'Html.elm'), 'module Html exposing (text, div)\n')
    commitAll(fork.folder, 'second')
    writeManifest([{ commit: fork.commit, git: fork.folder, packageName: 'elm/html' }])
    buildArchive({ elmJsonFolder: work })

    const extracted = path.join(work, 'extracted')

    mkdirSync(extracted)
    execFileSync('tar', ['-xzf', archive, '-C', extracted])
    assert.equal(
      readFileSync(path.join(extracted, 'patches/elm/html/1.0.1/src/Html.elm'), 'utf8'),
      'module Html exposing (text)\n'
    )
  })

  it('confirms an archive that matches its manifest, and lists the files of one that does not', () => {
    const fork = createFork('elm/html')

    writeManifest([{ commit: fork.commit, git: fork.folder, packageName: 'elm/html' }])
    buildArchive({ elmJsonFolder: work })

    assert.deepEqual(checkArchive({ elmJsonFolder: work }), Result.Ok(4))

    writeFileSync(path.join(fork.folder, 'src', 'Html.elm'), 'module Html exposing (text, div)\n')
    writeManifest([{ commit: commitAll(fork.folder, 'second'), git: fork.folder, packageName: 'elm/html' }])

    const error = errorOf(checkArchive({ elmJsonFolder: work }))

    assert.match(error, /does not match/)
    assert.match(error, /different: patches\/elm\/html\/1\.0\.1\/src\/Html\.elm/)
    assert.match(error, /different: patches\/elm\/html\/1\.0\.1\/source\.txt/)
  })

  it('builds an archive that the patcher accepts', () => {
    const fork = createFork('elm/html')
    const elmHome = path.join(work, 'elm-home')
    const project = path.join(work, 'project')

    writeManifest([{ commit: fork.commit, git: fork.folder, packageName: 'elm/html' }])
    buildArchive({ elmJsonFolder: work })
    mkdirSync(project)
    writeFileSync(
      path.join(project, 'elm.json'),
      JSON.stringify({
        dependencies: { direct: { 'elm/html': '1.0.1' }, indirect: {} },
        'elm-version': '0.19.1',
        'source-directories': ['src'],
        'test-dependencies': { direct: {}, indirect: {} },
        type: 'application',
      })
    )

    // The patch folder stands for the archive inside it.
    assert.equal(patchKernel({ elmHome, elmJsonFolder: project, patches: folder }).tag, 'Ok')

    assert.deepEqual(readdirSync(path.join(elmHome, '0.19.1', 'packages', 'elm', 'html', '1.0.1')).sort(), [
      'LICENSE',
      'elm.json',
      'source.txt',
      'src',
    ])
  })

  it('stops the patcher on a patch folder without an archive', () => {
    initManifest({ elmJsonFolder: work })
    writeFileSync(path.join(work, 'elm.json'), JSON.stringify({ 'elm-version': '0.19.1' }))

    assert.match(
      errorOf(prepareArgs({ elmJsonFolder: work, patches: 'elm-kernel-patcher' })),
      /No patches\.tar\.gz in .*elm-kernel-patcher\.\n\nHow to fix:\n {4}Build the archive with `cli-elm-kernel-patcher archive build --elmJsonFolder [^`]+`\.$/
    )
  })

  it('asks for init when there is no manifest, and for build when there is no archive', () => {
    assert.match(
      errorOf(buildArchive({ elmJsonFolder: work })),
      /elm-kernel-patcher\.json does not exist\.\n\nHow to fix:\n {4}Create it with `cli-elm-kernel-patcher archive init --elmJsonFolder [^`]+`\.$/
    )

    initManifest({ elmJsonFolder: work })

    // The check stops before it fetches anything, so the manifest of this package needs no network here.
    assert.match(
      errorOf(checkArchive({ elmJsonFolder: work })),
      /patches\.tar\.gz does not exist\.\n\nHow to fix:\n {4}Build the archive first with `cli-elm-kernel-patcher archive build --elmJsonFolder [^`]+`\.$/
    )
  })

  it('puts the cause of a failure on its own lines, below the summary', () => {
    writeManifest([{ commit: '0'.repeat(40), git: path.join(work, 'missing'), packageName: 'elm/html' }])

    const [summary, ...cause] = errorOf(buildArchive({ elmJsonFolder: work })).split('\n')

    assert.match(summary ?? '', /^Git could not fetch 0{40} from .*missing$/)
    assert.ok(cause.length > 0, 'the cause of Git should follow on its own lines')
  })

  it('stops on a commit that the repository does not have', () => {
    const fork = createFork('elm/html')

    writeManifest([{ commit: '0'.repeat(40), git: fork.folder, packageName: 'elm/html' }])

    assert.match(errorOf(buildArchive({ elmJsonFolder: work })), /Git could not fetch 0{40}/)
    assert.equal(existsSync(archive), false, 'no archive should be written')
  })

  it('stops on a commit that holds another package', () => {
    const fork = createFork('elm/browser')

    writeManifest([{ commit: fork.commit, git: fork.folder, packageName: 'elm/html' }])

    assert.match(errorOf(buildArchive({ elmJsonFolder: work })), /holds elm\/browser, not elm\/html\./)
  })

  it('stops on a commit without a license', () => {
    const fork = createFork('elm/html', { withoutLicense: true })

    writeManifest([{ commit: fork.commit, git: fork.folder, packageName: 'elm/html' }])

    assert.match(errorOf(buildArchive({ elmJsonFolder: work })), /has no LICENSE\./)
  })

  it('refuses a package that appears twice', () => {
    const fork = createFork('elm/html')
    const entry = { commit: fork.commit, git: fork.folder, packageName: 'elm/html' }

    writeManifest([entry, entry])

    assert.match(errorOf(buildArchive({ elmJsonFolder: work })), /elm\/html appears more than once/)
  })

  it('refuses a short commit hash and a manifest without a list of patches', () => {
    const fork = createFork('elm/html')

    writeManifest([{ commit: fork.commit.slice(0, 7), git: fork.folder, packageName: 'elm/html' }])
    assert.match(
      errorOf(buildArchive({ elmJsonFolder: work })),
      /elm\/html in .* needs "packageName", "git" and a full 40 character "commit"/
    )

    writeFileSync(manifest, JSON.stringify({ patches: { 'elm/html': { commit: fork.commit, git: fork.folder } } }))
    assert.match(errorOf(buildArchive({ elmJsonFolder: work })), /needs a "patches" list/)
  })
})
