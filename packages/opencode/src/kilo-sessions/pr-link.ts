// Detection of the pull request (PR) linked to the current worktree, plus the
// manual override stored in session storage. Detection uses cheap local git
// signals first, then at most one REST lookup through `gh api` with a long
// negative cache and a rate-limit backoff. It never runs `gh pr view` or any
// other GraphQL-backed `gh` command on a timer. The override is the same
// Storage shape used for `session_share`.
import { Instance } from "@/kilocode/instance"
import { Storage } from "@/storage/storage"
import { Process } from "@/util/process"
import * as Log from "@opencode-ai/core/util/log"
import simpleGit from "simple-git"

export type PrLink = {
  platform: string
  prUrl: string
  prNumber: number
}

export type PrLinkOverride = PrLink | { cleared: true }

const log = Log.create({ service: "pr-link" })

// A branch with no PR must not be asked about again until the branch head or
// upstream changes. A rate limit or auth failure backs off for longer.
const negativeTtlMs = 5 * 60_000
const backoffMs = 15 * 60_000

function platformFromHost(host: string): string {
  const label = host.replace(/^www\./, "").split(".")[0]
  return label || host
}

function extractPrNumber(pathname: string): number | undefined {
  // GitHub: /owner/repo/pull/N
  let match = pathname.match(/^\/[^/]+\/[^/]+\/pull\/(\d+)(?:\/.*)?$/)
  if (match) return Number(match[1])

  // GitLab: /owner/repo/merge_requests/N and /owner/repo/-/merge_requests/N
  match = pathname.match(/\/merge_requests\/(\d+)\/?$/)
  if (match) return Number(match[1])

  // Generic: /pull/N and /pull-requests/N
  match = pathname.match(/\/(?:pull|pull-requests)\/(\d+)\/?$/)
  if (match) return Number(match[1])

  return undefined
}

export function parsePrUrl(url: string): PrLink | undefined {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return undefined
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined

  const number = extractPrNumber(parsed.pathname)
  if (number === undefined || number <= 0) return undefined

  parsed.hash = ""
  parsed.search = ""
  parsed.username = ""
  parsed.password = ""

  return {
    platform: platformFromHost(parsed.hostname),
    prUrl: parsed.toString(),
    prNumber: number,
  }
}

// The branch identity a lookup is keyed by: the tracking ref (or the remote plus
// the current branch when there is no upstream) plus the head commit.
type Identity = {
  key: string
  owner: string
  repo: string
  branch: string
}

type Recorded = {
  key: string | undefined
  link: PrLink
}

type CacheEntry = {
  key: string
  link: PrLink | undefined
  negativeAt: number | undefined
  inflight: Promise<PrLink | undefined> | undefined
}

// Session-output links are recorded synchronously from the session's own output
// (a `gh pr create` line, an agent message). The REST cache and the rate-limit
// backoff are module-level per worktree, bounded so a long-lived `kilo serve`
// that visits many worktrees does not grow them without limit.
type Known = { branch: string; owner: string; repo: string }
type Positive = { branch: string | undefined; link: PrLink }

const recordedLinks = new Map<string, Recorded>()
const restCache = new Map<string, CacheEntry>()
const backoffUntil = new Map<string, number>()
const knownIdentity = new Map<string, Known>()
// The last positive link seen for a worktree, keyed by the branch it belongs to.
// A REST lookup only runs for a key with no cached positive link, so when a
// head/upstream change triggers a new lookup that then fails (rate limit, auth,
// offline), the known link must still be returned instead of being dropped. It
// is never returned once the branch changed, so a failed lookup for the new
// branch cannot advertise the previous branch's PR.
const lastPositive = new Map<string, Positive>()

// Keep at most this many worktrees' state. The least recently used worktree is
// dropped; losing its state only makes its next detection start fresh.
const maxWorktrees = 64

function remember<T>(map: Map<string, T>, key: string, value: T) {
  map.delete(key)
  map.set(key, value)
  if (map.size <= maxWorktrees) return
  const oldest = map.keys().next().value
  if (oldest != null) map.delete(oldest)
}

// The head-independent part of an identity key: the tracking ref
// (`origin/feature/x`) or the `remote/branch` fallback before the first `|`. A
// recorded session-output link is kept for the branch, so a later commit on the
// same branch still matches and no lookup runs.
function branchOf(key: string) {
  return key.split("|")[0]
}

