export function stringifyError(error: unknown) {
	return error instanceof Error ? error.stack || error.message : String(error)
}
