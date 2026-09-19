// Detection of the pull request (PR) linked to the current worktree, plus the
// manual override stored in session storage. Detection uses cheap local git
// signals only; the host is queried by the 5-minute check in
// `pr-link-poller.ts`, never on this path. The override is the same Storage
// shape used for `session_share`.
import { Instance } from "@/kilocode/instance"
import { Storage } from "@/storage/storage"
import * as Log from "@opencode-ai/core/util/log"
import simpleGit from "simple-git"

export type PrLink = {
  platform: string
  prUrl: string
  prNumber: number
}

export type PrLinkOverride = PrLink | { cleared: true }

const log = Log.create({ service: "pr-link" })

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
// can be matched against the worktree's own repository, plus the remote name,
// owner/repo and the local head so the 5-minute check can ask the host's API for
// the branch's open pull request.
export type Identity = {
  key: string
  owner: string
  repo: string
  remote: string
  branch: string
  head: string | undefined
  platform: string
  host: string
  path: string
}

// The link a process recorded for a worktree. `source: "poll"` marks a link the
// 5-minute check wrote, so a session-output record is never overwritten by a
// clear; `cleared` marks a polled link whose host no longer reports it open.
export type Recorded = {
  key: string | undefined
  link?: PrLink
  cleared?: true
  source?: "poll"
}

// Session-output links are recorded synchronously from the session's own output
// (a `gh pr create` line, an agent message). The maps are module-level per
// worktree, bounded so a long-lived `kilo serve` that visits many worktrees does
// not grow them without limit.
type Known = { branch: string; owner: string; repo: string; platform: string; host: string; path: string }

