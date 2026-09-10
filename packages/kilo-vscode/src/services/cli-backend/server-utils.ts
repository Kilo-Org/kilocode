/**
 * Parse the port number from CLI server startup output.
 * Matches lines like: "kilo server listening on http://127.0.0.1:12345"
 * Returns the port number or null if not found.
 */
export function parseServerPort(output: string): number | null {
  const match = output.match(/listening on http:\/\/[\w.]+:(\d+)/)
  if (!match) return null
  return parseInt(match[1]!, 10)
}
