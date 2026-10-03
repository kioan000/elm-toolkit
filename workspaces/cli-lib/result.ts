/**
 * The result of work that can fail, with the functions of `Result` in `elm/core`.
 *
 * A `Result<E, A>` is either `Ok` with a value or `Err` with an error. Return it
 * from a function that can fail, instead of throwing, so that the failure is in
 * the signature and the caller has to handle it. Only the outermost function,
 * which knows how to report a failure, takes the error out.
 *
 * The functions keep the names of Elm, and the error type comes first, as in
 * `Result error value`. They are methods, so that the steps read from top to
 * bottom:
 *
 * ```TypeScript
 *   Result.fromAttempt(() => fs.readFileSync('elm.json', 'utf8'))
 *     .map((text) => text.trim())
 *     .mapError((caught) => CliError.fromUnknown('could not read elm.json', caught))
 * ```
 *
 * The ones that create or combine results live on `Result` itself: `Ok`, `Err`,
 * `fromMaybe`, `map2` to `map5`, with the results first and the function last,
 * and `fromAttempt`. Elm has no `fromAttempt`, because Elm code never throws; it
 * turns a call that can throw into a result.
 *
 * @packageDocumentation
 */

import { Maybe } from './maybe.ts'

/**
 * Either the value of work that succeeded, or the error of work that failed.
 * Read it with `withDefault`, or with a `switch` on `tag`, which must handle
 * both cases.
 *
 * @example
 *
 * Report the outcome of reading a file
 * ```TypeScript
 *   const read: Result<string, number> = Result.Err('elm.json is missing')
 *
 *   switch (read.tag) {
 *     case 'Ok':
 *       return read.value
 *     case 'Err':
 *       return read.error // 'elm.json is missing'
 *   }
 * ```
 */
export type Result<E, A> = OkCase<E, A> | ErrCase<E, A>

/**
 * The methods that every result has. Each one handles both cases with a
 * `switch`, as a `case` expression does in Elm.
 *
 * @example
 *
 * Chain two methods
 * ```TypeScript
 *   Result.Ok(32).map((n) => n * 2).withDefault(0) // 64
 * ```
 */
export abstract class ResultMethods<E, A> {
  /**
   * Changes the value of a success, and keeps an error as it is.
   *
   * @example
   *
   * Double a count
   * ```TypeScript
   *   Result.Ok(32).map((n) => n * 2) // Ok 64
   *   Result.Err('failed').map((n: number) => n * 2) // Err 'failed'
   * ```
   *
   * @param f - the change
   * @returns `Ok` the changed value, or the same `Err`
   */
  public map<B>(this: Result<E, A>, f: (a: A) => B): Result<E, B> {
    switch (this.tag) {
      case 'Ok':
        return new OkCase(f(this.value))
      case 'Err':
        return new ErrCase(this.error)
    }
  }

  /**
   * Changes the error of a failure, and keeps a success as it is.
   *
   * @example
   *
   * Name the file in an error
   * ```TypeScript
   *   Result.Err('not found').mapError((cause) => `elm.json: ${cause}`) // Err 'elm.json: not found'
   * ```
   *
   * @param f - the change
   * @returns the same `Ok`, or `Err` with the changed error
   */
  public mapError<F>(this: Result<E, A>, f: (e: E) => F): Result<F, A> {
    switch (this.tag) {
      case 'Ok':
        return new OkCase(this.value)
      case 'Err':
        return new ErrCase(f(this.error))
    }
  }

  /**
   * Chains a step that can also fail. The chain stops at the first error.
   *
   * @example
   *
   * Read a manifest, then check its list
   * ```TypeScript
   *   const hasPatches = (manifest: { patches?: unknown }): Result<string, unknown[]> =>
   *     Array.isArray(manifest.patches) ? Result.Ok(manifest.patches) : Result.Err('no patches list')
   *
   *   Result.Ok({ patches: [] }).andThen(hasPatches) // Ok []
   *   Result.Ok({}).andThen(hasPatches) // Err 'no patches list'
   * ```
   *
   * @param f - the next step, which receives the value, and may fail with an error of another type
   * @returns what `f` returns, or the same `Err`
   */
  // F joins the error of the next step, so that Result.Ok(1), whose error is never, can chain a step that fails.
  public andThen<B, F = E>(this: Result<E, A>, f: (a: A) => Result<F, B>): Result<E | F, B> {
    switch (this.tag) {
      case 'Ok':
        return f(this.value)
      case 'Err':
        return new ErrCase(this.error)
    }
  }