const recordedLinks = new Map<string, Recorded>()
// The record last written to disk per worktree (keyed by its serialized value),
// so an output part that carries an already-persisted link does not rewrite it.
// A failed write leaves no entry, so the next part retries instead of the record
// being lost.
const persistedRecords = new Map<string, string>()
const knownIdentity = new Map<string, Known>()

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
// recorded link is kept for the branch, so a later commit on the same branch
// still matches and no check runs.
export function branchOf(key: string) {
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

// Parse any remote form git can hold into its host, project path and platform:
// scp-style `git@host:path(.git)`, `ssh://git@host[:port]/path.git`, an HTTPS
// clone URL, and `git://host/path.git`. The host is lowercased with a leading
// `www.` and the port stripped, and the path has any trailing slash then `.git`
// removed, so a `…/proj.git/` remote yields the `proj` project, not `proj.git`.
// The platform comes from the host, so a self-hosted GitLab host behaves exactly
// like gitlab.com. `owner`/`repo` stay the last two path segments.
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

// Cheap local signals only: no host query happens here. Returns undefined when
// there is no branch or no parseable remote, so the caller skips the check.
export async function identityFor(worktree: string): Promise<Identity | undefined> {
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

  // Read the declared remote URL first: `git remote get-url` applies any
  // `url.*.insteadOf` rewrite, which could hide the declared host from identity.
  // Fall back to `git remote get-url` when the declared value is missing or is
  // not itself a remote URL: a `url.*.insteadOf` alias (`gh:owner/repo.git`) is
  // declared but unparseable on its own, and only `get-url` expands it to a real
  // host, so treating a non-empty declared value as final would lose detection.
  const declared = await git
    .raw(["config", "--get", `remote.${remote}.url`])
    .then((value) => value.trim())
    .catch(() => undefined)
  const url =
    declared && remoteRepo(declared)
      ? declared
      : await git
          .raw(["remote", "get-url", remote])
          .then((value) => value.trim())
          .catch(() => undefined)
  const repo = url ? remoteRepo(url) : undefined
  if (!repo) return undefined

  return {
    key: `${tracking ?? `${remote}/${branch}`}|${head ?? ""}`,
    owner: repo.owner,
    repo: repo.repo,
    remote,
    branch,
    head,
    platform: repo.platform,
    host: repo.host,
    path: repo.path,
  }
}

// Whether a parsed link names the worktree's own repository, for the `link_pr`
// tool. It mirrors the session-output check: when the worktree's own repository
// is known, a link for another host or project is refused, so an agent cannot
// pin an unrelated repository's URL (or a phishing one) onto the session. A
// worktree whose repository cannot be resolved has nothing to compare against,
// so the link stays accepted the way the session-output path accepts it.
export async function linkMatchesWorktree(link: PrLink, worktree: string): Promise<boolean> {
  const identity = await identityFor(worktree)
  return !identity || sameRepo(link, identity)
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
// per change. `detectPrLinkState` returns it before any check.
export function recordPrLinkText(worktree: string, text: string): PrLink | undefined {
  if (!/\/pull\/|\/pull-requests\/|\/merge_requests\//.test(text)) return undefined
  const link = firstPrUrl(text)
  if (!link) return undefined

  const known = knownIdentity.get(worktree)
  if (known && !sameRepo(link, known)) return undefined

  const key = known?.branch
  const previous = recordedLinks.get(worktree)
  if (previous && previous.link?.prUrl === link.prUrl && previous.key === key) return undefined

  remember(recordedLinks, worktree, { key, link })
  return link
}

// The link currently linked to the worktree's branch, from this process or the
// last one. It never queries the host. A `cleared` record reports cleared.
export async function detectPrLinkState(): Promise<{ link?: PrLink; cleared?: boolean }> {
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
    const foreign = recorded.link != null && identity != null && !sameRepo(recorded.link, identity)
    const stale = !foreign && branch != null && recorded.key != null && recorded.key !== branch
    if (foreign || stale) {
      // A URL recorded for a different repo or branch must not stick here.
      recordedLinks.delete(worktree)
    } else {
      if (recorded.key == null && branch) {
        // The link was recorded before detection knew the branch. Bind it now
        // and persist the verified record so the next process reads a record
        // keyed to this branch instead of one that matches any branch.
        recorded.key = branch
        await persistRecordedPrLink(worktree)
      }
      if (recorded.key == null || branch == null || recorded.key === branch) {
        if (recorded.cleared) return { cleared: true }
        if (recorded.link) return { link: recorded.link }
      }
    }
  }

  if (!identity) return {}

  // A link another process recorded outlives that process. Return it before the
  // 5-minute check so a GitLab/Bitbucket worktree — which the check covers too —
  // still shows the MR/PR the session linked. Drop it when the worktree's repo
  // or branch no longer matches. A record with no branch key is untrusted: it
  // was written before detection knew the branch, so returning it would show
  // that link on whatever branch the next process happens to be on.
  const stored = await readRecordedPrLink(worktree)
  if (stored) {
    const staleBranch = stored.key == null || stored.key !== branch
    const foreign = stored.link != null && !sameRepo(stored.link, identity)
    if (foreign || staleBranch) {
      await forgetRecordedPrLink(worktree)
    } else if (stored.cleared) {
      return { cleared: true }
    } else if (stored.link) {
      return { link: stored.link }
    }
  }

  return {}
}

export async function detectPrLink(): Promise<PrLink | undefined> {
  return (await detectPrLinkState()).link
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

// Record the link the 5-minute check found for the worktree's branch and persist
// it for the next process. `source: "poll"` marks it so a later clear only
// removes a polled link, never a session-output one. A session-output record for
// this branch is the session's own claim and outranks the check, so the check
// never relabels it `poll` (which would let a later clear remove it, or let a
// second open pull request replace it); a record for another branch is stale and
// may be replaced.
export async function writePolledPrLink(worktree: string, branch: string, link: PrLink) {
  const current = recordedLinks.get(worktree) ?? (await readRecordedPrLink(worktree))
  if (current && current.source !== "poll" && (current.key == null || current.key === branch)) return
  remember(recordedLinks, worktree, { key: branch, link, source: "poll" })
  await persistRecordedPrLink(worktree)
}

// Mark a polled link cleared after the host stopped reporting it open. Only a
// polled record (or none at all) may be cleared, and only for this branch: a
// session-output record and the `session_pr_link` override are never touched.
export async function clearPolledPrLink(worktree: string, branch: string) {
  const current = recordedLinks.get(worktree) ?? (await readRecordedPrLink(worktree))
  if (current) {
    if (current.source !== "poll") return
    if (current.key != null && current.key !== branch) return
  }
  remember(recordedLinks, worktree, { key: branch, cleared: true, source: "poll" })
  await persistRecordedPrLink(worktree)
}

// Persist the link this process recorded from the session's own output, so a
// later CLI process can return it. `recordedLinks` dies with the process; a
// GitLab/Bitbucket link has no REST lookup to recover it, so the write here is
// what keeps `kilo pr status` showing it after the session exits. Callers invoke
// this for every output part that carries a PR URL: an unchanged record already
// on disk is a no-op, and a failed write is logged and retried on the next part
// instead of rejecting into the caller — the session watcher awaits this before
// the immediate `session_pr_link` ingest, and `recordPrLinkText` reports an
// unchanged URL only once, so a lost write would never be attempted again. A
// record written before detection knew the branch carries no key; `detectPrLink`
// then binds it and rewrites the record with the verified key (a reader treats a
// keyless record as untrusted). The dedup entry is dropped by
// `forgetRecordedPrLink`, so a record detection removed is written again by the
// next persist.
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
