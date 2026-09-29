// The 5-minute check that refreshes the state of PR links sessions already own.
//
// It never discovers a link: a session gets a link only from its own hard
// evidence (`recordPrCreate` / `recordPush` / `kilo pr link`), and this check
// merely asks each host whether the pull request a session already owns is
// still open. Sessions that share a repository and head branch are grouped so
// exactly one host query serves the whole group. This is the only place the
// host is queried; the session hot path never is.
import { Process } from "@/util/process"
import * as Log from "@opencode-ai/core/util/log"
import {
  clearSessionLink,
  loadSessionLinks,
  mapLimit,
  parsePrUrl,
  readSessionPrLink,
  urlRepo,
  writeSessionPrLink,
} from "@/kilo-sessions/pr-link"
import type { PrLink, SessionPrLink } from "@/kilo-sessions/pr-link"

const log = Log.create({ service: "pr-link-poller" })

export const PR_POLL_INTERVAL_MS = 5 * 60_000

const timeoutMs = 10_000

// The repository plus head branch one host query serves. `path` is the full
// project path (GitLab can hold subgroups), while `owner`/`repo` are its last
// two segments for the key and the GitHub/Bitbucket filters.
type Group = {
  host: string
  path: string
  owner: string
  repo: string
  platform: string
  headRef: string
}

// `undefined` is a definite answer ("no open pull request"), `"unknown"` is an
// inconclusive check that must keep the session's current link. A found answer
// carries the PR and, when the host reports it, the head commit.
type Answer = { link: PrLink; sha?: string } | undefined | "unknown"

// The host each platform is served from. A repository's remote is attacker
// controlled, and `platform` is only the host's first DNS label, so a host is
// trusted with a credential only when it is the platform's canonical host or a
// host the user designated through the platform CLI's own environment variable.
// Trust gates whether a credential is sent, and whether GitHub is queried at
// all: an untrusted GitHub host is inconclusive rather than pointed at with
// `gh --hostname`, which would target whatever the remote names.
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
// non-2xx, unparseable JSON — is `"unknown"`, which keeps the session's current
// link instead of clearing it on a guess.
async function getJson(url: string, headers: Record<string, string>): Promise<unknown> {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) }).catch(() => undefined)
  if (!response || !response.ok) return "unknown"
  return await response.json().catch(() => "unknown")
}

