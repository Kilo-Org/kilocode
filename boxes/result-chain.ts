/**
 * result-chain.ts — Result type with map/flatMap/recover
 * Inspired by Effect-TS Exit<A,E> (MIT)
 * Deps: none
 */

export type Result<T, E = unknown> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E }

export const ok = <T, E = never>(value: T): Result<T, E> => ({ ok: true, value })
export const err = <E, T = never>(error: E): Result<T, E> => ({ ok: false, error })
export const isOk = <T, E>(r: Result<T, E>): r is { ok: true; value: T } => r.ok

export const map = <T, E, U>(r: Result<T, E>, f: (v: T) => U): Result<U, E> =>
  r.ok ? { ok: true, value: f(r.value) } : r

export const flatMap = <T, E, U>(r: Result<T, E>, f: (v: T) => Result<U, E>): Result<U, E> =>
  r.ok ? f(r.value) : r

export const mapError = <T, E, F>(r: Result<T, E>, f: (e: E) => F): Result<T, F> =>
  r.ok ? r : { ok: false, error: f(r.error) }

export const recover = <T, E>(r: Result<T, E>, f: (e: E) => Result<T, E>): Result<T, E> =>
  r.ok ? r : f(r.error)

export const match = <T, E, A, B>(r: Result<T, E>, ok: (v: T) => A, fail: (e: E) => B): A | B =>
  r.ok ? ok(r.value) : fail(r.error)

export const fromThrowable = <T>(fn: () => T): Result<T, Error> => {
  try { return ok(fn()) } catch (e) { return err(e instanceof Error ? e : new Error(String(e))) }
}

export const zip = <T, E, U>(a: Result<T, E>, b: Result<U, E>): Result<[T, U], E> =>
  !a.ok ? a : !b.ok ? b : { ok: true, value: [a.value, b.value] }