  /**
   * Takes the value out, or a default when the work failed. The error is lost.
   *
   * @example
   *
   * Count zero files after a failure
   * ```TypeScript
   *   Result.Ok(64).withDefault(0) // 64
   *   Result.Err('failed').withDefault(0) // 0
   * ```
   *
   * @param fallback - the value to use when this result is `Err`
   * @returns the value of this result, or `fallback`
   */
  // B lets a result whose value type is never, such as Result.Err('failed'), take a default of any type.
  public withDefault<B>(this: Result<E, A>, fallback: B): A | B {
    switch (this.tag) {
      case 'Ok':
        return this.value
      case 'Err':
        return fallback
    }
  }

  /**
   * Keeps the value of a success and forgets the error of a failure. A success
   * whose value is `null` or `undefined` becomes `Nothing` too, because a maybe
   * cannot hold those.
   *
   * @example
   *
   * Turn a result into a maybe
   * ```TypeScript
   *   Result.Ok(64).toMaybe() // Just 64
   *   Result.Err('failed').toMaybe() // Nothing
   * ```
   *
   * @returns `Just` the value, or `Nothing`
   */
  public toMaybe(this: Result<E, A>): Maybe<NonNullable<A>> {
    switch (this.tag) {
      case 'Ok':
        return this.value === null || this.value === undefined ? Maybe.Nothing : Maybe.Just(this.value)
      case 'Err':
        return Maybe.Nothing
    }
  }
}

/**
 * The result of work that succeeded. Create it with `Result.Ok`.
 *
 * @example
 *
 * Read the value after a check of the tag
 * ```TypeScript
 *   const counted = Result.Ok(64)
 *   counted.tag === 'Ok' ? counted.value : 0 // 64
 * ```
 */
export class OkCase<E, A> extends ResultMethods<E, A> {
  /** The case, for a `switch`. */
  public readonly tag = 'Ok'
  /** The value. */
  public readonly value: A

  /**
   * Wraps a value. Use `Result.Ok` instead.
   *
   * @param value - the value
   */
  public constructor(value: A) {
    super()
    this.value = value
  }
}

/**
 * The result of work that failed. Create it with `Result.Err`.
 *
 * @example
 *
 * Read the error after a check of the tag
 * ```TypeScript
 *   const failed = Result.Err('no patches')
 *   failed.tag === 'Err' ? failed.error : '' // 'no patches'
 * ```
 */
export class ErrCase<E, A> extends ResultMethods<E, A> {
  /** The error. */
  public readonly error: E
  /** The case, for a `switch`. */
  public readonly tag = 'Err'

  /**
   * Wraps an error. Use `Result.Err` instead.
   *
   * @param error - the error
   */
  public constructor(error: E) {
    super()
    this.error = error
  }
}

/**
 * Wraps the value of work that succeeded.
 *
 * @example
 *
 * Succeed with a count
 * ```TypeScript
 *   Result.Ok(64) // Ok 64
 * ```
 *
 * @param value - the value
 * @returns a result that holds `value`
 */
function Ok<A>(value: A): Result<never, A> {
  return new OkCase(value)
}

/**
 * Wraps the error of work that failed.
 *
 * @example
 *
 * Fail with a message
 * ```TypeScript
 *   Result.Err('no patches') // Err 'no patches'
 * ```
 *
 * @param error - the error
 * @returns a result that holds `error`
 */
function Err<E>(error: E): Result<E, never> {
  return new ErrCase(error)
}

/**
 * Runs a call that can throw, and returns its outcome instead. The exception is
 * kept as it is: TypeScript cannot know its type, so the error is `unknown`.
 * Turn it into an error of your own with `mapError`, for example with
 * `CliError.fromUnknown`.
 *
 * @example
 *
 * Read a file without a try block
 * ```TypeScript
 *   Result.fromAttempt(() => fs.readFileSync('elm.json', 'utf8'))
 *   // Ok '{ … }', or Err with the exception, for example an ENOENT error
 * ```
 *
 * @param work - the call, which may throw
 * @returns `Ok` what the call returns, or `Err` with what it threw
 */
function fromAttempt<A>(work: () => A): Result<unknown, A> {
  try {
    return Ok(work())
  } catch (caught) {
    return Err(caught)
  }
}

