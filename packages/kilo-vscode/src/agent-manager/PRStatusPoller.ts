import type { ExecFileOptionsWithStringEncoding } from "child_process"
import { existsSync } from "fs"
import type { Worktree } from "./WorktreeStateManager"
import type { PRStatus, PRCheck, PRComment, PRReviewer } from "./types"
import { execWithShellEnv } from "./shell-env"
import { execGhRead } from "./gh"
import { classifyPRError } from "./git-import"
import type { Semaphore } from "./semaphore"
import {
  parsePRResult,
  checkStatus,
  commentsSig,
  formatCheckDuration,
  parseComments,
  parseReviewers,
  summarize,
} from "./pr/am-pr-utils"
import type { PRResult, GhThread, GhReviewRequest, GhReview } from "./pr/am-pr-types"
import { withContext } from "./pr/pr-comment-context"

interface PRStatusPollerOptions {
  getWorktrees: () => Worktree[]
  getWorkspaceRoot: () => string | undefined
  onStatus: (worktreeId: string, pr: PRStatus | null, error?: "gh_missing" | "gh_auth" | "fetch_failed") => void
  log: (...args: unknown[]) => void
  intervalMs?: number
  /** Shared concurrency gate for child process spawning. */
  semaphore?: Semaphore
}

const GH_PROBE_TTL = 300_000 // 5 minutes — gh installation state rarely changes at runtime
const GH_PROBE_FAILURE_TTL = 30_000 // 30 seconds — retry faster after a failed probe
const MAX_BACKOFF = 120_000 // 2 minutes — cap for exponential backoff on repeated errors
const BACKOFF_MULTIPLIER = 2
const PR_LOOKUP_TTL = 10_000 // 10 seconds — short TTL; only the active worktree polls so this stays cheap
const FULL_SYNC_INTERVAL = 120_000 // 2 minutes — periodic sync of ALL worktrees (badges stay fresh)
const FULL_SYNC_CONCURRENCY = 3 // max parallel gh processes during a full sync (caps the burst)

export class PRStatusPoller {
  private timer: ReturnType<typeof setTimeout> | undefined
  private active = false
  private visible = true
  private busy = false
  private lastHash = new Map<string, string>()
  private lastError: string | undefined // tracks global error state for de-duplication
  private failures = 0 // consecutive failure count for backoff
  private ghAvailable: boolean | undefined
  private ghProbeTime = 0
  private rich = true
  private activeWorktreeId: string | undefined
  private cachedRepo: { owner: string; name: string; root: string } | undefined
  private prCache = new Map<string, { result: PRResult | null; expires: number }>()
  private lastFullSync = 0 // timestamp of last full (all-worktree) sync
  private readonly intervalMs: number
  private readonly semaphore: Semaphore | undefined
  private generation = 0

  private stale(generation: number): boolean {
    return generation !== this.generation
  }

  constructor(private readonly options: PRStatusPollerOptions) {
    this.intervalMs = options.intervalMs ?? 15_000
    this.semaphore = options.semaphore
  }

  /** Run a command through the shared concurrency gate (when configured). */
  private shell(
    cmd: string,
    args: string[],
    options?: Omit<ExecFileOptionsWithStringEncoding, "encoding">,
  ): Promise<{ stdout: string; stderr: string }> {
    const invoke = () => execWithShellEnv(cmd, args, options)
    return this.semaphore ? this.semaphore.run(invoke) : invoke()
  }

  private gh(
    args: string[],
    options?: Omit<ExecFileOptionsWithStringEncoding, "encoding">,
  ): Promise<{ stdout: string; stderr: string }> {
    const invoke = () => execGhRead(args, options)
    return this.semaphore ? this.semaphore.run(invoke) : invoke()
  }

  setEnabled(enabled: boolean): void {
    if (enabled) {
      if (this.active) return
      this.start()
      return
    }
    this.stop()
  }

