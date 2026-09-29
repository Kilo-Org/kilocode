// Hard evidence that a session owns a pull request (PR), stored per session.
//
// A wrong link is worse than no link, so a link is created only from evidence
// the session itself produced: a `gh pr create` (or host-API create) whose
// output returned the PR URL, a `git push` of the PR's head branch, or an
// explicit `kilo pr link` by the user. Merely mentioning, listing, viewing or
// reviewing a PR is never evidence, and a link is never inherited from the
// worktree, a branch name, or a previous session.
import { Storage } from "@/storage/storage"
import * as Log from "@opencode-ai/core/util/log"
import simpleGit from "simple-git"

export type PrLink = {
  platform: string
  prUrl: string
  prNumber: number
}

export type Evidence = "pr_create" | "push" | "user"

// What a session owns. `headRef` is the branch the session pushed and
// `headSha` the commit it pushed; both travel with the link in the
// `session_pr_link` ingest so a backend can verify the evidence.
export type SessionPrLink = {
  link: PrLink
  headRef?: string
  headSha?: string
  evidence: Evidence
}

const sessionPrefix = "session_pr_link_session"

export function sessionLinkKey(sessionId: string) {
  return [sessionPrefix, sessionId]
}

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
// can be matched against the worktree's own repository.
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

// The repository-only part of an identity, which is all that evidence checks
// and link matching need. Cached per worktree so a burst of output parts does
// not re-spawn git for every one.
type RepoIdentity = { owner: string; repo: string; platform: string; host: string; path: string }

const repoCache = new Map<string, RepoIdentity | undefined>()

// Keep at most this many worktrees' state. The least recently used worktree is
// dropped; losing its state only makes its next lookup start fresh.
const maxWorktrees = 64

function remember<T>(map: Map<string, T>, key: string, value: T) {
  map.delete(key)
  map.set(key, value)
  if (map.size <= maxWorktrees) return
  const oldest = map.keys().next().value
  if (oldest != null) map.delete(oldest)
}

// Run `fn` over `items` with at most `limit` in flight. A listing of thousands of
// records must not open one file per record (or launch one host query per
// session) all at once, and awaiting them serially makes a caller's latency grow
// with the count. Order is preserved in the result.
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  let cursor = 0
  const worker = async () => {
    for (;;) {
      const index = cursor++
      if (index >= items.length) return
      const item = items[index]
      if (item === undefined) continue
      out[index] = await fn(item)
    }
  }
  const size = Math.max(1, Math.min(limit, items.length))
  await Promise.all(Array.from({ length: size }, worker))
  return out
}

// A bounded per-directory identity cache. The repository a worktree points at
// does not change while a session runs, so this avoids one `git` burst per
// output part. A worktree whose repository cannot be resolved caches the miss.
async function repoFor(worktree: string): Promise<RepoIdentity | undefined> {
  if (repoCache.has(worktree)) {
    const cached = repoCache.get(worktree)
    remember(repoCache, worktree, cached)
    return cached
  }
  const identity = await identityFor(worktree).catch(() => undefined)
  const repo = identity && {
    owner: identity.owner,
    repo: identity.repo,
    platform: identity.platform,
    host: identity.host,
    path: identity.path,
  }
  remember(repoCache, worktree, repo)
  return repo
}

