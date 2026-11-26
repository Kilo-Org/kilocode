// kilocode_change - new file

/**
 * Resolves the merged PRs one v2-port tracker run processes.
 *
 * - `workflow_dispatch`: the `pr_number` input.
 * - `push` to main: the commits that may touch packages/opencode/, mapped to
 *   the merged PR that introduced them with `GET /repos/{repo}/commits/{sha}/pulls`.
 *   A rebase merge lands several commits of one PR, and a merge queue can land
 *   several PRs in one push, so the numbers are deduplicated: each PR is
 *   processed once.
 *   - Commits with `distinct: false` already existed in the repository (a PR
 *     branch merged with a merge commit), so they are not looked up.
 *   - A commit whose file lists are missing or empty may have been truncated
 *     in the payload, so it counts as in scope. `head_commit` is always looked up.
 *   - At most CAP commits are looked up, newest first; the rest are reported.
 *   - A failed lookup is logged and skipped. The step fails only when every
 *     lookup failed.
 *   - When in-scope commits resolve no PR, the `(#N)` suffix of a squash merge
 *     or `Merge pull request #N` in their messages is tried, and each number
 *     is checked with `GET /repos/{repo}/pulls/{N}`. If that finds nothing
 *     either, a warning names the commits so the PR can be replayed by hand.
 *
 * Writes `prs`, a JSON array of PR numbers, to GITHUB_OUTPUT.
 * Env: GH_TOKEN, GITHUB_REPOSITORY, GITHUB_EVENT_NAME, GITHUB_EVENT_PATH,
 * PR_NUMBER (workflow_dispatch only).
 */

import fs from "node:fs"
import { pathToFileURL } from "node:url"
import { api, appendOutput, appendSummary, repo } from "../docs-sync/lib.mjs"

const SHA = /^[0-9a-f]{40}$/
const SCOPE = "packages/opencode/"
export const CAP = 50
const REPLAY = "replay a missed PR with workflow_dispatch (pr_number)"

const valid = (sha) => SHA.test(String(sha))
const short = (sha) => String(sha).slice(0, 12)

/** Whether a push commit may touch packages/opencode/. Missing or empty file lists count. */
export function touchesScope(commit) {
  const lists = [commit?.added, commit?.removed, commit?.modified]
  if (!lists.every(Array.isArray)) return true
  const files = lists.flat()
  return files.length === 0 || files.some((file) => String(file).startsWith(SCOPE))
}

/**
 * Commit SHAs of a push event worth a PR lookup: distinct, in scope, plus
 * `head_commit`. Keeps the newest `cap`, with `head_commit` always last.
 */
export function pushShas(event, cap = CAP) {
  const head = valid(event?.head_commit?.id) ? event.head_commit.id : null
  const picked = (event?.commits ?? [])
    .filter((c) => c?.distinct !== false && touchesScope(c))
    .map((c) => c?.id)
    .filter((sha) => valid(sha) && sha !== head)
  const rest = [...new Set(picked)]
  const room = head ? cap - 1 : cap
  const kept = rest.slice(Math.max(0, rest.length - room))
  return { shas: head ? [...kept, head] : kept, skipped: rest.length - kept.length }
}

/** In-scope commits of a push (distinct or not), for the message fallback. */
export function scopeCommits(event) {
  const commits = (event?.commits ?? []).filter((c) => valid(c?.id) && touchesScope(c))
  const ids = new Set(commits.map((c) => c.id))
  const head = event?.head_commit
  if (valid(head?.id) && !ids.has(head.id) && touchesScope(head)) commits.push(head)
  return commits
}

/** PR numbers named by a merge commit message: `title (#N)` or `Merge pull request #N`. */
export function prRefs(message) {
  const first = String(message ?? "").split("\n")[0]
  const refs = []
  const squash = first.match(/\(#(\d+)\)\s*$/)
  if (squash) refs.push(Number(squash[1]))
  const merge = first.match(/^Merge pull request #(\d+)\b/)
  if (merge) refs.push(Number(merge[1]))
  return refs.filter((n) => Number.isInteger(n) && n > 0)
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

async function lookup(sha, branch) {
  try {
    return mergedInto(await api(`/repos/${repo()}/commits/${sha}/pulls?per_page=100`), branch)
  } catch (err) {
    console.warn(`::warning::PR lookup for ${short(sha)} failed: ${err.message}`)
    return null
  }
}

async function fromMessages(commits, branch) {
  // Newest last, like the lookups; the same cap bounds the PR reads.
  const refs = [...new Set(commits.flatMap((c) => prRefs(c.message)))].slice(-CAP)
  const found = []
  for (const n of refs) {
    try {
      const pr = await api(`/repos/${repo()}/pulls/${n}`)
      if (mergedInto([pr], branch).includes(n)) found.push(n)
      else console.log(`#${n} from a commit message is not merged into ${branch}`)
    } catch (err) {
      console.warn(`::warning::could not read #${n} from a commit message: ${err.message}`)
    }
  }
  return found
}

/** Returns `{ prs, notes }`; `notes` are step-summary lines. */
export async function resolve(eventName, event, pr) {
  if (eventName === "workflow_dispatch") return { prs: [dispatchPr(pr)], notes: [] }
  if (eventName !== "push") throw new Error(`unsupported event ${eventName}`)
  const branch = String(event?.ref ?? "").replace(/^refs\/heads\//, "")
  const notes = []
  const { shas, skipped } = pushShas(event)
  if (skipped > 0) {
    const text = `Looked up ${shas.length} commits; ${skipped} older in-scope commits were skipped. ${REPLAY}.`
    console.warn(`::warning::${text}`)
    notes.push(text)
  }

  const found = new Set()
  let failed = 0
  for (const sha of shas) {
    const numbers = await lookup(sha, branch)
    if (numbers === null) {
      failed++
      continue
    }
    console.log(`${short(sha)}: ${numbers.length > 0 ? numbers.map((n) => `#${n}`).join(", ") : "no merged PR"}`)
    for (const n of numbers) found.add(n)
  }
  if (shas.length > 0 && failed === shas.length) throw new Error(`all ${failed} PR lookups failed`)

  const scoped = scopeCommits(event)
  if (found.size === 0 && scoped.length > 0) {
    const head = event?.head_commit ? [event.head_commit] : []
    for (const n of await fromMessages([...scoped, ...head], branch)) found.add(n)
    if (found.size === 0) {
      const list = scoped.map((c) => short(c.id)).join(", ")
      const text = `No merged PR found for in-scope commits ${list}; ${REPLAY}.`
      console.warn(`::warning::${text}`)
      notes.push(text)
    }
  }
  return { prs: [...found].sort((a, b) => a - b), notes }
}

async function main() {
  const eventName = process.env.GITHUB_EVENT_NAME
  const event = eventName === "push" ? JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")) : null
  const { prs, notes } = await resolve(eventName, event, process.env.PR_NUMBER)
  appendOutput("prs", JSON.stringify(prs))
  const head = prs.length > 0 ? `PRs to process: ${prs.map((n) => `#${n}`).join(", ")}` : "No PR to process."
  appendSummary(["### v2-port tracker", "", head, ...notes.map((note) => `- ${note}`)].join("\n") + "\n")
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
