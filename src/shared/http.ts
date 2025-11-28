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
				const signals: AbortSignal[] = [AbortSignal.timeout(timeout)]

				if (userProvidedSignal) {
					signals.push(userProvidedSignal)
				}

				const signal = AbortSignal.any(signals)

				// TODO: Fix this type coercion from type 'global.Response' to type 'Response'
				const res = await fetch(url, {
					...requestInit,
					signal,
				})

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
			throw new RequestTimedOutError(url, timeout, retries)
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
