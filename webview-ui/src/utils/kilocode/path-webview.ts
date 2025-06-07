export function basename(path: string) {
	return path.replace(/^.*[/\\]/, "")
}
