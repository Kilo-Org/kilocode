import fuzzysort from "fuzzysort"
import type { Command } from "./schemas"

/**
 * Minimum fuzzysort score threshold for a result to be included.
 *
 * fuzzysort scores are negative integers (0 = perfect match, more negative = worse).
 * A threshold of -10000 is permissive enough to catch reasonable partial matches
 * while filtering out near-random noise. Adjust downward (more negative) to be
 * more permissive, or upward toward 0 to be stricter.
 */
const MIN_SCORE = -10000

/**
 * Build the searchable string for a command.
 * Combines title + aliases + hideKeywords so all contribute to the fuzzy score.
 * hideKeywords appear in the search index but are NOT rendered in the UI.
 */
function buildSearchTarget(cmd: Command): string {
  return [cmd.title, ...cmd.aliases, ...cmd.hideKeywords].join(" ")
}

/**
 * Fuzzy-search a list of commands by query string.
 *
 * - Empty query returns all non-hidden commands in registration order.
 * - Results are sorted descending by fuzzysort score (best match first).
 * - Matches below `MIN_SCORE` (-10000) are filtered out.
 * - Hidden commands are always excluded.
 *
 * The search target string is: `${title} ${aliases.join(" ")} ${hideKeywords.join(" ")}`.
 * This means aliases and hideKeywords both contribute to the fuzzy match score.
 *
 * @param query - The search string entered by the user.
 * @param commands - The full list of commands to search.
 * @returns Matching commands sorted by relevance (best first).
 */
export function searchCommands(query: string, commands: Command[]): Command[] {
  const visible = commands.filter((cmd) => !cmd.hidden)

  if (!query.trim()) {
    return visible
  }

  const targets = visible.map((cmd) => ({
    cmd,
    target: buildSearchTarget(cmd),
  }))

  const results = fuzzysort.go(query, targets, {
    key: "target",
    threshold: MIN_SCORE,
  })

  return results.map((r) => r.obj.cmd)
}
