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

  // GitLab: /owner/repo/merge_requests/N and /owner/repo/-/merge_requests/N. The
  // number sits directly after `merge_requests`; a trailing page path
  // (`/diffs`) is tolerated like GitHub's `/files`, but nothing but digits may
  // precede it.
  match = pathname.match(/\/merge_requests\/(\d+)(?:\/.*)?$/)
  if (match) return Number(match[1])

  // Generic: /pull/N and /pull-requests/N, with the same trailing-path tolerance.
  match = pathname.match(/\/(?:pull|pull-requests)\/(\d+)(?:\/.*)?$/)
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
// the current branch when there is no upstream) plus the head commit. It also
// carries the remote's platform, host and project path so a session-output URL
// can be matched against the worktree's own repository.
type Identity = {
  key: string
  owner: string
  repo: string
  branch: string
  platform: string
  host: string
  path: string
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
type Known = { branch: string; owner: string; repo: string; platform: string; host: string; path: string }
type Positive = { branch: string | undefined; link: PrLink }

const recordedLinks = new Map<string, Recorded>()
// The record last written to disk per worktree (keyed by its serialized value),
// so an output part that carries an already-persisted link does not rewrite it.
// A failed write leaves no entry, so the next part retries instead of the record
// being lost.
const persistedRecords = new Map<string, string>()
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
// worktree's own repository. Anything else the session merely mentions (another
// repo's PR, a doc link) must not stick to this branch. The project path is
// returned for the three PR shapes the shared matcher recognises: GitHub
// `/owner/repo/pull/N`, GitLab `/<group>[/<subgroup>...]/<project>/-/merge_requests/N`
// (and the `-`-less form), and Bitbucket/generic `/<workspace>/<repo>/pull-requests/N`
// (or `/pull/N` on a custom host). Anything else stays unlinked.
function urlRepo(link: PrLink) {
  let url: URL
  try {
    url = new URL(link.prUrl)
  } catch {
    return undefined
  }
  // `platformFromHost` ignores a leading `www.`; a link host must fold it too or
  // a `www.`-prefixed GitHub URL never matches a bare `github.com` worktree.
  const host = url.hostname.toLowerCase().replace(/^www\./, "")
  const path = url.pathname

  const github = path.match(/^\/([^/]+)\/([^/]+)\/pull\/\d+/)
  if (github) return { host, path: `${github[1]}/${github[2]}` }

  const generic = path.match(/^\/([^/]+)\/([^/]+)\/(?:pull-requests|pull)\/\d+/)
  if (generic) return { host, path: `${generic[1]}/${generic[2]}` }

  const gitlab = path.match(/^\/(.+?)\/(?:-\/)?merge_requests\/\d+/)
  if (gitlab) return { host, path: gitlab[1] }

  return undefined
}

// The same project path on a compatible host. Hosts compare equal, or one side
// has no dot: an SSH alias (`git@gitlab:group/proj.git`) cannot be compared to
// the web URL host, so the path decides. Two different dotted hosts never match,
// so a GitLab MR on `gitlab.other.example` cannot stick to a `gitlab.example.com`
// worktree and a GitLab mirror URL cannot stick to a `github.com` worktree.
function sameRepo(link: PrLink, identity: { host: string; path: string }) {
  const own = urlRepo(link)
  if (!own) return false
  if (own.path.toLowerCase() !== identity.path.toLowerCase()) return false
  const a = own.host
  const b = identity.host.toLowerCase()
  if (a === b) return true
  return !a.includes(".") || !b.includes(".")
}

// The last positive link only applies to the branch it was recorded for.
function positiveFor(worktree: string, branch: string | undefined) {
  const positive = lastPositive.get(worktree)
  if (!positive || branch == null || positive.branch !== branch) return undefined
  return positive.link
}

// Parse any remote form git can hold into its host, project path and platform:
// scp-style `git@host:path(.git)`, `ssh://git@host[:port]/path.git`, an HTTPS
// clone URL, and `git://host/path.git`. The host is lowercased with a leading
// `www.` and the port stripped, and the path has any trailing slash then `.git`
// removed, so a `…/proj.git/` remote yields the `proj` project, not `proj.git`.
// The platform comes from the host, so a self-hosted GitLab host behaves exactly
// like gitlab.com. `owner`/`repo` stay the last two path segments for the `gh`
// REST call.
function remoteRepo(raw: string) {
  const value = raw.trim()
  if (!value) return undefined

  let host: string | undefined
  let path: string | undefined
  const scp = value.match(/^[^/@\s]+@([^/:\s]+):(.+)$/)
  if (scp) {
    host = scp[1]
    path = scp[2]
  } else {
    let parsed: URL
    try {
      parsed = new URL(value)
    } catch {
      return undefined
    }
    if (!/^(?:https?|ssh|git):$/.test(parsed.protocol)) return undefined
    host = parsed.hostname
    path = parsed.pathname
  }

  // Strip the trailing slash before `.git` so `…/proj.git/` still ends in
  // `.git`; the empty segment filter then drops any remaining slash.
  const segments = path
    .replace(/\/+$/, "")
    .replace(/\.git$/i, "")
    .split("/")
    .filter(Boolean)
  if (!host || segments.length === 0) return undefined

  const name = host.toLowerCase().replace(/^www\./, "")
  return {
    host: name,
    path: segments.join("/"),
    platform: platformFromHost(name),
    owner: segments.at(-2) ?? "",
    repo: segments.at(-1) ?? "",
  }
}

// Cheap local signals only: no `gh` spawn happens here. Returns undefined when
// there is no branch or no parseable remote, so the caller skips the lookup.
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
  const repo = url ? remoteRepo(url) : undefined
  if (!repo) return undefined

  return {
    key: `${tracking ?? `${remote}/${branch}`}|${head ?? ""}`,
    owner: repo.owner,
    repo: repo.repo,
    branch,
    platform: repo.platform,
    host: repo.host,
    path: repo.path,
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
  if (identity && branch)
    remember(knownIdentity, worktree, {
      branch,
      owner: identity.owner,
      repo: identity.repo,
      platform: identity.platform,
      host: identity.host,
      path: identity.path,
    })

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

  // A link another process recorded from the session's own output outlives that
  // process. Return it before the REST lookup so a GitLab/Bitbucket worktree —
  // which has no REST lookup — still shows the MR/PR the session linked; a
  // GitHub record likewise skips the lookup. Drop it when the worktree's repo
  // or branch no longer matches.
  const stored = await readRecordedPrLink(worktree)
  if (stored) {
    const staleBranch = stored.key != null && stored.key !== branch
    if (!sameRepo(stored.link, identity) || staleBranch) {
      await forgetRecordedPrLink(worktree)
    } else {
      return stored.link
    }
  }

  // Only GitHub has a REST lookup here (`gh api .../pulls`), and only on the
  // canonical host. `platform` is the host's first label, so it also reads as
  // `github` for a GitHub Enterprise remote (`github.mycorp.example`);
  // `gh api` resolves its host to `api.github.com` (the remote's own host is
  // not inferred), so such a lookup fails against the default host, warns and
  // arms the backoff — or, with github.com auth, answers with the same-named
  // github.com repository. A GitLab or Bitbucket identity must not spawn `gh`
  // either; its link comes from the session's own output (or the manual
  // override) only. A remote with a single path segment
  // (`git@github.com:repo.git`) has no owner, and `repos//repo/pulls` could
  // only fail and arm the backoff, so it is skipped too.
  if (identity.host !== "github.com" || !identity.owner || !identity.repo) return undefined

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

// The same single-segment encoding for the session-output link a process
// recorded. It outlives the recording process so a later `kilo pr status`
// prints the GitLab MR or Bitbucket PR the session linked, the way a GitHub
// pull request does.
export function recordedKey(worktree: string) {
  return ["session_pr_link_recorded", encodeURIComponent(worktree)]
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

// Persist the link this process recorded from the session's own output, so a
// later CLI process can return it. `recordedLinks` dies with the process; a
// GitLab/Bitbucket link has no REST lookup to recover it, so the write here is
// what keeps `kilo pr status` showing it after the session exits. Callers invoke
// this for every output part that carries a PR URL: an unchanged record already
// on disk is a no-op, and a failed write is logged and retried on the next part
// instead of rejecting into the caller — the session watcher awaits this before
// the immediate `session_pr_link` ingest, and `recordPrLinkText` reports an
// unchanged URL only once, so a lost write would never be attempted again. The
// dedup entry is dropped by `forgetRecordedPrLink`, so a record detection
// removed is written again by the next persist.
export async function persistRecordedPrLink(worktree: string) {
  const recorded = recordedLinks.get(worktree)
  if (!recorded) return
  const value = JSON.stringify(recorded)
  if (persistedRecords.get(worktree) === value) return
  const { AppRuntime } = await import("@/effect/app-runtime")
  return AppRuntime.runPromise(Storage.Service.use((svc) => svc.write(recordedKey(worktree), recorded))).then(
    () => remember(persistedRecords, worktree, value),
    (err) => log.warn("recording the session PR link failed; retrying on the next output part", { worktree, err }),
  )
}

export async function readRecordedPrLink(worktree: string): Promise<Recorded | undefined> {
  const { AppRuntime } = await import("@/effect/app-runtime")
  return AppRuntime.runPromise(Storage.Service.use((svc) => svc.read<Recorded>(recordedKey(worktree)))).catch(
    () => undefined,
  )
}

export async function forgetRecordedPrLink(worktree: string) {
  // Drop the write-dedup entry as well: it mirrors the on-disk record, and a
  // later persist of that same link must rewrite the record this call removed
  // instead of being skipped as an unchanged write.
  persistedRecords.delete(worktree)
  const { AppRuntime } = await import("@/effect/app-runtime")
  return AppRuntime.runPromise(Storage.Service.use((svc) => svc.remove(recordedKey(worktree)))).catch(() => undefined)
}
