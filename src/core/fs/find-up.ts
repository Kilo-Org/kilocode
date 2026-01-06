import path from "path"

/**
 * Returns a directory chain walking upward from `startDir` toward the filesystem root.
 * If `stopDir` is provided and encountered, the chain stops (inclusive).
 *
 * The returned array is ordered from closest (`startDir`) to farthest (parents).
 */
export function findUpDirectoryChain(startDir: string, stopDir?: string): string[] {
	const normalizedStart = path.resolve(startDir)
	const normalizedStop = stopDir ? path.resolve(stopDir) : undefined

	const directories: string[] = []
	let current = normalizedStart

	while (true) {
		directories.push(current)
		if (normalizedStop && current === normalizedStop) {
			break
		}
		const parent = path.dirname(current)
		if (parent === current) {
			break
		}
		current = parent
	}

	return directories
}