/**
 * Turns a missing value into an error.
 *
 * @example
 *
 * Require a version
 * ```TypeScript
 *   Result.fromMaybe(Maybe.Just('1.0.5'), 'no version') // Ok '1.0.5'
 *   Result.fromMaybe(Maybe.Nothing, 'no version') // Err 'no version'
 * ```
 *
 * @param maybe - the maybe to convert
 * @param error - the error to use when `maybe` is `Nothing`
 * @returns `Ok` the value, or `Err` with `error`
 */
function fromMaybe<E, A extends NonNullable<unknown>>(maybe: Maybe<A>, error: E): Result<E, A> {
  switch (maybe.tag) {
    case 'Just':
      return Ok(maybe.value)
    case 'Nothing':
      return Err(error)
  }
}

/**
 * Combines two successes. The first error wins.
 *
 * @example
 *
 * Add two counts
 * ```TypeScript
 *   Result.map2(Result.Ok(3), Result.Ok(4), (a, b) => a + b) // Ok 7
 *   Result.map2(Result.Err('first'), Result.Err('second'), (a: number, b: number) => a + b) // Err 'first'
 * ```
 *
 * @param ra - the first result
 * @param rb - the second result
 * @param f - the combination
 * @returns `Ok` the combined value, or the first `Err`
 */
function map2<E, A, B, V>(ra: Result<E, A>, rb: Result<E, B>, f: (a: A, b: B) => V): Result<E, V> {
  return ra.andThen((a) => rb.map((b) => f(a, b)))
}

/**
 * Combines three successes, like `map2`.
 *
 * @example
 *
 * Add three counts
 * ```TypeScript
 *   Result.map3(Result.Ok(1), Result.Ok(2), Result.Ok(3), (a, b, c) => a + b + c) // Ok 6
 * ```
 *
 * @param ra - the first result
 * @param rb - the second result
 * @param rc - the third result
 * @param f - the combination
 * @returns `Ok` the combined value, or the first `Err`
 */
function map3<E, A, B, C, V>(
  ra: Result<E, A>,
  rb: Result<E, B>,
  rc: Result<E, C>,
  f: (a: A, b: B, c: C) => V
): Result<E, V> {
  return ra.andThen((a) => map2(rb, rc, (b, c) => f(a, b, c)))
}

/**
 * Combines four successes, like `map2`.
 *
 * @example
 *
 * Add four counts
 * ```TypeScript
 *   const one = Result.Ok(1)
 *
 *   Result.map4(one, one, one, one, (a, b, c, d) => a + b + c + d) // Ok 4
 * ```
 *
 * @param ra - the first result
 * @param rb - the second result
 * @param rc - the third result
 * @param rd - the fourth result
 * @param f - the combination
 * @returns `Ok` the combined value, or the first `Err`
 */
function map4<E, A, B, C, D, V>(
  ra: Result<E, A>,
  rb: Result<E, B>,
  rc: Result<E, C>,
  rd: Result<E, D>,
  f: (a: A, b: B, c: C, d: D) => V
): Result<E, V> {
  return ra.andThen((a) => map3(rb, rc, rd, (b, c, d) => f(a, b, c, d)))
}

/**
 * Combines five successes, like `map2`.
 *
 * @example
 *
 * Add five counts
 * ```TypeScript
 *   const one = Result.Ok(1)
 *
 *   Result.map5(one, one, one, one, one, (a, b, c, d, e) => a + b + c + d + e) // Ok 5
 * ```
 *
 * @param ra - the first result
 * @param rb - the second result
 * @param rc - the third result
 * @param rd - the fourth result
 * @param re - the fifth result
 * @param f - the combination
 * @returns `Ok` the combined value, or the first `Err`
 */
function map5<E, A, B, C, D, F, V>(
  ra: Result<E, A>,
  rb: Result<E, B>,
  rc: Result<E, C>,
  rd: Result<E, D>,
  re: Result<E, F>,
  f: (a: A, b: B, c: C, d: D, e: F) => V
): Result<E, V> {
  return ra.andThen((a) => map4(rb, rc, rd, re, (b, c, d, e) => f(a, b, c, d, e)))
}

/**
 * The functions that create or combine results, under the same name as the
 * type. The rest are methods of each result.
 *
 * @example
 *
 * Read a file, change its text, and describe a failure
 * ```TypeScript
 *   Result.fromAttempt(() => fs.readFileSync('elm.json', 'utf8'))
 *     .map((text) => text.trim())
 *     .mapError((caught) => CliError.fromUnknown('could not read elm.json', caught))
 * ```
 */
export const Result = { Err, fromAttempt, fromMaybe, map2, map3, map4, map5, Ok }