  /** Pause/resume polling based on panel visibility. */
  setVisible(visible: boolean): void {
    if (this.visible === visible) return
    this.visible = visible
    if (!this.active) return
    if (visible) {
      // Resume — expire all PR caches and fetch all worktrees once to catch up,
      // then resume the normal active-only poll cycle.
      if (this.timer) clearTimeout(this.timer)
      this.timer = undefined
      this.prCache.clear()
      this.lastHash.clear()
      this.lastFullSync = 0
      void this.poll()
      return
    }
    // Pause — cancel pending timer
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
  }

  stop(): void {
    this.generation++
    this.active = false
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    this.busy = false
    this.lastHash.clear()
    this.lastError = undefined
    this.failures = 0
    this.ghAvailable = undefined
    this.ghProbeTime = 0
    this.rich = true
    this.cachedRepo = undefined
    this.prCache.clear()
    this.lastFullSync = 0
  }

  /** Force-refresh a specific worktree immediately, bypassing the PR cache. */
  refresh(worktreeId: string): void {
    if (!this.active) return
    const wt = this.options.getWorktrees().find((w) => w.id === worktreeId)
    if (wt) this.prCache.delete(this.key(wt.branch, wt.path))
    void this.fetchOne(worktreeId)
  }

  setActiveWorktreeId(id: string | undefined): void {
    const prev = this.activeWorktreeId
    this.activeWorktreeId = id
    // When switching to a different worktree, fetch it immediately so the
    // badge updates without waiting for the next poll cycle.
    if (id && id !== prev && this.active) void this.fetchOne(id)
  }

  private start(): void {
    this.stop()
    this.active = true
    // Don't override this.visible — it may already be set to false by
    // setVisible() before setEnabled(true) is called.
    void this.poll()
  }

  private nextDelay(): number {
    if (this.failures === 0) return this.intervalMs
    return Math.min(this.intervalMs * Math.pow(BACKOFF_MULTIPLIER, this.failures), MAX_BACKOFF)
  }

  private schedule(): void {
    if (!this.active || !this.visible) return
    const delay = this.nextDelay()
    this.timer = setTimeout(() => {
      void this.poll()
    }, delay)
  }

  private poll(): Promise<void> {
    if (!this.active || !this.visible) return Promise.resolve()
    if (this.busy) return Promise.resolve()
    this.busy = true
    const generation = this.generation
    return this.fetchAll(generation).finally(() => {
      // stop() already reset busy and bumped the generation, so a stale
      // fetch must not touch busy: a restarted poll may own it right now.
      if (this.stale(generation)) return
      this.busy = false
      this.schedule()
    })
  }

  private async probeGh(): Promise<boolean> {
    const now = Date.now()
    const ttl = this.ghAvailable === false ? GH_PROBE_FAILURE_TTL : GH_PROBE_TTL
    if (this.ghAvailable !== undefined && now - this.ghProbeTime < ttl) {
      return this.ghAvailable
    }
    try {
      await this.gh(["--version"], { timeout: 5_000 })
      this.ghAvailable = true
    } catch {
      this.ghAvailable = false
    }
    this.ghProbeTime = Date.now()
    return this.ghAvailable
  }

  private async fetchAll(generation = this.generation): Promise<void> {
    if (!(await this.probeGh())) {
      if (generation !== this.generation) return
      // De-duplicate: only emit gh_missing once, not every poll cycle
      if (this.lastError !== "gh_missing") {
        this.lastError = "gh_missing"
        for (const wt of this.options.getWorktrees()) {
          this.options.onStatus(wt.id, null, "gh_missing")
        }
      }
      this.failures++
      return
    }

    this.lastError = undefined

    // Most ticks only poll the active worktree for fast feedback. Every
    // FULL_SYNC_INTERVAL we poll ALL worktrees so badges stay current even
    // for sessions that aren't selected (e.g. CI results changing).
    // The very first poll (lastHash empty) also fetches everything.
    const worktrees = this.options.getWorktrees()
    const now = Date.now()
    const initial = this.lastHash.size === 0
    const full = initial || now - this.lastFullSync >= FULL_SYNC_INTERVAL
    const targets = full ? worktrees : worktrees.filter((wt) => wt.id === this.activeWorktreeId)
    if (full) this.lastFullSync = now

    if (targets.length === 0) {
      this.failures = 0
      return
    }

    const thunks = targets.map((wt) => () => this.fetchOne(wt.id, generation))
    const results = full
      ? await settled(thunks, FULL_SYNC_CONCURRENCY)
      : await Promise.allSettled(thunks.map((fn) => fn()))
    if (this.stale(generation)) return
    const ok = results.every((r) => r.status === "fulfilled")
    if (ok) {
      this.failures = 0
      return
    }
    this.failures++
  }