// A session-output URL only counts for this worktree when it points at the
// worktree's own GitHub repository. Anything else the session merely mentions
// (another repo's PR, a doc link) must not stick to this branch.
function repoOf(link: PrLink) {
  if (link.platform !== "github") return undefined
  let path: string
  try {
    path = new URL(link.prUrl).pathname
  } catch {
    return undefined
  }
  const match = path.match(/^\/([^/]+)\/([^/]+)\/(?:pull|pull-requests)\/\d+/)
  if (!match) return undefined
  return { owner: match[1], repo: match[2] }
}

function sameRepo(link: PrLink, repo: { owner: string; repo: string }) {
  const own = repoOf(link)
  if (!own) return false
  return own.owner === repo.owner && own.repo === repo.repo
}

// The last positive link only applies to the branch it was recorded for.
function positiveFor(worktree: string, branch: string | undefined) {
  const positive = lastPositive.get(worktree)
  if (!positive || branch == null || positive.branch !== branch) return undefined
  return positive.link
}

function githubRepo(raw: string) {
  const value = raw.trim().replace(/\/+$/, "").replace(/\.git$/i, "")
  const match =
    value.match(/^(?:ssh:\/\/)?git@github\.com[:/](.+)$/i) ?? value.match(/^https?:\/\/github\.com\/(.+)$/i)
  const slug = match?.[1]
  if (!slug) return undefined
  const [owner, repo] = slug.split("/")
  if (!owner || !repo) return undefined
  return { owner, repo }
}

// Cheap local signals only: no `gh` spawn happens here. Returns undefined when
// there is no branch or no GitHub remote, so the caller skips the lookup.
async function identityFor(worktree: string): Promise<Identity | undefined> {
  const git = simpleGit(worktree)
  const upstream = await git
    .revparse(["--abbrev-ref", "@{upstream}"])
    .then((value) => value.trim())
    .catch(() => undefined)
  const head = await git
    .revparse(["HEAD"])
    .then((value) => value.trim())
    .catch(() => undefined)
  const current = await git
    .revparse(["--abbrev-ref", "HEAD"])
    .then((value) => value.trim())
    .catch(() => undefined)

  const tracking = upstream && !upstream.endsWith("HEAD") ? upstream : undefined
  const remote = tracking ? tracking.split("/")[0] : "origin"
  const branch = tracking
    ? tracking.split("/").slice(1).join("/")
    : current && current !== "HEAD"
      ? current
      : undefined
  if (!branch) return undefined

  const url = await git
    .raw(["remote", "get-url", remote])
    .then((value) => value.trim())
    .catch(() => undefined)
  const github = url ? githubRepo(url) : undefined
  if (!github) return undefined

  return {
    key: `${tracking ?? `${remote}/${branch}`}|${head ?? ""}`,
    owner: github.owner,
    repo: github.repo,
    branch,
  }
}

function firstRestLink(text: string): PrLink | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  if (!Array.isArray(parsed)) return undefined
  const first = parsed.at(0)
  if (first == null || typeof first !== "object" || !("html_url" in first)) return undefined
  const url = first.html_url
  if (typeof url !== "string") return undefined
  return parsePrUrl(url)
}

