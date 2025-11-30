// kilocode_change - new file
/**
 * Given an async iterable, re-yield the chunks into line chunks
 */
export async function* chunksToLinesAsync(chunks: AsyncIterable<string>): AsyncIterable<string> {
	if (!(Symbol.asyncIterator in chunks)) {
		throw new Error("Parameter is not an asynchronous iterable")
	}
	let previous = ""
	for await (const chunk of chunks) {
		previous += chunk
		let eolIndex: number
		while ((eolIndex = previous.indexOf("\n")) >= 0) {
			const line = previous.slice(0, eolIndex)
			yield line
			previous = previous.slice(eolIndex + 1)
		}
	}
	if (previous.length > 0) {
		yield previous
	}
}

/**
 * Combines multiple async iterables into a single async iterable, interleaving
 * the values over time. Adapted from: https://stackoverflow.com/a/50586391
 */
export async function* combine<T>(...iterable: Array<AsyncIterable<T>>): AsyncIterable<T> {
	const asyncIterators = Array.from(iterable, (o) => o[Symbol.asyncIterator]())
	const results = []
	let count = asyncIterators.length
	const never = new Promise<never>(() => {})
	type PromiseResult = {
		index: number
		result: IteratorResult<T, any>
	}

	function getNext(asyncIterator: AsyncIterator<T>, index: number): Promise<PromiseResult> {
		return asyncIterator.next().then((result) => ({
			index,
			result,
		}))
	}
	const nextPromises: Array<Promise<PromiseResult | never>> = asyncIterators.map(getNext)
	try {
		while (count) {
			const { index, result } = await Promise.race(nextPromises)
			if (result.done === true) {
				nextPromises[index] = never
				results[index] = result.value
				count--
			} else {
				nextPromises[index] = getNext(asyncIterators[index], index)
				yield result.value
			}
		}
	} finally {
		for (const [index, iterator] of asyncIterators.entries()) {
			if (nextPromises[index] !== never && iterator.return !== undefined) {
				// no await here - see https://github.com/tc39/proposal-async-iteration/issues/126
				void iterator.return()
			}
		}
	}
	return results
}