// Ask GitHub's REST API for the branch's open pull request. `head=<owner>:<branch>`
// bounds the response to that branch (GitHub returns only the pull requests from
// that head) and `state=open` means a closed pull request answers empty rather
// than staying visible the way its retained `refs/pull/<n>/head` would. `gh` is
// used so the request carries the user's existing gh authentication; a failed
// call (missing, unauthenticated, offline) is inconclusive.
async function githubOpenPr(group: Group): Promise<Answer> {
  if (!group.owner || !group.repo) return "unknown"
  if (!trustedHost("github", group.host)) return "unknown"
  const head = encodeURIComponent(`${group.owner}:${group.headRef}`)
  // A GitHub Enterprise host is not `github.com`; `gh` must be pointed at it or
  // the request would look for the repository on github.com instead.
  const host = group.host === "github.com" ? [] : ["--hostname", group.host]
  const result = await Process.text(
    ["gh", "api", ...host, `repos/${group.owner}/${group.repo}/pulls?head=${head}&state=open`],
    { nothrow: true, timeout: timeoutMs, abort: AbortSignal.timeout(timeoutMs) },
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

  const full = `${group.owner}/${group.repo}`
  let foreign = false
  for (const item of parsed) {
    // A fork or another repo with the same branch name never matches: the head
    // and base must both be the session's own repository.
    const headRepo = stringAt(item, "head", "repo", "full_name")
    const baseRepo = stringAt(item, "base", "repo", "full_name")
    const headRef = stringAt(item, "head", "ref")
    if ((headRepo && headRepo !== full) || (baseRepo && baseRepo !== full) || (headRef && headRef !== group.headRef)) {
      foreign = true
      continue
    }
    const url = stringAt(item, "html_url")
    const link = url ? parsePrUrl(url) : undefined
    if (!link) continue
    return { link, sha: stringAt(item, "head", "sha") }
  }
  // A response that held only foreign pull requests is inconclusive for this
  // group, not evidence that the session's own pull request closed.
  return foreign ? "unknown" : undefined
}

// Ask the GitLab REST API for the branch's open merge request. `source_branch`
// bounds the response to that branch and `state=opened` to open merge requests,
// so a closed merge request — whose `refs/merge-requests/<n>/head` GitLab keeps —
// answers empty instead of being linked as open. `GITLAB_TOKEN` authenticates a
// private project; a public one answers without it. A failed call is
// inconclusive. Self-hosted GitLab uses the same `/api/v4` path on its own host,
// but the token is attached only to a trusted host (the canonical one or
// `GITLAB_HOST`), so a hostile remote cannot make the poller send it.
async function gitlabOpenMr(group: Group): Promise<Answer> {
  const query = new URLSearchParams({ source_branch: group.headRef, state: "opened", per_page: "20" })
  const project = encodeURIComponent(group.path)
  const token = trustedHost("gitlab", group.host)
    ? (process.env.GITLAB_TOKEN ?? process.env.GITLAB_ACCESS_TOKEN)
    : undefined
  const headers: Record<string, string> = token ? { "PRIVATE-TOKEN": token } : {}
  const parsed = await getJson(`https://${group.host}/api/v4/projects/${project}/merge_requests?${query}`, headers)
  if (!Array.isArray(parsed)) return "unknown"
  if (parsed.length === 0) return undefined

  let foreign = false
  for (const item of parsed) {
    // A merge request whose source project differs from its target project
    // comes from a fork; it must not stand in for the session's own MR.
    const source = Object.getOwnPropertyDescriptor(item, "source_project_id")?.value
    const target = Object.getOwnPropertyDescriptor(item, "target_project_id")?.value
    const sourceBranch = stringAt(item, "source_branch")
    if (
      (typeof source === "number" && typeof target === "number" && source !== target) ||
      (sourceBranch && sourceBranch !== group.headRef)
    ) {
      foreign = true
      continue
    }
    const url = stringAt(item, "web_url")
    const link = url ? parsePrUrl(url) : undefined
    if (!link) continue
    return { link, sha: stringAt(item, "sha") }
  }
  return foreign ? "unknown" : undefined
}

// Ask the Bitbucket Cloud REST API for the branch's open pull request. The `q`
// filter bounds the response to the branch's source and to OPEN state, so a
// closed pull request answers empty instead of being linked as open.
// `BITBUCKET_TOKEN` (or a `BITBUCKET_USERNAME`/`BITBUCKET_APP_PASSWORD` pair)
// authenticates a private repository; a public one answers without it.
// Bitbucket Server is a different API, so a non-Cloud host stays inconclusive
// rather than guessing from refs that are not advertised.
async function bitbucketOpenPr(group: Group): Promise<Answer> {
  if (group.host !== "bitbucket.org") return "unknown"
  const query = new URLSearchParams({
    q: bitbucketQuery(group.headRef),
    pagelen: "20",
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
    `https://api.bitbucket.org/2.0/repositories/${group.path}/pullrequests?${query}`,
    headers,
  )
  if (parsed == null || typeof parsed !== "object" || !("values" in parsed)) return "unknown"
  const values = (parsed as { values?: unknown }).values
  if (!Array.isArray(values)) return "unknown"
  if (values.length === 0) return undefined

  let foreign = false
  for (const item of values) {
    // Both the source and destination repositories must be the session's own;
    // a fork PR with the same branch name must not match.
    const source = stringAt(item, "source", "repository", "full_name")
    const destination = stringAt(item, "destination", "repository", "full_name")
    const branch = stringAt(item, "source", "branch", "name")
    if (
      (source && source !== group.path) ||
      (destination && destination !== group.path) ||
      (branch && branch !== group.headRef)
    ) {
      foreign = true
      continue
    }
    const url = stringAt(item, "links", "html", "href")
    const link = url ? parsePrUrl(url) : undefined
    if (!link) continue
    return { link, sha: stringAt(item, "source", "commit", "hash") }
  }
  return foreign ? "unknown" : undefined
}

async function queryHost(group: Group): Promise<Answer> {
  if (group.platform === "github") return githubOpenPr(group)
  if (group.platform === "gitlab") return gitlabOpenMr(group)
  if (group.platform === "bitbucket") return bitbucketOpenPr(group)
  return "unknown"
}

// The repository and head branch a session's link is keyed by, derived from the
// link URL alone: no git spawn, so refreshing many sessions is one listing plus
// one query per distinct repository/branch.
function groupOf(record: SessionPrLink): Group | undefined {
  if (!record.headRef) return undefined
  const repo = urlRepo(record.link)
  if (!repo) return undefined
  const segments = repo.path.split("/")
  return {
    host: repo.host,
    path: repo.path,
    owner: segments.at(-2) ?? "",
    repo: segments.at(-1) ?? "",
    platform: record.link.platform,
    headRef: record.headRef,
  }
}

// The links a refresh should check: one session's own link for `kilo pr status`,
// or every stored link for the 5-minute check.
async function linksToRefresh(sessionId?: string): Promise<Map<string, SessionPrLink>> {
  if (!sessionId) return loadSessionLinks()
  const record = await readSessionPrLink(sessionId)
  return record ? new Map([[sessionId, record]]) : new Map()
}

// Refresh the state of the links sessions already own. With `sessionId`, only
// that session's link is checked, so `kilo pr status` makes one host call
// instead of one per unrelated session's pull request. Host queries run with a
// bounded concurrency so a large number of distinct pull requests cannot
// serialize into a wait that grows with the count (each call is bounded by a
// 10s host timeout).
export async function refreshPrLink(opts?: { sessionId?: string; concurrency?: number }): Promise<void> {
  const links = await linksToRefresh(opts?.sessionId)
  if (links.size === 0) return

  const groups = new Map<string, { group: Group; sessions: string[] }>()
  for (const [sessionId, record] of links) {
    const group = groupOf(record)
    if (!group) continue
    const key = [group.host, group.owner, group.repo, group.headRef].join("\n")
    const entry = groups.get(key)
    if (entry) entry.sessions.push(sessionId)
    else groups.set(key, { group, sessions: [sessionId] })
  }

  await mapLimit([...groups.values()], opts?.concurrency ?? 8, async ({ group, sessions }) => {
    const answer = await queryHost(group)
    if (answer === "unknown") return
    for (const sessionId of sessions) {
      const record = links.get(sessionId)
      if (!record) continue
      if (answer === undefined) {
        await clearSessionLink(sessionId)
        continue
      }
      if (answer.link.prUrl !== record.link.prUrl) continue
      const next: SessionPrLink = { ...record, headRef: group.headRef }
      if (answer.sha) next.headSha = answer.sha
      await writeSessionPrLink(sessionId, next)
    }
  })
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
