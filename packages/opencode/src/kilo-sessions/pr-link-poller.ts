// The 5-minute check for an open pull request on the worktree's own remote
// branch. None of the three hosts exposes a bounded, self-cleaning ref for the
// branch's open change: GitHub keeps `refs/pull/<n>/head` for every pull request
// ever opened, GitLab keeps `refs/merge-requests/<n>/head` for closed merge
// requests, and Bitbucket does not advertise `refs/pull-requests/<n>/from` at
// all. Each host is therefore asked through its own API, bounded to the branch
// and to open state, so a closed change is never linked as open. This is the
// only place the host is queried; the session hot path never is.
import { Process } from "@/util/process"
import * as Log from "@opencode-ai/core/util/log"
import {
  branchOf,
  clearPolledPrLink,
  detectPrLinkState,
  identityFor,
  parsePrUrl,
  writePolledPrLink,
} from "@/kilo-sessions/pr-link"
import type { Identity, PrLink } from "@/kilo-sessions/pr-link"

const log = Log.create({ service: "pr-link-poller" })

export const PR_POLL_INTERVAL_MS = 5 * 60_000

const timeoutMs = 10_000

// `undefined` is a definite answer ("no open pull request"), `"unknown"` is an
// inconclusive check that must keep the branch's current link.
type Answer = PrLink | undefined | "unknown"

// The host each platform is served from. A repository's remote is attacker
// controlled, and `identity.platform` is only the host's first DNS label, so a
// host is trusted with a credential only when it is the platform's canonical
// host or a host the user designated through the platform CLI's own environment
// variable. Trust gates whether a credential is sent, and whether GitHub is
// queried at all: an untrusted GitHub host is inconclusive rather than pointed
// at with `gh --hostname`, which would target whatever the remote names.
const canonicalHost: Record<string, string> = {
  github: "github.com",
  gitlab: "gitlab.com",
  bitbucket: "bitbucket.org",
}

function designatedHost(platform: string): string | undefined {
  const value =
    platform === "github" ? process.env.GH_HOST : platform === "gitlab" ? process.env.GITLAB_HOST : undefined
  return value?.trim().toLowerCase() || undefined
}

function trustedHost(platform: string, host: string): boolean {
  const name = host.toLowerCase()
  return name === canonicalHost[platform] || name === designatedHost(platform)
}

// Escape a value for the Bitbucket `q` filter's quoted string. Git allows `\`
// and `"` in ref names, so a branch such as `a"b` must be escaped or the filter
// is malformed, the host answers 400, and the check silently never runs for it.
function quoteQ(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}

// The Bitbucket `q` filter for a branch, bounded to the branch's source and to
// OPEN state. Exported so the escaping can be asserted on every platform: a
// branch containing `"` is a valid git ref but cannot be checked out on Windows,
// where the loose ref file name is invalid, so no repo fixture can carry one.
export function bitbucketQuery(branch: string): string {
  return `source.branch.name="${quoteQ(branch)}" AND state="OPEN"`
}

// Read a nested string field without trusting the host's JSON shape.
function stringAt(value: unknown, ...keys: string[]): string | undefined {
  let current: unknown = value
  for (const key of keys) {
    if (current == null || typeof current !== "object") return undefined
    current = Object.getOwnPropertyDescriptor(current, key)?.value
  }
  return typeof current === "string" ? current : undefined
}

// GET a host API within the 10s bound. Any failure — offline, unauthorized, a
// non-2xx, unparseable JSON — is `"unknown"`, which keeps the branch's current
// link instead of clearing it on a guess.
async function getJson(url: string, headers: Record<string, string>): Promise<unknown> {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) }).catch(() => undefined)
  if (!response || !response.ok) return "unknown"
  return await response.json().catch(() => "unknown")
}

// Ask GitHub's REST API for the branch's open pull request. `head=<owner>:<branch>`
// bounds the response to that branch (GitHub returns only the pull requests from
// that head), and `state=open` means a closed pull request answers empty rather
// than staying visible the way its retained `refs/pull/<n>/head` would. `gh` is
// used so the request carries the user's existing gh authentication; a failed
// call (missing, unauthenticated, offline) is inconclusive.
async function githubOpenPr(worktree: string, identity: Identity): Promise<Answer> {
  if (!identity.owner || !identity.repo) return "unknown"
  if (!trustedHost("github", identity.host)) return "unknown"
  const head = encodeURIComponent(`${identity.owner}:${identity.branch}`)
  // A GitHub Enterprise host is not `github.com`; `gh` must be pointed at it or
  // the request would look for the repository on github.com instead.
  const host = identity.host === "github.com" ? [] : ["--hostname", identity.host]
  const result = await Process.text(
    ["gh", "api", ...host, `repos/${identity.owner}/${identity.repo}/pulls?head=${head}&state=open`],
    { nothrow: true, cwd: worktree, timeout: timeoutMs, abort: AbortSignal.timeout(timeoutMs) },
  ).catch(() => undefined)
  if (!result || result.code !== 0) return "unknown"

  let parsed: unknown
  try {
    parsed = JSON.parse(result.text)
  } catch {
    return "unknown"
  }
  if (!Array.isArray(parsed)) return "unknown"
  if (parsed.length === 0) return undefined

  const url = stringAt(parsed.at(0), "html_url")
  return url ? (parsePrUrl(url) ?? "unknown") : "unknown"
}