  private async fetchOne(worktreeId: string, generation = this.generation): Promise<void> {
    const wt = this.target(worktreeId)
    if (!wt) return

    try {
      const pr = await this.cachedFetchPR(wt.branch, wt.path)
      if (!pr || this.stale(generation)) {
        if (this.stale(generation)) return
        const hash = `${worktreeId}:${wt.branch}:none`
        if (this.lastHash.get(worktreeId) === hash) return
        this.lastHash.set(worktreeId, hash)
        this.options.onStatus(worktreeId, null)
        return
      }

      const [checks, reviewers, comments] = await Promise.all([
        ...this.extras(pr, wt.path),
        this.activeWorktreeId === worktreeId ? this.fetchComments(pr.number, wt.path) : undefined,
      ])
      if (this.stale(generation)) return

      const status: PRStatus = {
        number: pr.number,
        title: pr.title,
        body: pr.body,
        url: pr.url,
        state: pr.state,
        review: pr.review,
        checks,
        reviewers,
        ...(comments && {
          comments: { total: comments.total, unresolved: comments.unresolved, comments: comments.comments },
        }),
        additions: pr.additions,
        deletions: pr.deletions,
        files: pr.files,
      }

      const reviewersSig = reviewers.map((r) => `${r.login}:${r.state}`).join(",")
      const hash = `${worktreeId}:${pr.number}:${pr.title}:${pr.state}:${pr.review}:${checks.status}:${checks.passed}/${checks.total}:${reviewersSig}:${pr.body ?? ""}:${comments?.total ?? ""}:${comments?.unresolved ?? ""}:${commentsSig(comments?.comments)}`
      if (this.lastHash.get(worktreeId) === hash) return
      this.lastHash.set(worktreeId, hash)

      this.options.onStatus(worktreeId, status)
    } catch (err) {
      if (this.stale(generation)) return
      this.handleError(worktreeId, wt.branch, wt.path, err)
      throw err // propagate so fetchAll can track failures for backoff
    }
  }

  private extras(pr: PRResult, cwd: string) {
    return [pr.checks ?? this.fetchChecks(pr.number, cwd), pr.reviewers ?? this.fetchReviewers(pr.number, cwd)] as const
  }

  private handleError(worktreeId: string, branch: string, cwd: string, err: unknown): void {
    const msg = err instanceof Error ? err.message : String(err)
    const kind = existsSync(cwd) ? classifyPRError(msg) : "unknown"
    this.options.log(`PR fetch failed for ${branch}:`, msg)
    const key = kind === "gh_missing" ? "gh_missing" : kind === "gh_auth" ? "gh_auth" : "fetch_failed"
    if (kind === "gh_missing") this.ghAvailable = false
    const hash = `${worktreeId}:error:${key}`
    if (this.lastHash.get(worktreeId) === hash) return
    this.lastHash.set(worktreeId, hash)
    this.options.onStatus(worktreeId, null, key)
  }

  private target(worktreeId: string): Worktree | undefined {
    if (!this.options.getWorkspaceRoot()) return
    const worktree = this.options.getWorktrees().find((item) => item.id === worktreeId)
    if (!worktree || !existsSync(worktree.path)) return
    return worktree
  }

  private static readonly BASE_JSON_FIELDS =
    "number,title,body,url,state,isDraft,reviewDecision,additions,deletions,changedFiles,headRefName,headRefOid"
  private static readonly PR_JSON_FIELDS = `${PRStatusPoller.BASE_JSON_FIELDS},statusCheckRollup,reviewRequests,reviews`