// A session-output URL only counts for this worktree when it points at the
// worktree's own repository. Anything else the session merely mentions (another
// repo's PR, a doc link) must not stick to this session. The project path is
// returned for the three PR shapes the shared matcher recognises: GitHub
// `/owner/repo/pull/N`, GitLab `/<group>[/<subgroup>...]/<project>/-/merge_requests/N`
// (and the `-`-less form), and Bitbucket/generic `/<workspace>/<repo>/pull-requests/N`
// (or `/pull/N` on a custom host). Anything else stays unlinked.
export function urlRepo(link: PrLink): { host: string; path: string } | undefined {
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
  const branch = tracking ? tracking.split("/").slice(1).join("/") : current && current !== "HEAD" ? current : undefined
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
// tool. It mirrors the session evidence check: when the worktree's own
// repository is known, a link for another host or project is refused, so an
// agent cannot pin an unrelated repository's URL (or a phishing one) onto the
// session. A worktree whose repository cannot be resolved has nothing to
// compare against, so the link stays accepted the way the session-output path
// accepts it.
export async function linkMatchesWorktree(link: PrLink, worktree: string): Promise<boolean> {
  const repo = await repoFor(worktree)
  return !repo || sameRepo(link, repo)
}

// The PR URL a create command printed. `gh pr create` / `glab mr create` print
// the new URL on its own line; a URL embedded in a listing, a sentence or JSON
// is a mention, not evidence, and is rejected.
function createdLink(text: string): PrLink | undefined {
  for (const raw of text.split("\n")) {
    const line = raw.trim().replace(/[.,;:!?]+$/, "")
    if (!line) continue
    const link = parsePrUrl(line)
    if (link) return link
  }
  return undefined
}

async function readValue<T>(key: string[]): Promise<T | undefined> {
  const { AppRuntime } = await import("@/effect/app-runtime")
  return AppRuntime.runPromise(Storage.Service.use((svc) => svc.read<T>(key))).catch(() => undefined)
}

async function writeValue<T>(key: string[], value: T): Promise<void> {
  const { AppRuntime } = await import("@/effect/app-runtime")
  await AppRuntime.runPromise(Storage.Service.use((svc) => svc.write(key, value)))
}

async function removeValue(key: string[]): Promise<void> {
  const { AppRuntime } = await import("@/effect/app-runtime")
  await AppRuntime.runPromise(Storage.Service.use((svc) => svc.remove(key))).catch(() => undefined)
}

// Persist the link a session owns. The same-repo check runs here so every hard
// evidence path funnels through one gate, and a link whose host/owner/repo does
// not equal the worktree's remote is refused: a fork or another repo with the
// same branch name never matches.
export async function recordSessionLink(
  sessionId: string,
  evidence: SessionPrLink,
  worktree: string,
): Promise<SessionPrLink | undefined> {
  const repo = await repoFor(worktree)
  if (!repo || !sameRepo(evidence.link, repo)) return undefined
  await writeValue(sessionLinkKey(sessionId), evidence)
  return evidence
}

export async function clearSessionLink(sessionId: string): Promise<void> {
  await removeValue(sessionLinkKey(sessionId))
}

export async function readSessionPrLink(sessionId: string): Promise<SessionPrLink | undefined> {
  return readValue<SessionPrLink>(sessionLinkKey(sessionId))
}

// Direct write for a refresh of a link a session already owns. The caller has
// the session's own URL already, so no worktree or repo re-check is needed.
export async function writeSessionPrLink(sessionId: string, record: SessionPrLink): Promise<void> {
  await writeValue(sessionLinkKey(sessionId), record)
}

// The session links for `ids`, or every stored link when `ids` is omitted. A
// heartbeat passes exactly the ids it advertises, so its read stays bounded by
// the live session count instead of growing with every record ever written; the
// 5-minute check omits `ids` because it must refresh every link. Reads run with
// a small concurrency bound so a large listing cannot exhaust file handles.
export async function loadSessionLinks(ids?: Iterable<string>): Promise<Map<string, SessionPrLink>> {
  const wanted = ids ? [...new Set(ids)] : undefined
  if (wanted && wanted.length === 0) return new Map()
  const { AppRuntime } = await import("@/effect/app-runtime")
  const keys = wanted
    ? wanted.map((sessionId) => sessionLinkKey(sessionId))
    : await AppRuntime.runPromise(Storage.Service.use((svc) => svc.list([sessionPrefix]))).catch(
        () => [] as string[][],
      )
  const entries = await mapLimit(keys, 32, async (key) => {
    const sessionId = key.at(-1)
    if (!sessionId) return undefined
    const value = await readValue<SessionPrLink>(key)
    return value ? ([sessionId, value] as const) : undefined
  })
  return new Map(entries.filter((entry): entry is readonly [string, SessionPrLink] => entry !== undefined))
}

// The output of a push names the branch and, when it is an update, the new
// commit. A new branch (`[new branch]`) carries no commit, so the caller reads
// it from git.
function parsePushOutput(text: string): { branch?: string; sha?: string } {
  for (const line of text.split("\n")) {
    const arrow = line.match(/\s(\S+)\s*->\s*(\S+)/)
    if (!arrow) continue
    const dest = arrow[2].replace(/[.,;:]+$/, "").replace(/^refs\/heads\//, "")
    if (!dest || dest === "HEAD") continue
    const range = line.match(/([0-9a-f]{7,40})\.\.+([0-9a-f]{7,40})/)
    return { branch: dest, sha: range?.[2] }
  }
  return {}
}

// The branch a `git push` command names, as a fallback when the output did not.
function parsePushCommand(command: string): string | undefined {
  const match = command.match(/(?:^|\s)git\s+push\b(.*)$/)
  if (!match) return undefined
  const args = match[1]
    .trim()
    .split(/\s+/)
    .filter((arg) => arg && !arg.startsWith("-"))
  const refspec = args[1]
  if (!refspec) return undefined
  const dest = refspec.includes(":") ? refspec.split(":").at(-1) : refspec
  return dest?.replace(/^refs\/heads\//, "") || undefined
}

function revParse(worktree: string, ref: string): Promise<string | undefined> {
  return simpleGit(worktree)
    .revparse([ref])
    .then((value) => value.trim() || undefined)
    .catch(() => undefined)
}

// True when `ancestor` is reachable from `descendant` in this worktree.
function isAncestor(worktree: string, ancestor: string, descendant: string): Promise<boolean> {
  return simpleGit(worktree)
    .raw(["merge-base", "--is-ancestor", ancestor, descendant])
    .then(() => true)
    .catch(() => false)
}

// Hard evidence (1): the session ran a create command whose output returned the
// PR URL. The link must name the worktree's own repository; the head ref and
// head commit are the branch and commit the session created from.
export async function recordPrCreate(
  sessionId: string,
  worktree: string,
  output: string,
): Promise<SessionPrLink | undefined> {
  const link = createdLink(output)
  if (!link) return undefined

  const repo = await repoFor(worktree)
  if (!repo || !sameRepo(link, repo)) return undefined

  const git = simpleGit(worktree)
  const headRef = await git
    .revparse(["--abbrev-ref", "HEAD"])
    .then((value) => value.trim())
    .catch(() => undefined)
  const headSha = await git
    .revparse(["HEAD"])
    .then((value) => value.trim())
    .catch(() => undefined)

  return recordSessionLink(
    sessionId,
    {
      link,
      headRef: headRef && headRef !== "HEAD" ? headRef : undefined,
      headSha: headSha || undefined,
      evidence: "pr_create",
    },
    worktree,
  )
}

// Hard evidence (2): the session pushed the PR's head branch. A push keeps the
// session's existing link, advancing `headSha` to the pushed commit when it
// equals or descends from the commit already recorded. A push alone does not
// name a PR, so it never creates a link; the branch, repo and commit must all
// match what the session already owns.
export async function recordPush(
  sessionId: string,
  worktree: string,
  command: string,
  output: string,
): Promise<SessionPrLink | undefined> {
  if (!/(?:^|\s)git\s+push(?:\s|$)/.test(command)) return undefined
  const current = await readSessionPrLink(sessionId)
  if (!current) return undefined
  const repo = await repoFor(worktree)
  if (!repo || !sameRepo(current.link, repo)) return undefined

  const push = parsePushOutput(output)
  const headRef = push.branch ?? parsePushCommand(command)
  if (!headRef || headRef !== current.headRef) return undefined

  const headSha = push.sha ?? (await revParse(worktree, headRef))
  if (!headSha) return undefined
  if (current.headSha && current.headSha !== headSha && !(await isAncestor(worktree, current.headSha, headSha))) {
    return undefined
  }

  const next: SessionPrLink = { ...current, headRef, headSha }
  await writeValue(sessionLinkKey(sessionId), next)
  return next
}

// Drop the per-worktree recorded links an older CLI wrote. Those were not
// per-session evidence, so they must not survive an upgrade. Returns how many
// keys were removed.
export async function pruneLegacyWorktreeLinks(): Promise<number> {
  const [{ Effect }, { AppRuntime }] = await Promise.all([import("effect"), import("@/effect/app-runtime")])
  const [recorded, overrides] = await AppRuntime.runPromise(
    Storage.Service.use((svc) => Effect.all([svc.list(["session_pr_link_recorded"]), svc.list(["session_pr_link"])])),
  ).catch(() => [[] as string[][], [] as string[][]])
  const keys = [...recorded, ...overrides]
  for (const key of keys) await removeValue(key)
  if (keys.length > 0) log.info("pruned legacy worktree PR links", { count: keys.length })
  return keys.length
}
