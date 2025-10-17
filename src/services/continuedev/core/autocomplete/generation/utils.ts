export async function* stopAfterMaxProcessingTime(
	stream: AsyncGenerator<string>,
	maxTimeMs: number,
	fullStop: () => void,
): AsyncGenerator<string> {
	const startTime = Date.now()
	/**
	 * Check every 10 chunks to avoid performance overhead.
	 */
	const checkInterval = 10
	let chunkCount = 0

	for await (const chunk of stream) {
		yield chunk

		chunkCount++

		if (chunkCount % checkInterval === 0) {
			if (Date.now() - startTime > maxTimeMs) {
				fullStop()
				return
			}
		}
	}
}