// Ask the GitLab REST API for the branch's open merge request. `source_branch`
// bounds the response to that branch and `state=opened` to open merge requests,
// so a closed merge request — whose `refs/merge-requests/<n>/head` GitLab keeps —
// answers empty instead of being linked as open. `GITLAB_TOKEN` authenticates a
// private project; a public one answers without it. A failed call is
// inconclusive. Self-hosted GitLab uses the same `/api/v4` path on its own host,
// but the token is attached only to a trusted host (the canonical one or
// `GITLAB_HOST`), so a hostile remote cannot make the poller send it.
async function gitlabOpenMr(identity: Identity): Promise<Answer> {
  const query = new URLSearchParams({ source_branch: identity.branch, state: "opened", per_page: "1" })
  const project = encodeURIComponent(identity.path)
  const token = trustedHost("gitlab", identity.host)
    ? (process.env.GITLAB_TOKEN ?? process.env.GITLAB_ACCESS_TOKEN)
    : undefined
  const headers: Record<string, string> = token ? { "PRIVATE-TOKEN": token } : {}
  const parsed = await getJson(`https://${identity.host}/api/v4/projects/${project}/merge_requests?${query}`, headers)
  if (!Array.isArray(parsed)) return "unknown"
  if (parsed.length === 0) return undefined

  const url = stringAt(parsed.at(0), "web_url")
  return url ? (parsePrUrl(url) ?? "unknown") : "unknown"
}

// Ask the Bitbucket Cloud REST API for the branch's open pull request. The `q`
// filter bounds the response to the branch's source and to OPEN state, so a
// closed pull request answers empty instead of being linked as open.
// `BITBUCKET_TOKEN` (or a `BITBUCKET_USERNAME`/`BITBUCKET_APP_PASSWORD` pair)
// authenticates a private repository; a public one answers without it.
// Bitbucket Server is a different API, so a non-Cloud host stays inconclusive
// rather than guessing from refs that are not advertised.
async function bitbucketOpenPr(identity: Identity): Promise<Answer> {
  if (identity.host !== "bitbucket.org") return "unknown"
  const query = new URLSearchParams({
    q: bitbucketQuery(identity.branch),
    pagelen: "1",
  })
  const token = process.env.BITBUCKET_TOKEN
  const user = process.env.BITBUCKET_USERNAME
  const password = process.env.BITBUCKET_APP_PASSWORD
  const headers: Record<string, string> = token
    ? { Authorization: `Bearer ${token}` }
    : user && password
      ? { Authorization: `Basic ${btoa(`${user}:${password}`)}` }
      : {}
  const parsed = await getJson(
    `https://api.bitbucket.org/2.0/repositories/${identity.path}/pullrequests?${query}`,
    headers,
  )
  if (parsed == null || typeof parsed !== "object" || !("values" in parsed)) return "unknown"
  const values = (parsed as { values?: unknown }).values
  if (!Array.isArray(values)) return "unknown"
  if (values.length === 0) return undefined

  const url = stringAt(values.at(0), "links", "html", "href")
  return url ? (parsePrUrl(url) ?? "unknown") : "unknown"
}

// Query the worktree's own host for an open PR/MR matching its branch. An
// inconclusive check keeps the branch's current link and clears nothing.
export async function refreshPrLink(worktree: string): Promise<PrLink | undefined> {
  const identity = await identityFor(worktree)
  if (!identity) return undefined

  const answer =
    identity.platform === "github"
      ? await githubOpenPr(worktree, identity)
      : identity.platform === "gitlab"
        ? await gitlabOpenMr(identity)
        : identity.platform === "bitbucket"
          ? await bitbucketOpenPr(identity)
          : "unknown"
  if (answer === "unknown") return (await detectPrLinkState()).link

  const key = branchOf(identity.key)
  if (answer) {
    await writePolledPrLink(worktree, key, answer)
    return answer
  }

  await clearPolledPrLink(worktree, key)
  return undefined
}

// Run the check once immediately, then every `intervalMs` (5 minutes by
// default). Overlapping runs coalesce and the timer never holds the process
// open. Returns a stop function.
export function startPrLinkPoll(run: () => Promise<void>, opts?: { intervalMs?: number }): () => void {
  let running = false
  const tick = () => {
    if (running) return
    running = true
    void run()
      .catch((err) => log.warn("PR link check failed", { err }))
      .finally(() => {
        running = false
      })
  }

  tick()
  const timer = setInterval(tick, opts?.intervalMs ?? PR_POLL_INTERVAL_MS)
  timer.unref?.()
  return () => clearInterval(timer)
}