function firstPrUrl(text: string): PrLink | undefined {
  const pattern = /https?:\/\/[^\s"'<>()[\]\\]+/g
  for (const match of text.matchAll(pattern)) {
    const link = parsePrUrl(match[0].replace(/[.,;:!?]+$/, ""))
    if (link) return link
  }
  return undefined
}

// Record a PR URL printed by the session output. Cheap prefilter first, no
// spawn. Returns the link only when it is new or changed so a caller syncs once
// per change. `detectPrLink` returns it before any REST lookup.
export function recordPrLinkText(worktree: string, text: string): PrLink | undefined {
  if (!/\/pull\/|\/pull-requests\/|\/merge_requests\//.test(text)) return undefined
  const link = firstPrUrl(text)
  if (!link) return undefined

  const known = knownIdentity.get(worktree)
  if (known && !sameRepo(link, known)) return undefined

  const key = known?.branch
  const previous = recordedLinks.get(worktree)
  if (previous && previous.link.prUrl === link.prUrl && previous.key === key) return undefined

  remember(recordedLinks, worktree, { key, link })
  remember(lastPositive, worktree, { branch: key, link })
  return link
}

async function lookup(worktree: string, identity: Identity, entry: CacheEntry): Promise<PrLink | undefined> {
  const head = encodeURIComponent(`${identity.owner}:${identity.branch}`)
  // `abort` bounds a hung `gh` (the heartbeat must not block); `timeout` stays
  // as the SIGKILL grace after the abort signal kills the process.
  const result = await Process.text(
    ["gh", "api", `repos/${identity.owner}/${identity.repo}/pulls?head=${head}&state=all`],
    { nothrow: true, cwd: worktree, timeout: 5000, abort: AbortSignal.timeout(5_000) },
  ).catch(() => undefined)

  if (!result || result.code !== 0) {
    const previous = backoffUntil.get(worktree)
    if (previous == null || previous <= Date.now()) {
      log.warn("PR link lookup failed; backing off", { worktree, code: result?.code })
    }
    remember(backoffUntil, worktree, Date.now() + backoffMs)
    return entry.link ?? positiveFor(worktree, branchOf(identity.key))
  }

  const link = firstRestLink(result.text)
  if (link) {
    entry.link = link
    entry.negativeAt = undefined
    remember(lastPositive, worktree, { branch: branchOf(identity.key), link })
    return link
  }

  entry.link = undefined
  entry.negativeAt = Date.now()
  return undefined
}

export async function detectPrLink(): Promise<PrLink | undefined> {
  const worktree = Instance.worktree
  const identity = await identityFor(worktree)
  const branch = identity ? branchOf(identity.key) : undefined
  if (identity && branch) remember(knownIdentity, worktree, { branch, owner: identity.owner, repo: identity.repo })

  const recorded = recordedLinks.get(worktree)
  if (recorded) {
    if (identity && !sameRepo(recorded.link, identity)) {
      // A URL recorded before the repository was known, for a different repo,
      // must not stick to the branch.
      recordedLinks.delete(worktree)
      const positive = lastPositive.get(worktree)
      if (positive && positive.link.prUrl === recorded.link.prUrl) lastPositive.delete(worktree)
    } else {
      if (recorded.key == null && branch) recorded.key = branch
      if (recorded.key == null || branch == null || recorded.key === branch) return recorded.link
    }
  }

  if (!identity) return undefined

  const now = Date.now()
  const existing = restCache.get(worktree)
  const reused = existing && existing.key === identity.key ? existing : undefined

  // Coalesce concurrent calls onto the in-flight lookup.
  if (reused) {
    if (reused.inflight) return reused.inflight
    if (reused.link) return reused.link
    if (reused.negativeAt != null && now - reused.negativeAt < negativeTtlMs) return undefined
  }

  const until = backoffUntil.get(worktree)
  if (until != null && now < until) return reused?.link ?? positiveFor(worktree, branch)

  const entry: CacheEntry = {
    key: identity.key,
    link: reused?.link,
    negativeAt: reused?.negativeAt,
    inflight: undefined,
  }
  const task = lookup(worktree, identity, entry)
  const tracked = task.finally(() => {
    if (entry.inflight === tracked) entry.inflight = undefined
  })
  entry.inflight = tracked
  remember(restCache, worktree, entry)
  return tracked
}

// Encode the worktree so it is a single valid path segment. Storage builds the
// file as `path.join(dir, ...key) + ".json"`; a raw absolute worktree carries a
// drive colon and path separators, which Windows rejects in a filename.
export function overrideKey(worktree: string) {
  return ["session_pr_link", encodeURIComponent(worktree)]
}

export async function writePrLinkOverride(worktree: string, value: PrLinkOverride) {
  const { AppRuntime } = await import("@/effect/app-runtime")
  return AppRuntime.runPromise(Storage.Service.use((svc) => svc.write(overrideKey(worktree), value)))
}

export async function readPrLinkOverride(worktree: string): Promise<PrLinkOverride | undefined> {
  const { AppRuntime } = await import("@/effect/app-runtime")
  return AppRuntime.runPromise(Storage.Service.use((svc) => svc.read<PrLinkOverride>(overrideKey(worktree)))).catch(
    () => undefined,
  )
}
