/**
 * An optional value, with the functions of `Maybe` in `elm/core`.
 *
 * A `Maybe<A>` is either `Just` a value or `Nothing`. Use it where a value can
 * be missing and the caller must decide what to do, instead of `undefined`,
 * which TypeScript lets a caller forget. The value itself can never be `null` or
 * `undefined`, so there is one way only to say that it is missing.
 *
 * The functions keep the names of Elm, and they are methods, so that the steps
 * read from top to bottom: `Maybe.Just(port).map(f).withDefault(3000)`. The ones
 * that create or combine maybes, `Just`, `Nothing` and `map2` to `map5`, live on
 * `Maybe` itself, with the maybes first and the function last.
 *
 * @packageDocumentation
 */

/**
 * A value that may be missing. Read it with `withDefault`, or with a `switch`
 * on `tag`, which must handle both cases.
 *
 * @example
 *
 * Describe a port that the user may not have set
 * ```TypeScript
 *   const port: Maybe<number> = Maybe.Just(8080)
 *
 *   switch (port.tag) {
 *     case 'Just':
 *       return port.value // 8080
 *     case 'Nothing':
 *       return 3000
 *   }
 * ```
 */
export type Maybe<A extends NonNullable<unknown>> = JustCase<A> | NothingCase<A>

/**
 * The methods that every maybe has. Each one handles both cases with a
 * `switch`, as a `case` expression does in Elm.
 *
 * @example
 *
 * Chain two methods
 * ```TypeScript
 *   Maybe.Just(3).map((n) => n + 1).withDefault(0) // 4
 * ```
 */
export abstract class MaybeMethods<A extends NonNullable<unknown>> {
  /**
   * Takes the value out, or a default when it is missing.
   *
   * @example
   *
   * Fall back to a port
   * ```TypeScript
   *   Maybe.Just(8080).withDefault(3000) // 8080
   *   Maybe.Nothing.withDefault(3000) // 3000
   * ```
   *
   * @param fallback - the value to use when this maybe is `Nothing`
   * @returns the value of this maybe, or `fallback`
   */
  // B lets Maybe.Nothing, whose type is Maybe<never>, take a default of any type.
  public withDefault<B>(this: Maybe<A>, fallback: B): A | B {
    switch (this.tag) {
      case 'Just':
        return this.value
      case 'Nothing':
        return fallback
    }
  }

  /**
   * Changes the value when it is present.
   *
   * @example
   *
   * Add one
   * ```TypeScript
   *   Maybe.Just(3).map((n) => n + 1) // Just 4
   * ```
   *
   * @param f - the change
   * @returns `Just` the changed value, or `Nothing`
   */
  public map<B extends NonNullable<unknown>>(this: Maybe<A>, f: (a: A) => B): Maybe<B> {
    switch (this.tag) {
      case 'Just':
        return new JustCase(f(this.value))
      case 'Nothing':
        return new NothingCase<B>()
    }
  }

  /**
   * Chains a step that may also find nothing.
   *
   * @example
   *
   * Refuse a port that is too small
   * ```TypeScript
   *   const atLeast1024 = (port: number): Maybe<number> => (port >= 1024 ? Maybe.Just(port) : Maybe.Nothing)
   *
   *   Maybe.Just(8080).andThen(atLeast1024) // Just 8080
   *   Maybe.Just(80).andThen(atLeast1024) // Nothing
   * ```
   *
   * @param f - the next step, which receives the value
   * @returns what `f` returns, or `Nothing` when this maybe is `Nothing`
   */
  public andThen<B extends NonNullable<unknown>>(this: Maybe<A>, f: (a: A) => Maybe<B>): Maybe<B> {
    switch (this.tag) {
      case 'Just':
        return f(this.value)
      case 'Nothing':
        return new NothingCase<B>()
    }
  }
}

/**
 * A maybe that holds a value. Create it with `Maybe.Just`.
 *
 * @example
 *
 * Read the value after a check of the tag
 * ```TypeScript
 *   const port = Maybe.Just(8080)
 *   port.tag === 'Just' ? port.value : 3000 // 8080
 * ```
 */
export class JustCase<A extends NonNullable<unknown>> extends MaybeMethods<A> {
  /** The case, for a `switch`. */
  public readonly tag = 'Just'
  /** The value. */
  public readonly value: A

  /**
   * Wraps a value. Use `Maybe.Just` instead.
   *
   * @param value - the value
   */
  public constructor(value: A) {
    super()
    this.value = value
  }
}

/**
 * A maybe without a value. Use `Maybe.Nothing`, which fits any `Maybe<A>`.
 *
 * @example
 *
 * Fall back when the value is missing
 * ```TypeScript
 *   Maybe.Nothing.withDefault('elm-kernel-patcher') // 'elm-kernel-patcher'
 * ```
 */
export class NothingCase<A extends NonNullable<unknown>> extends MaybeMethods<A> {
  /** The case, for a `switch`. */
  public readonly tag = 'Nothing'
}

