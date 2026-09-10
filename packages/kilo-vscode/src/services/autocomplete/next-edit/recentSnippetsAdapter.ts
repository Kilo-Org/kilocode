import type { AutocompleteCodeSnippet } from "../continuedev/core/autocomplete/types"
import * as vscode from "vscode"
import type { MercuryRecentSnippet } from "./types"

const MAX_SNIPPET_LINES = 20
const MAX_SNIPPETS = 5

/**
 * Convert kilocode's already-collected `RecentlyVisitedRangesService` output
 * into the shape Mercury Edit expects for the `<|recently_viewed_code_snippets|>`
 * block. Per docs: 3–5 snippets × ~20 lines, oldest → newest, excluding the
 * currently active file (the service already filters that out).
 *
 * `RecentlyVisitedRangesService.getSnippets()` returns snippets newest→oldest;
 * we reverse so Mercury sees them in chronological order.
 */
export function toMercuryRecentSnippets(
  snippets: ReadonlyArray<Pick<AutocompleteCodeSnippet, "filepath" | "content">>,
): MercuryRecentSnippet[] {
  return snippets
    .slice(0, MAX_SNIPPETS)
    .reverse()
    .map((s) => ({
      filepath: shortenPath(s.filepath),
      content: trimToLines(s.content, MAX_SNIPPET_LINES),
    }))
}

export function toAllowedMercuryRecentSnippets(
  snippets: ReadonlyArray<Pick<AutocompleteCodeSnippet, "filepath" | "content">>,
  allowed: (filepath: string) => boolean,
): MercuryRecentSnippet[] {
  return toMercuryRecentSnippets(snippets.filter((snippet) => allowed(snippet.filepath)))
}

function trimToLines(content: string, maxLines: number): string {
  const lines = content.split("\n")
  if (lines.length <= maxLines) return content
  // Center the trim window — keep the most semantically meaningful core.
  const start = Math.floor((lines.length - maxLines) / 2)
  return lines.slice(start, start + maxLines).join("\n")
}

function shortenPath(uri: string): string {
  // Convert file:// URI strings to workspace-relative paths so the prompt is compact.
  try {
    const parsed = vscode.Uri.parse(uri)
    return vscode.workspace.asRelativePath(parsed, false)
  } catch {
    return uri
  }
}