  /** Return a cached PR lookup if still fresh, otherwise fetch and cache.
   *  Keyed by branch name so multiple worktrees on the same branch share
   *  the cache, and a branch switch in a worktree naturally misses. */
  private async cachedFetchPR(branch: string, cwd: string): Promise<PRResult | null> {
    const key = this.key(branch, cwd)
    const cached = this.prCache.get(key)
    if (cached && Date.now() < cached.expires) return cached.result
    const result = await this.fetchPRForBranch(branch, cwd)
    this.prCache.set(key, { result, expires: Date.now() + PR_LOOKUP_TTL })
    return result
  }

  private key(branch: string, cwd: string): string {
    return `${this.options.getWorkspaceRoot() ?? cwd}\0${branch === "HEAD" ? cwd : branch}`
  }

  private async fetchPRForBranch(branch: string, cwd: string): Promise<PRResult | null> {
    // Strategy 1: bare `gh pr view` — resolves via the branch's tracking ref.
    // Works for fork PRs checked out with `gh pr checkout` (tracking ref = refs/pull/N/head).
    // Strategy 2: `gh pr view <branch>` — works for same-repo branches pushed to origin.
    // Strategy 3: `gh pr list --search "<sha>"` — last resort, finds PRs by HEAD commit SHA.
    return (await this.ghPRView(cwd)) ?? (await this.ghPRView(cwd, branch)) ?? (await this.ghPRListBySHA(cwd))
  }

