// kilocode_change - file added

/**
 * Format bytes into human-readable size
 * @param bytes - The number of bytes to format
 * @returns Formatted string (e.g., "1.5 MB", "230.0 KB")
 */
export function formatFileSize(bytes: number): string {
	if (bytes === 0) return "0 B"
	const k = 1024
	const sizes = ["B", "KB", "MB", "GB"]
	const i = Math.floor(Math.log(bytes) / Math.log(k))
	return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}
