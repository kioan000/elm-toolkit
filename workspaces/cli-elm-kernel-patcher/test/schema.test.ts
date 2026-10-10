/**
 * Checks that the JSON schema of the manifest describes the same format that
 * the archive builder reads, so that an editor and the commands agree.
 *
 * The schema is written by hand. These tests fail when the schema and the code
 * drift apart: the manifest of this package must be valid, and each manifest
 * that the archive builder refuses must be refused by the schema too.
 *
 * @packageDocumentation
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'

import { CliError } from '@elm-toolkit/cli-lib'
import { Ajv } from 'ajv'

import { buildArchive } from '../lib/archive-builder.ts'

const lib = path.join(import.meta.dirname, '..', 'lib')
const schema = JSON.parse(readFileSync(path.join(lib, 'elm-kernel-patcher.schema.json'), 'utf8')) as object
const validate = new Ajv({ allErrors: true, strict: true }).compile(schema)
const commit = 'b35c476a69f0ba9bf8282d8c15df65e63aefea8f'
const entry = { commit, git: 'https://github.com/lydell/html.git', packageName: 'elm/html' }

// Manifests that both the schema and the archive builder refuse, with the message of the builder.
const refused: Array<{ manifest: unknown; message: RegExp; reason: string }> = [
  { manifest: {}, message: /needs a "patches" list/, reason: 'no patches' },
  {
    manifest: { patches: { 'elm/html': entry } },
    message: /needs a "patches" list/,
    reason: 'patches that are not a list',
  },
  {
    manifest: { patches: [{ ...entry, packageName: undefined }] },
    message: /needs "packageName"/,
    reason: 'an entry without a package name',
  },
  {
    manifest: { patches: [{ ...entry, git: undefined }] },
    message: /needs "packageName", "git"/,
    reason: 'an entry without a Git address',
  },
  {
    manifest: { patches: [{ ...entry, commit: 'b35c476' }] },
    message: /full 40 character "commit"/,
    reason: 'a short commit',
  },
  {
    manifest: { patches: [{ ...entry, commit: 'safe' }] },
    message: /full 40 character "commit"/,
    reason: 'a branch name',
  },
]

let work: string

describe('the schema of the manifest', () => {
  beforeEach(() => {
    work = mkdtempSync(path.join(tmpdir(), 'manifest-schema-'))
    mock.method(console, 'info', () => undefined)
  })

  afterEach(() => {
    mock.restoreAll()
    rmSync(work, { force: true, recursive: true })
  })

  it('accepts the manifest of this package, with its $schema', () => {
    const manifest = JSON.parse(readFileSync(path.join(lib, 'elm-kernel-patcher.json'), 'utf8')) as {
      $schema: string
    }

    assert.equal(validate(manifest), true, JSON.stringify(validate.errors))
    assert.equal(manifest.$schema, (schema as { $id: string }).$id, 'the manifest should point at this schema')
  })

  for (const { manifest, message, reason } of refused) {
    it(`refuses ${reason}, like the archive builder`, () => {
      // JSON drops the undefined fields, as a manifest file would not have them.
      const written = JSON.parse(JSON.stringify(manifest)) as unknown

      mkdirSync(path.join(work, 'elm-kernel-patcher'))
      writeFileSync(path.join(work, 'elm-kernel-patcher', 'elm-kernel-patcher.json'), JSON.stringify(written))

      assert.equal(validate(written), false, 'the schema should refuse it')
      const outcome = buildArchive({ elmJsonFolder: work })

      switch (outcome.type_) {
        case 'Ok':
          return assert.fail('the archive builder should refuse it')
        case 'Err':
          return assert.match(CliError.toString(outcome.error), message)
      }
    })
  }

  it('refuses a misspelled field and a package name that is not author/name, which an editor shows at once', () => {
    assert.equal(validate({ patches: [{ ...entry, comit: commit }] }), false)
    assert.equal(validate({ patches: [{ ...entry, packageName: 'html' }] }), false)
  })
})
