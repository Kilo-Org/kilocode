export function getBasename(path: string) {
	return path.replace(/^.*[/\\]/, "")
}

export const getExtension = (filename: string): string => {
	if (filename.startsWith(".") && !filename.includes(".", 1)) return ""
	const match = filename.match(/\.[^.]+$/)
	return match ? match[0].toLowerCase() : ""
}
