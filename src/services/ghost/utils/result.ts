/**
 * Result type for consistent error handling across Ghost system.
 *
 * Use Result<T> for expected failures (e.g., network errors, file not found).
 * Use exceptions for unexpected failures (e.g., programming errors, null checks).
 *
 * @example
 * ```typescript
 * // Expected failure - return Result
 * async function fetchData(): Promise<Result<Data>> {
 *   try {
 *     const data = await api.fetch()
 *     return ok(data)
 *   } catch (error) {
 *     return err(new Error('Failed to fetch data'))
 *   }
 * }
 *
 * // Unexpected failure - throw immediately
 * function processData(data: Data | null): void {
 *   if (!data) {
 *     throw new Error('Data is required') // Programming error
 *   }
 *   // ... process data
 * }
 * ```
 */

/**
 * Result type representing either success or failure.
 * Inspired by Rust's Result<T, E> pattern.
 */
export type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E }

/**
 * Create a successful Result.
 */
export function ok<T>(value: T): Result<T, never> {
	return { ok: true, value }
}

/**
 * Create a failed Result.
 */
export function err<E = Error>(error: E): Result<never, E> {
	return { ok: false, error }
}

/**
 * Check if Result is successful.
 */
export function isOk<T, E>(result: Result<T, E>): result is { ok: true; value: T } {
	return result.ok === true
}

/**
 * Check if Result is failed.
 */
export function isErr<T, E>(result: Result<T, E>): result is { ok: false; error: E } {
	return result.ok === false
}

/**
 * Unwrap Result value or throw error.
 * Use when you're certain the Result is Ok.
 */
export function unwrap<T, E>(result: Result<T, E>): T {
	if (result.ok) {
		return result.value
	}
	throw result.error
}

/**
 * Unwrap Result value or return default.
 * Safe alternative to unwrap().
 */
export function unwrapOr<T, E>(result: Result<T, E>, defaultValue: T): T {
	return result.ok ? result.value : defaultValue
}

/**
 * Map Result value if Ok, otherwise pass through error.
 */
export function map<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
	return result.ok ? ok(fn(result.value)) : result
}

/**
 * Map Result error if Err, otherwise pass through value.
 */
export function mapErr<T, E, F>(result: Result<T, E>, fn: (error: E) => F): Result<T, F> {
	return result.ok ? result : err(fn(result.error))
}

/**
 * Chain Result operations (flatMap/bind).
 * If Result is Ok, apply function that returns new Result.
 * If Result is Err, pass through error.
 */
export function andThen<T, U, E>(result: Result<T, E>, fn: (value: T) => Result<U, E>): Result<U, E> {
	return result.ok ? fn(result.value) : result
}

/**
 * Combine multiple Results into single Result with array of values.
 * If any Result is Err, return first error.
 */
export function all<T, E>(results: Result<T, E>[]): Result<T[], E> {
	const values: T[] = []
	for (const result of results) {
		if (!result.ok) {
			return result
		}
		values.push(result.value)
	}
	return ok(values)
}

/**
 * Wrap async function to return Result instead of throwing.
 * Useful for converting promise-based APIs to Result pattern.
 */
export async function tryAsync<T>(fn: () => Promise<T>): Promise<Result<T, Error>> {
	try {
		const value = await fn()
		return ok(value)
	} catch (error) {
		return err(error instanceof Error ? error : new Error(String(error)))
	}
}

/**
 * Wrap sync function to return Result instead of throwing.
 */
export function trySync<T>(fn: () => T): Result<T, Error> {
	try {
		const value = fn()
		return ok(value)
	} catch (error) {
		return err(error instanceof Error ? error : new Error(String(error)))
	}
}

/**
 * Ghost-specific error types for better error categorization.
 */
export class GhostSnippetError extends Error {
	constructor(
		message: string,
		public readonly source: string,
	) {
		super(message)
		this.name = "GhostSnippetError"
	}
}

export class GhostContextError extends Error {
	constructor(
		message: string,
		public readonly context?: string,
	) {
		super(message)
		this.name = "GhostContextError"
	}
}

export class GhostTokenizationError extends Error {
	constructor(
		message: string,
		public readonly text?: string,
	) {
		super(message)
		this.name = "GhostTokenizationError"
	}
}

export class GhostStrategyError extends Error {
	constructor(
		message: string,
		public readonly strategy: string,
	) {
		super(message)
		this.name = "GhostStrategyError"
	}
}
