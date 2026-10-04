/**
 * Checks that `Maybe` and `Result` behave like the modules of the same names in
 * `elm/core`, one function at a time, through their methods.
 *
 * @packageDocumentation
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { Maybe, Result } from '../index.ts'

const add = (a: number, b: number): number => a + b

describe('Maybe', () => {
  it('reads a value or falls back with withDefault', () => {
    assert.equal(Maybe.Just(8080).withDefault(3000), 8080)
    assert.equal(Maybe.Nothing.withDefault(3000), 3000)
  })

  it('changes a present value with map, and keeps Nothing', () => {
    assert.deepEqual(
      Maybe.Just(3).map((n) => n + 1),
      Maybe.Just(4)
    )
    assert.deepEqual(
      Maybe.Nothing.map((n: number) => n + 1),
      Maybe.Nothing
    )
  })

  it('combines values only when all are present, from map2 to map5', () => {
    const just = Maybe.Just(1)
    const nothing = Maybe.Nothing as Maybe<number>

    assert.deepEqual(Maybe.map2(just, just, add), Maybe.Just(2))
    assert.deepEqual(Maybe.map2(just, nothing, add), Maybe.Nothing)
    assert.deepEqual(
      Maybe.map3(just, just, just, (a, b, c) => a + b + c),
      Maybe.Just(3)
    )
    assert.deepEqual(
      Maybe.map4(just, just, just, nothing, (a, b, c, d) => a + b + c + d),
      Maybe.Nothing
    )
    assert.deepEqual(
      Maybe.map5(just, just, just, just, just, (a, b, c, d, e) => a + b + c + d + e),
      Maybe.Just(5)
    )
  })

  it('chains steps with andThen, and stops at Nothing', () => {
    const atLeast1024 = (port: number): Maybe<number> => (port >= 1024 ? Maybe.Just(port) : Maybe.Nothing)

    assert.deepEqual(Maybe.Just(8080).andThen(atLeast1024), Maybe.Just(8080))
    assert.deepEqual(Maybe.Just(80).andThen(atLeast1024), Maybe.Nothing)
    assert.deepEqual(Maybe.Nothing.andThen(atLeast1024), Maybe.Nothing)
  })

  it('chains methods from top to bottom', () => {
    assert.equal(
      Maybe.Just(' patches ')
        .map((folder) => folder.trim())
        .withDefault('elm-kernel-patcher'),
      'patches'
    )
  })
})

describe('Maybe and missing values', () => {
  it('holds falsy values such as 0 and the empty string', () => {
    assert.equal(Maybe.Just(0).withDefault(1), 0)
    assert.equal(Maybe.Just('').withDefault('fallback'), '')
  })

  it('refuses null and undefined at compile time, so Nothing is the only missing value', () => {
    const fromEnvironment = process.env.ELM_HOME

    // The tsc step of the tests fails if any of these lines compiles.
    // @ts-expect-error null is not a value of a Maybe
    assert.ok(Maybe.Just(null))
    // @ts-expect-error undefined is not a value of a Maybe
    assert.ok(Maybe.Just(undefined))
    // @ts-expect-error a value that may be undefined must be checked first
    assert.ok(Maybe.Just(fromEnvironment))
    // @ts-expect-error a change cannot produce undefined either
    assert.ok(Maybe.Just(1).map(() => undefined))
  })
})

describe('Result', () => {
  it('changes a success with map, and keeps an error as it is', () => {
    assert.deepEqual(
      Result.Ok(32).map((n) => n * 2),
      Result.Ok(64)
    )
    assert.deepEqual(
      Result.Err('failed').map((n: number) => n * 2),
      Result.Err('failed')
    )
  })

  it('combines successes from map2 to map5, and keeps the first error', () => {
    const ok: Result<string, number> = Result.Ok(1)

    assert.deepEqual(Result.map2(ok, ok, add), Result.Ok(2))
    assert.deepEqual(Result.map2(Result.Err('first'), Result.Err('second'), add), Result.Err('first'))
    assert.deepEqual(
      Result.map3(ok, ok, ok, (a, b, c) => a + b + c),
      Result.Ok(3)
    )
    assert.deepEqual(
      Result.map4(ok, ok, Result.Err('third'), ok, (a, b, c: number, d) => a + b + c + d),
      Result.Err('third')
    )
    assert.deepEqual(
      Result.map5(ok, ok, ok, ok, ok, (a, b, c, d, e) => a + b + c + d + e),
      Result.Ok(5)
    )
  })

  it('chains steps with andThen, and stops at the first error', () => {
    const positive = (n: number): Result<string, number> => (n > 0 ? Result.Ok(n) : Result.Err('not positive'))

    assert.deepEqual(Result.Ok(64).andThen(positive), Result.Ok(64))
    assert.deepEqual(Result.Ok(0).andThen(positive), Result.Err('not positive'))
    assert.deepEqual(Result.Err('earlier').andThen(positive), Result.Err('earlier'))
  })

  it('reads a value or falls back with withDefault', () => {
    assert.equal(Result.Ok(64).withDefault(0), 64)
    assert.equal(Result.Err('failed').withDefault(0), 0)
  })

  it('converts to and from Maybe', () => {
    assert.deepEqual(Result.Ok(64).toMaybe(), Maybe.Just(64))
    assert.deepEqual(Result.Err('failed').toMaybe(), Maybe.Nothing)
    assert.deepEqual(Result.Ok(undefined).toMaybe(), Maybe.Nothing)
    assert.deepEqual(Result.fromMaybe(Maybe.Just('1.0.5'), 'no version'), Result.Ok('1.0.5'))
    assert.deepEqual(Result.fromMaybe(Maybe.Nothing, 'no version'), Result.Err('no version'))
  })

  it('changes an error with mapError, and keeps a success as it is', () => {
    assert.deepEqual(
      Result.Err('not found').mapError((cause) => `elm.json: ${cause}`),
      Result.Err('elm.json: not found')
    )
    assert.deepEqual(
      Result.Ok(1).mapError((cause: string) => `elm.json: ${cause}`),
      Result.Ok(1)
    )
  })

  it('waits for a promise with fromPromise, and keeps the reason of a rejection', async () => {
    const reason = new Error('ENOENT')

    assert.deepEqual(await Result.fromPromise(Promise.resolve(64)), Result.Ok(64))
    assert.deepEqual(await Result.fromPromise(Promise.reject(reason)), Result.Err(reason))
  })

  it('chains methods from top to bottom', () => {
    const outcome = Result.fromAttempt(() => JSON.parse('{ "count": 32 }') as { count: number })
      .map((parsed) => parsed.count * 2)
      .mapError(() => 'not JSON')
      .toMaybe()

    assert.deepEqual(outcome, Maybe.Just(64))
  })
})
