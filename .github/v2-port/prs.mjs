// kilocode_change - new file

/**
 * Resolves the merged PRs one v2-port tracker run processes.
 *
 * - `workflow_dispatch`: the `pr_number` input.
 * - `push` to main: each commit the push introduced, mapped to the merged PR
 *   that introduced it with `GET /repos/{repo}/commits/{sha}/pulls`. A rebase
 *   merge lands several commits of one PR, and a merge queue can land several
 *   PRs in one push, so the numbers are deduplicated: each PR is processed once.
 *   Commits with `distinct: false` already existed in the repository (a PR
 *   branch merged with a merge commit), so only the merge commit is looked up.
 *
 * Writes `prs`, a JSON array of PR numbers, to GITHUB_OUTPUT.
 * Env: GH_TOKEN, GITHUB_REPOSITORY, GITHUB_EVENT_NAME, GITHUB_EVENT_PATH,
 * PR_NUMBER (workflow_dispatch only).
 */

import fs from "node:fs"
import { pathToFileURL } from "node:url"
import { api, appendOutput, appendSummary, repo } from "../docs-sync/lib.mjs"

const SHA = /^[0-9a-f]{40}$/

/** Commit SHAs of a push event worth a PR lookup, in push order. */
export function pushShas(event) {
  const shas = (event?.commits ?? []).filter((c) => c?.distinct !== false).map((c) => c?.id)
  if (shas.length === 0 && event?.head_commit?.id) shas.push(event.head_commit.id)
  return [...new Set(shas.filter((sha) => SHA.test(String(sha))))]
}

/** Numbers of the PRs in a `commits/{sha}/pulls` reply that merged into `branch`. */
export function mergedInto(pulls, branch) {
  return (pulls ?? [])
    .filter((p) => p?.merged_at && p?.base?.ref === branch && Number.isInteger(p?.number))
    .map((p) => p.number)
}

/** Parse a workflow_dispatch PR number; throws on anything else. */
export function dispatchPr(value) {
  const text = String(value ?? "").trim()
  if (!/^[1-9]\d*$/.test(text)) throw new Error(`PR_NUMBER must be a positive integer, got ${value}`)
  return Number(text)
}

export async function resolve(eventName, event, pr) {
  if (eventName === "workflow_dispatch") return [dispatchPr(pr)]
  if (eventName !== "push") throw new Error(`unsupported event ${eventName}`)
  const branch = String(event?.ref ?? "").replace(/^refs\/heads\//, "")
  const found = new Set()
  for (const sha of pushShas(event)) {
    const pulls = await api(`/repos/${repo()}/commits/${sha}/pulls?per_page=100`)
    const numbers = mergedInto(pulls, branch)
    console.log(`${sha.slice(0, 12)}: ${numbers.length > 0 ? numbers.map((n) => `#${n}`).join(", ") : "no merged PR"}`)
    for (const n of numbers) found.add(n)
  }
  return [...found].sort((a, b) => a - b)
}

async function main() {
  const eventName = process.env.GITHUB_EVENT_NAME
  const event = eventName === "push" ? JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")) : null
  const prs = await resolve(eventName, event, process.env.PR_NUMBER)
  appendOutput("prs", JSON.stringify(prs))
  appendSummary(
    `### v2-port tracker\n\n${prs.length > 0 ? `PRs to process: ${prs.map((n) => `#${n}`).join(", ")}` : "No merged PR found for this push."}\n`,
  )
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
