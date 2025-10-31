/**
 * Creates a sampled version of a function that only executes based on the provided sample rate.
 *
 * @param fn - The function to wrap with sampling
 * @param sampleRate - The sampling rate as a decimal (e.g., 0.01 for 1%, 0.1 for 10%)
 * @returns A new function that only executes the original function based on the sample rate
 */
export function createSampledFunction<T extends (...args: any[]) => any>(fn: T, sampleRate: number): T {
	const clampedRate = Math.max(0, Math.min(1, sampleRate))

	return ((...args: Parameters<T>) => {
		if (Math.random() < clampedRate) {
			return fn(...args)
		}
	}) as T
}
