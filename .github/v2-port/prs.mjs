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
 *     lookup failed. Rate limits and a time budget keep the job inside its timeout.
 *   - A looked-up commit with no associated PR is tried by the `(#N)` suffix of
 *     a squash merge or `Merge pull request #N` in its subject, each number
 *     checked with `GET /repos/{repo}/pulls/{N}`. If the push resolves nothing,
 *     the subjects of its other in-scope commits are tried too. A warning names
 *     every in-scope commit left without a PR, so it can be replayed by hand.
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

// The prs job times out after 10 minutes. A rate limit is waited out for at
// most MAX_RETRY_AFTER_S per request, and no new request starts after
// BUDGET_MS, so a throttled run ends with a report instead of a timeout.
const MAX_RETRY_AFTER_S = 30
const BUDGET_MS = 6 * 60_000
const LIMITS = { maxRetryAfter: MAX_RETRY_AFTER_S }

async function lookup(sha, branch) {
  try {
    return mergedInto(await api(`/repos/${repo()}/commits/${sha}/pulls?per_page=100`, LIMITS), branch)
  } catch (err) {
    console.warn(`::warning::PR lookup for ${short(sha)} failed: ${err.message}`)
    return null
  }
}

/**
 * Verified PR numbers named in the subjects of `commits`. `budget` is shared
 * across calls: at most CAP PR reads, none after the deadline, each number read once.
 */
async function fromMessages(commits, branch, budget) {
  const found = []
  for (const n of new Set(commits.flatMap((c) => prRefs(c?.message)))) {
    if (!budget.seen.has(n)) {
      if (budget.seen.size >= CAP || Date.now() >= budget.deadline) {
        console.warn(`::warning::stopped reading PRs named in commit messages at the limit; #${n} was not checked`)
        break
      }
      budget.seen.set(n, await verified(n, branch))
    }
    if (budget.seen.get(n)) found.push(n)
  }
  return found
}

async function verified(n, branch) {
  try {
    const ok = mergedInto([await api(`/repos/${repo()}/pulls/${n}`, LIMITS)], branch).includes(n)
    if (!ok) console.log(`#${n} from a commit message is not merged into ${branch}`)
    return ok
  } catch (err) {
    console.warn(`::warning::could not read #${n} from a commit message: ${err.message}`)
    return false
  }
}

function report(notes, text) {
  console.warn(`::warning::${text}`)
  notes.push(text)
}

/** Returns `{ prs, notes }`; `notes` are step-summary lines. */
export async function resolve(eventName, event, pr, budgetMs = BUDGET_MS) {
  if (eventName === "workflow_dispatch") return { prs: [dispatchPr(pr)], notes: [] }
  if (eventName !== "push") throw new Error(`unsupported event ${eventName}`)
  const branch = String(event?.ref ?? "").replace(/^refs\/heads\//, "")
  const notes = []
  const budget = { seen: new Map(), deadline: Date.now() + budgetMs }
  const { shas, skipped } = pushShas(event)
  if (skipped > 0)
    report(notes, `Looked up ${shas.length} commits; ${skipped} older in-scope commits were skipped. ${REPLAY}.`)

  const head = event?.head_commit ? [event.head_commit] : []
  const byId = new Map([...(event?.commits ?? []), ...head].map((c) => [c?.id, c]))
  const found = new Set()
  const empty = []
  let looked = 0
  let failed = 0
  for (const sha of shas) {
    if (Date.now() >= budget.deadline) {
      report(notes, `Stopped at the time budget after ${looked} of ${shas.length} commit lookups. ${REPLAY}.`)
      break
    }
    looked++
    const numbers = await lookup(sha, branch)
    if (numbers === null) {
      failed++
      continue
    }
    console.log(`${short(sha)}: ${numbers.length > 0 ? numbers.map((n) => `#${n}`).join(", ") : "no merged PR"}`)
    if (numbers.length === 0) empty.push(byId.get(sha) ?? { id: sha })
    for (const n of numbers) found.add(n)
  }
  if (looked > 0 && failed === looked) throw new Error(`all ${failed} PR lookups failed`)

  // A commit with no associated PR may still name its PR in its subject.
  let missing = []
  for (const commit of empty) {
    const numbers = await fromMessages([commit], branch, budget)
    if (numbers.length === 0) missing.push(commit)
    for (const n of numbers) found.add(n)
  }

  // Still nothing: the PR may be named by a commit that was not looked up
  // (`distinct: false`) or by the head commit.
  const scoped = scopeCommits(event)
  if (found.size === 0 && scoped.length > 0) {
    for (const n of await fromMessages([...scoped, ...head], branch, budget)) found.add(n)
    missing = found.size === 0 ? scoped : []
  }
  if (missing.length > 0) {
    report(notes, `No merged PR found for in-scope commits ${missing.map((c) => short(c.id)).join(", ")}; ${REPLAY}.`)
  }
  return { prs: [...found].sort((a, b) => a - b), notes }
}

async function main() {
  const eventName = process.env.GITHUB_EVENT_NAME
  const event = eventName === "push" ? JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")) : null
  // Test hook: V2_PORT_BUDGET_MS shortens the time budget. The workflow never sets it.
  const budget = process.env.V2_PORT_BUDGET_MS ? Number(process.env.V2_PORT_BUDGET_MS) : BUDGET_MS
  const { prs, notes } = await resolve(eventName, event, process.env.PR_NUMBER, budget)
  appendOutput("prs", JSON.stringify(prs))
  const summary = prs.length > 0 ? `PRs to process: ${prs.map((n) => `#${n}`).join(", ")}` : "No PR to process."
  appendSummary(["### v2-port tracker", "", summary, ...notes.map((note) => `- ${note}`)].join("\n") + "\n")
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
