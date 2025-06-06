/**
 * Promise-based delay that can be aborted using an AbortSignal
 * @param ms - Milliseconds to delay
 * @param signal - AbortSignal to cancel the delay
 * @returns Promise that resolves after the delay or rejects if aborted
 */
export function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal.aborted) {
			reject(new Error("Aborted"))
			return
		}

		const timeout = setTimeout(() => {
			// Clean up the abort listener when timeout completes normally
			signal.removeEventListener("abort", abortHandler)
			resolve()
		}, ms)

		const abortHandler = () => {
			clearTimeout(timeout)
			signal.removeEventListener("abort", abortHandler)
			reject(new Error("Aborted"))
		}

		signal.addEventListener("abort", abortHandler)
	})
}
