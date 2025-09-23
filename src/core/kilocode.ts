export function yieldPromise() {
	return new Promise<void>((resolve) => setTimeout(() => resolve(), 0))
}
