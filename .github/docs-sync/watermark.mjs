// kilocode_change - new file

/**
 * Resolves the docs-sync watermark: the timestamp of the newest source PR the
 * bot has already processed. Derived from the bot's own PRs (marker in the PR
 * body), so there is no external state to keep consistent.
 *
 * Priority: workflow_dispatch input `since` > latest open bot PR marker >
 * last merged bot PR marker > 72h ago. Hard cap: never look back more than
 * 14 days.
 */

import { appendOutput, appendSummary, repo, searchIssues } from "./lib.mjs"

const FALLBACK_HOURS = 72
const CAP_DAYS = 14
const MARKER = /<!--\s*docs-sync:\s*processed-through\s+(\S+?)\s*-->/

function extractMarker(body) {
  const m = (body ?? "").match(MARKER)
  if (!m) return null
  const d = new Date(m[1])
  return Number.isNaN(d.getTime()) ? null : d
}

async function findWatermark() {
  const r = repo()
  for (const state of ["open", "merged"]) {
    const query = `repo:${r} is:pr label:auto-docs sort:created-desc ${state === "open" ? "is:open" : "is:merged"}`
    const prs = await searchIssues(query, { maxPages: 1 })
    for (const pr of prs) {
      // Only trust markers on PRs authored by the bot itself: bodies are
      // editable and the label can be applied by anyone with triage access.
      if (pr.user?.login !== "github-actions[bot]") continue
      const marker = extractMarker(pr.body)
      if (marker) {
        console.log(`watermark from ${state} PR #${pr.number}: ${marker.toISOString()}`)
        return marker
      }
    }
  }
  return null
}

const now = new Date()
let since

const input = (process.env.INPUT_SINCE ?? "").trim()
if (input) {
  since = new Date(input)
  if (Number.isNaN(since.getTime())) {
    throw new Error(`Invalid INPUT_SINCE: ${input}`)
  }
  console.log(`watermark from dispatch input: ${since.toISOString()}`)
} else {
  since =
    (await findWatermark()) ?? new Date(now.getTime() - FALLBACK_HOURS * 3600 * 1000)
}

// A forged, edited, or malformed marker in the future would silently match
// nothing in the merged:>= search; clamp it loudly.
if (since > now) {
  console.warn(`watermark ${since.toISOString()} is in the future, clamping to now`)
  since = now
}

const cap = new Date(now.getTime() - CAP_DAYS * 24 * 3600 * 1000)
if (since < cap) {
  console.log(`watermark ${since.toISOString()} older than ${CAP_DAYS}d cap, clamping`)
  since = cap
}

appendOutput("since", since.toISOString())
appendOutput("now", now.toISOString())
appendSummary(`### docs-sync watermark\n\n- since: \`${since.toISOString()}\`\n- now: \`${now.toISOString()}\`\n`)
