import type { DiffInfo } from "../types"

/**
 * Extract git diff metadata from a URI.
 * Returns DiffInfo for git/gitfs scheme URIs, undefined for regular file URIs.
 */
export function extractDiffInfo(scheme: string, query: string, fsPath: string): DiffInfo | undefined {
  if (scheme === "git" || scheme === "gitfs") {
    let gitRef: string | undefined
    if (query) {
      const refMatch = query.match(/ref=([^&]+)/)
      if (refMatch) {
        gitRef = refMatch[1]
      }
    }
    return { scheme, side: "old", gitRef, originalPath: fsPath }
  }
  return undefined
}
