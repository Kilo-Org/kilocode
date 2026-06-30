/**
 * Fork creates a new session that may live in a different directory than its source, for example
 * when a session is moved into a git worktree. The shared workspace router resolves a
 * `/session/:id/*` request to the source session's own directory, which would otherwise place the
 * forked session (and its sandbox confinement) in the source's directory instead of the requested
 * target. When the client targets a fork at an explicit directory, that directory must win.
 */
export function forkTargetDirectory(
  method: string,
  url: URL,
  headers: Record<string, string | undefined>,
): string | undefined {
  if (method !== "POST") return undefined
  if (!/^\/session\/[^/]+\/fork$/.test(url.pathname)) return undefined
  return url.searchParams.get("directory") || headers["x-kilo-directory"] || undefined
}
