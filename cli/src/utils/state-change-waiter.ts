export interface StateChangeWaiter {
	waitForChange: () => Promise<void>
	notifyChanged: () => void
}

export function createStateChangeWaiter(): StateChangeWaiter {
	let resolve: (() => void) | undefined
	let promise = new Promise<void>((r) => {
		resolve = r
	})

	return {
		waitForChange: () => promise,
		notifyChanged: () => {
			resolve?.()
			promise = new Promise<void>((r) => {
				resolve = r
			})
		},
	}
}