  /** Run `gh pr view [branch] --json ...` and parse the result, or return null. */
  private async ghPRView(cwd: string, branch?: string): Promise<PRResult | null> {
    try {
      const args = ["pr", "view"]
      if (branch) args.push(branch)
      return parsePRResult(await this.query(args, cwd))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes("no pull requests found") || msg.includes("Could not resolve")) return null
      throw err
    }
  }

  private async query(args: string[], cwd: string): Promise<string> {
    if (this.rich) {
      try {
        return (await this.gh([...args, "--json", PRStatusPoller.PR_JSON_FIELDS], { cwd, timeout: 15_000 })).stdout
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (!/unknown.*field|does(?:n't| not) exist|not accessible|insufficient|forbidden/i.test(msg)) throw err
        this.rich = false
      }
    }
    return (await this.gh([...args, "--json", PRStatusPoller.BASE_JSON_FIELDS], { cwd, timeout: 15_000 })).stdout
  }

  /** Search for PRs containing the current HEAD SHA. Finds PRs when branch name/tracking ref don't match. */
  private async ghPRListBySHA(cwd: string): Promise<PRResult | null> {
    try {
      const { stdout: sha } = await this.shell("git", ["rev-parse", "HEAD"], { cwd, timeout: 5_000 })
      const head = sha.trim()
      if (!head) return null

      const stdout = await this.query(
        ["pr", "list", "--state", "all", "--search", `${head} is:pr`, "--limit", "5"],
        cwd,
      )
      const items = JSON.parse(stdout) as unknown[]
      if (!Array.isArray(items) || items.length === 0) return null

      // Only accept PRs where headRefOid matches our HEAD exactly
      for (const item of items) {
        const data = item as Record<string, unknown>
        if (data.headRefOid === head) return parsePRResult(JSON.stringify(data))
      }
      return null
    } catch {
      return null
    }
  }

  private async fetchChecks(prNumber: number, cwd: string): Promise<PRStatus["checks"]> {
    try {
      const { stdout } = await this.gh(
        ["pr", "checks", String(prNumber), "--json", "name,state,link,startedAt,completedAt"],
        { cwd, timeout: 15_000 },
      )
      const data = JSON.parse(stdout) as Array<{
        name: string
        state: string
        link?: string
        startedAt?: string
        completedAt?: string
      }>

      const checks: PRCheck[] = data.map((c) => ({
        name: c.name,
        status: checkStatus(c.state),
        url: c.link,
        duration: formatCheckDuration(c.startedAt, c.completedAt),
      }))

      return summarize(checks)
    } catch {
      return { status: "none", total: 0, passed: 0, failed: 0, pending: 0, checks: [] }
    }
  }

  private async getRepoInfo(cwd: string): Promise<{ owner: string; name: string }> {
    const root = this.options.getWorkspaceRoot() ?? cwd
    if (this.cachedRepo?.root === root) return this.cachedRepo
    const { stdout } = await this.gh(["repo", "view", "--json", "owner,name"], {
      cwd,
      timeout: 10_000,
    })
    const data = JSON.parse(stdout)
    const info = { owner: data.owner.login as string, name: data.name as string, root }
    this.cachedRepo = info
    return info
  }

  private async fetchReviewers(prNumber: number, cwd: string): Promise<PRReviewer[]> {
    try {
      const repo = await this.getRepoInfo(cwd)
      const query = `query($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $number) {
            reviewRequests(first: 20) {
              nodes { requestedReviewer { ... on User { login avatarUrl } } }
            }
            reviews(last: 20, states: [APPROVED, CHANGES_REQUESTED, COMMENTED]) {
              nodes { author { login avatarUrl } state }
            }
          }
        }
      }`
      const { stdout } = await this.gh(
        [
          "api",
          "graphql",
          "-f",
          `query=${query}`,
          "-F",
          `owner=${repo.owner}`,
          "-F",
          `repo=${repo.name}`,
          "-F",
          `number=${prNumber}`,
        ],
        { cwd, timeout: 15_000 },
      )
      const pr = JSON.parse(stdout)?.data?.repository?.pullRequest
      return parseReviewers(
        (pr?.reviewRequests?.nodes ?? []) as GhReviewRequest[],
        (pr?.reviews?.nodes ?? []) as GhReview[],
      )
    } catch (err) {
      this.options.log("Failed to fetch PR reviewers:", err)
      return []
    }
  }

  /**
   * Undefined on failure, never an empty thread list: the panel keeps the
   * comments it already shows instead of collapsing the section mid-review.
   */
  private async fetchComments(
    prNumber: number,
    cwd: string,
  ): Promise<{ total: number; unresolved: number; comments: PRComment[] } | undefined> {
    try {
      const repo = await this.getRepoInfo(cwd)
      const query = `query($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $number) {
            reviewThreads(first: 100) {
              totalCount
              nodes {
                id
                isResolved
                isOutdated
                comments(first: 10) {
                  nodes {
                    id
                    author { login avatarUrl }
                    body
                    path
                    line
                    originalLine
                    url
                    createdAt
                    diffHunk
                  }
                }
              }
            }
          }
        }
      }`

      const { stdout } = await this.gh(
        [
          "api",
          "graphql",
          "-f",
          `query=${query}`,
          "-F",
          `owner=${repo.owner}`,
          "-F",
          `repo=${repo.name}`,
          "-F",
          `number=${prNumber}`,
        ],
        { cwd, timeout: 15_000 },
      )
      const pr = JSON.parse(stdout)?.data?.repository?.pullRequest
      const threads = pr?.reviewThreads
      const comments = await withContext(cwd, parseComments((threads?.nodes ?? []) as GhThread[]))
      const totalCount = threads?.totalCount ?? comments.length
      return { total: totalCount, unresolved: comments.filter((c) => !c.resolved).length, comments }
    } catch (err) {
      this.options.log("Failed to fetch PR comments:", err)
      return undefined
    }
  }
}

/** Run async thunks with bounded concurrency, returning settled results. */
async function settled<T>(thunks: (() => Promise<T>)[], concurrency: number): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(thunks.length)
  let idx = 0
  async function run(): Promise<void> {
    while (idx < thunks.length) {
      const i = idx++
      const fn = thunks[i]!
      try {
        results[i] = { status: "fulfilled", value: await fn() }
      } catch (reason) {
        results[i] = { status: "rejected", reason }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, thunks.length) }, () => run()))
  return results
}