/**
 * Wraps a value that is present.
 *
 * @example
 *
 * Wrap a number
 * ```TypeScript
 *   Maybe.Just(3) // Just 3
 * ```
 *
 * @param value - the value, which cannot be `null` or `undefined`
 * @returns a maybe that holds `value`
 */
function Just<A extends NonNullable<unknown>>(value: A): Maybe<A> {
  return new JustCase(value)
}

/** The missing value. It fits any `Maybe<A>`. */
const Nothing: Maybe<never> = new NothingCase<never>()

/**
 * Combines two values when both are present.
 *
 * @example
 *
 * Add two numbers that may be missing
 * ```TypeScript
 *   Maybe.map2(Maybe.Just(3), Maybe.Just(4), (a, b) => a + b) // Just 7
 * ```
 *
 * @param ma - the first maybe
 * @param mb - the second maybe
 * @param f - the combination
 * @returns `Just` the combined value, or `Nothing` when any value is missing
 */
function map2<A extends NonNullable<unknown>, B extends NonNullable<unknown>, V extends NonNullable<unknown>>(
  ma: Maybe<A>,
  mb: Maybe<B>,
  f: (a: A, b: B) => V
): Maybe<V> {
  return ma.andThen((a) => mb.map((b) => f(a, b)))
}

/**
 * Combines three values when all are present, like `map2`.
 *
 * @example
 *
 * Add three numbers
 * ```TypeScript
 *   Maybe.map3(Maybe.Just(1), Maybe.Just(2), Maybe.Just(3), (a, b, c) => a + b + c) // Just 6
 * ```
 *
 * @param ma - the first maybe
 * @param mb - the second maybe
 * @param mc - the third maybe
 * @param f - the combination
 * @returns `Just` the combined value, or `Nothing` when any value is missing
 */
function map3<
  A extends NonNullable<unknown>,
  B extends NonNullable<unknown>,
  C extends NonNullable<unknown>,
  V extends NonNullable<unknown>,
>(ma: Maybe<A>, mb: Maybe<B>, mc: Maybe<C>, f: (a: A, b: B, c: C) => V): Maybe<V> {
  return ma.andThen((a) => map2(mb, mc, (b, c) => f(a, b, c)))
}

/**
 * Combines four values when all are present, like `map2`.
 *
 * @example
 *
 * Add four numbers
 * ```TypeScript
 *   const one = Maybe.Just(1)
 *
 *   Maybe.map4(one, one, one, one, (a, b, c, d) => a + b + c + d) // Just 4
 * ```
 *
 * @param ma - the first maybe
 * @param mb - the second maybe
 * @param mc - the third maybe
 * @param md - the fourth maybe
 * @param f - the combination
 * @returns `Just` the combined value, or `Nothing` when any value is missing
 */
function map4<
  A extends NonNullable<unknown>,
  B extends NonNullable<unknown>,
  C extends NonNullable<unknown>,
  D extends NonNullable<unknown>,
  V extends NonNullable<unknown>,
>(ma: Maybe<A>, mb: Maybe<B>, mc: Maybe<C>, md: Maybe<D>, f: (a: A, b: B, c: C, d: D) => V): Maybe<V> {
  return ma.andThen((a) => map3(mb, mc, md, (b, c, d) => f(a, b, c, d)))
}

/**
 * Combines five values when all are present, like `map2`.
 *
 * @example
 *
 * Add five numbers
 * ```TypeScript
 *   const one = Maybe.Just(1)
 *
 *   Maybe.map5(one, one, one, one, one, (a, b, c, d, e) => a + b + c + d + e) // Just 5
 * ```
 *
 * @param ma - the first maybe
 * @param mb - the second maybe
 * @param mc - the third maybe
 * @param md - the fourth maybe
 * @param me - the fifth maybe
 * @param f - the combination
 * @returns `Just` the combined value, or `Nothing` when any value is missing
 */
function map5<
  A extends NonNullable<unknown>,
  B extends NonNullable<unknown>,
  C extends NonNullable<unknown>,
  D extends NonNullable<unknown>,
  E extends NonNullable<unknown>,
  V extends NonNullable<unknown>,
>(
  ma: Maybe<A>,
  mb: Maybe<B>,
  mc: Maybe<C>,
  md: Maybe<D>,
  me: Maybe<E>,
  f: (a: A, b: B, c: C, d: D, e: E) => V
): Maybe<V> {
  return ma.andThen((a) => map4(mb, mc, md, me, (b, c, d, e) => f(a, b, c, d, e)))
}

/**
 * The functions that create or combine maybes, under the same name as the type.
 * The rest are methods of each maybe.
 *
 * @example
 *
 * Read an optional setting
 * ```TypeScript
 *   Maybe.Just(' patches ')
 *     .map((folder) => folder.trim())
 *     .withDefault('elm-kernel-patcher') // 'patches'
 * ```
 */
export const Maybe = { Just, map2, map3, map4, map5, Nothing }
