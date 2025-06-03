import * as vscode from "vscode"

export function createDebouncedFn<TArgs extends any[], TReturn>(
	fn: (...args: TArgs) => Promise<TReturn>,
	delay: number,
): (...args: TArgs) => Promise<TReturn | null> {
	let timeoutId: NodeJS.Timeout | null = null
	let currentCancellation: vscode.CancellationTokenSource | null = null

	return async function (...args: TArgs): Promise<TReturn | null> {
		// Cancel previous request
		if (currentCancellation) {
			currentCancellation.cancel()
		}

		if (timeoutId) {
			clearTimeout(timeoutId)
		}

		return new Promise((resolve) => {
			timeoutId = setTimeout(async () => {
				currentCancellation = new vscode.CancellationTokenSource()

				try {
					const result = await fn(...args)

					// Only resolve if not cancelled
					if (!currentCancellation.token.isCancellationRequested) {
						resolve(result)
					} else {
						resolve(null)
					}
				} catch (error) {
					// All errors (including cancellation) resolve to null
					if (!(error instanceof vscode.CancellationError)) {
						console.error("Debounced function error:", error)
					}
					resolve(null)
				}
			}, delay)
		})
	}
}
