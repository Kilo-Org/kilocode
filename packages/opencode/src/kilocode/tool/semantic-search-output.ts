import type { IndexingStatus } from "@kilocode/kilo-indexing/status"

/**
 * Output text for `semantic_search`.
 *
 * Split from the tool so it can be exercised without booting the indexing
 * worker: the wording is the whole point of the behavior, not an incidental
 * detail of it.
 */

export function normalizePath(value: string): string {
  return value.replaceAll("\\", "/")
}

/** Human-readable description of what was actually searched. */
export function scope(root: string, prefix?: string): string {
  return prefix ? `${root}/${normalizePath(prefix)}` : root
}

/**
 * Explain an empty result set in terms of index state.
 *
 * `KiloIndexing.search` returns `[]` when the index is disabled, unbuilt, or
 * broken, which is indistinguishable from a genuine miss. Left unexplained, a
 * model reads "no results" as "this code does not exist" and acts on it.
 */
export function reason(status?: IndexingStatus): string {
  if (!status) return "The index could not be queried, so this is not evidence that no matching code exists."
  const detail = status.message.trim()
  const suffix = detail ? ` ${detail}` : ""
  if (status.state === "Disabled") {
    return `Codebase indexing is disabled for this project, so nothing was searched.${suffix}`
  }
  if (status.state === "Error") return `Codebase indexing failed, so nothing was searched.${suffix}`
  if (status.state === "In Progress") {
    return `The index is still building (${status.percent}%, ${status.processedFiles}/${status.totalFiles} files), so results are incomplete.`
  }
  if (status.state === "Standby") return `The index is not active, so results are incomplete.${suffix}`
  return "The index is up to date, so no semantically similar code exists in this scope."
}

/**
 * Full output for a search that matched nothing.
 *
 * Always names the indexed root: only one root is indexed, but files from other
 * editor workspace folders are mentionable, so the caller needs to know that a
 * miss here does not cover them.
 */
export function empty(query: string, root: string, prefix?: string, status?: IndexingStatus): string {
  return [
    `No results for "${query}" in ${scope(root, prefix)}.`,
    reason(status),
    `Only ${root} is indexed. Files in other workspace folders are not searchable here — use Read with an absolute path.`,
  ].join("\n")
}
