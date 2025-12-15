import pRetry from "p-retry"

let factor: number | undefined

/**
 * Sets the retry factor for pRetry to 0 so that tests aren't
 * waiting around forever on retries
 */
export function setFetchRetryFactorForTests(): { unset: () => void } {
	factor = 0
	return {
		unset: (): void => {
			factor = undefined
		},
	}
}

export interface FetchWithRetriesOptions extends RequestInit {
	url: string
	retries?: number
	timeout?: number
	shouldRetry?: (res: Response) => boolean
}

function is5xxError(status: number): boolean {
	return status >= 500 && status <= 599
}

/**
 * Like fetch, but with timeouts via AbortSignal and retries via the p-retry
 */
export async function fetchWithRetries({
	url,
	retries = 5,
	timeout = 10 * 1000,
	shouldRetry = (res): boolean => is5xxError(res.status),
	signal: userProvidedSignal,
	...requestInit
}: FetchWithRetriesOptions): Promise<Response> {
	try {
		return await pRetry(
			async (attemptCount: number) => {
				const timeoutSignal = AbortSignal.timeout(timeout)

				let signal: AbortSignal = timeoutSignal
				let cleanup = (): void => {}

				// Avoid AbortSignal.any here because it accumulates "abort" listeners on
				// long‑lived userProvidedSignal across retries/calls.
				if (userProvidedSignal) {
					const controller = new AbortController()

					const onUserAbort = (): void => controller.abort(userProvidedSignal.reason)
					const onTimeoutAbort = (): void => controller.abort(timeoutSignal.reason)

					userProvidedSignal.addEventListener("abort", onUserAbort)
					timeoutSignal.addEventListener("abort", onTimeoutAbort)

					// If the user signal was already aborted, propagate immediately.
					if (userProvidedSignal.aborted) {
						onUserAbort()
					}

					signal = controller.signal
					cleanup = (): void => {
						userProvidedSignal.removeEventListener("abort", onUserAbort)
						timeoutSignal.removeEventListener("abort", onTimeoutAbort)
					}
				}

				// TODO: Fix this type coercion from type 'global.Response' to type 'Response'
				let res: Response
				try {
					res = await fetch(url, {
						...requestInit,
						signal,
					})
				} finally {
					cleanup()
				}

				if (shouldRetry(res) && attemptCount < retries) {
					console.log("got bad response for", url, "status", res.status, "retrying attempt", attemptCount)
					throw new ResponseNotOkayError(url, res)
				}

				return res
			},
			{ retries, randomize: true, factor },
		)
	} catch (e) {
		if (e instanceof DOMException) {
			// Timeout errors are surfaced as DOMException("TimeoutError")
			if (e.name === "TimeoutError") {
				throw new RequestTimedOutError(url, timeout, retries)
			}
			// Propagate explicit aborts (e.g., user cancellation)
			throw e
		} else {
			throw e
		}
	}
}

export class ResponseNotOkayError extends Error {
	constructor(
		public url: string,
		public res: Response,
	) {
		super(`Request to ${url} was not okay`)
	}
}

export class RequestTimedOutError extends Error {
	constructor(
		public url: string,
		public timeout: number,
		public retries: number,
	) {
		super(`Request to ${url} timed out ${retries} times each after ${timeout}ms`)
	}
}
