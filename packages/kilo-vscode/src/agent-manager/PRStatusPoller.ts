import type { ExecFileOptionsWithStringEncoding } from "child_process"
import { existsSync } from "fs"
import type { Worktree } from "./WorktreeStateManager"
import type { PRMergeMethod, PRStatus, PRCheck, PRReviewer, PRTimelineItem } from "./types"
import { execWithShellEnv } from "./shell-env"
import { execGhRead } from "./gh"
import { classifyPRError } from "./git-import"
import type { Semaphore } from "./semaphore"
import {
  parsePRResult,
  checkStatus,
  signature,
  formatCheckDuration,
  parseComments,
  parseReviewers,
  summarize,
} from "./pr/am-pr-utils"
import { TIMELINE_QUERY, parseTimeline } from "./pr/timeline"
import type { PRResult, GhThread, GhReviewRequest, GhReview, GhTimelineItem } from "./pr/am-pr-types"
import { withContext } from "./pr/pr-comment-context"
import { oid } from "../shared/pr-comment-preview"

interface PRStatusPollerOptions {
  getWorktrees: () => Worktree[]
  getWorkspaceRoot: () => string | undefined
  onStatus: (
    worktreeId: string,
    pr: PRStatus | null,
    error?: "gh_missing" | "gh_auth" | "fetch_failed",
    branch?: string,
  ) => void
  log: (...args: unknown[]) => void
  intervalMs?: number
  /** Shared concurrency gate for child process spawning. */
  semaphore?: Semaphore
  getBranch?: (worktree: Worktree) => Promise<string | undefined>
  getPRMergeMethod?: (repo: string) => PRMergeMethod | undefined
}

interface RepoInfo {
  owner: string
  name: string
  root: string
  methods: PRMergeMethod[]
  autoAllowed: boolean
  canWrite: boolean
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
  private cachedRepo: RepoInfo | undefined
  private repoRequest: { root: string; promise: Promise<RepoInfo> } | undefined
  private prCache = new Map<string, { result: PRResult | null; expires: number }>()
  /** Reviewer avatars are stable, so look them up once per login and reuse them. */
  private readonly avatars = new Map<string, string>()
  private readonly resolvedAvatars = new Set<string>()
  private readonly refreshTimers = new Map<string, ReturnType<typeof setTimeout>[]>()
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
    this.clearRefreshTimers()
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
    this.repoRequest = undefined
    this.prCache.clear()
    this.avatars.clear()
    this.resolvedAvatars.clear()
    this.lastFullSync = 0
    this.clearRefreshTimers()
  }

  /** Force-refresh a specific worktree immediately, bypassing the PR cache. */
  refresh(worktreeId: string, settle = false): void {
    this.clearRefreshTimers(worktreeId)
    const wt = this.options.getWorktrees().find((w) => w.id === worktreeId)
    if (wt) this.prCache.delete(this.key(wt.branch, wt.path))
    this.lastHash.delete(worktreeId)
    if (!this.active) return
    const generation = this.generation
    void this.fetchOne(worktreeId, generation, true).catch(() => undefined)
    if (!settle || !this.visible) return
    const delays = [2_000, 8_000]
    this.refreshTimers.set(
      worktreeId,
      delays.map((delay) =>
        setTimeout(() => {
          if (!this.active || !this.visible || this.stale(generation)) return
          const current = this.options.getWorktrees().find((w) => w.id === worktreeId)
          if (current) this.prCache.delete(this.key(current.branch, current.path))
          this.lastHash.delete(worktreeId)
          void this.fetchOne(worktreeId, generation, true).catch(() => undefined)
        }, delay),
      ),
    )
  }

  private clearRefreshTimers(worktreeId?: string): void {
    if (worktreeId) {
      for (const timer of this.refreshTimers.get(worktreeId) ?? []) clearTimeout(timer)
      this.refreshTimers.delete(worktreeId)
      return
    }
    for (const timers of this.refreshTimers.values()) {
      for (const timer of timers) clearTimeout(timer)
    }
    this.refreshTimers.clear()
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

  private async fetchOne(
    worktreeId: string,
    generation = this.generation,
    full = this.activeWorktreeId === worktreeId,
  ): Promise<void> {
    const wt = this.target(worktreeId)
    if (!wt) return

    let branch: string | undefined
    try {
      branch = this.options.getBranch ? await this.options.getBranch(wt) : wt.branch
      if (this.stale(generation)) return
      const pr = await this.cachedFetchPR(branch ?? wt.branch, wt.path)
      if (this.stale(generation)) return
      if (!pr) return this.empty(worktreeId, branch ?? wt.branch, branch)

      const repo = await this.getRepoInfo(wt.path)
      const [checks, reviewers, threads] = await Promise.all([
        ...this.extras(pr, wt.path),
        this.fetchThreads(pr.number, wt.path, full),
      ])
      if (this.stale(generation)) return
      this.invalidateThreadCache(pr, threads, branch ?? wt.branch, wt.path)

      const merge = mergeStatus(pr.merge, repo, this.options.getPRMergeMethod?.(`${repo.owner}/${repo.name}`))
      const status: PRStatus = {
        id: pr.id,
        number: pr.number,
        baseRefOid: pr.baseRefOid,
        headRefOid: pr.headRefOid,
        title: pr.title,
        body: pr.body,
        author: pr.author,
        createdAt: pr.createdAt,
        url: pr.url,
        state: pr.state,
        review: pr.review,
        ...(merge ? { merge } : {}),
        checks,
        reviewers,
        ...threads,
        additions: pr.additions,
        deletions: pr.deletions,
        files: pr.files,
      }

      const hash = `${worktreeId}:${branch ?? wt.branch}:${signature(status)}`
      if (this.lastHash.get(worktreeId) === hash) return
      this.lastHash.set(worktreeId, hash)

      this.options.onStatus(worktreeId, status, undefined, branch)
    } catch (err) {
      if (this.stale(generation)) return
      this.handleError(worktreeId, branch, wt.path, err)
      throw err // propagate so fetchAll can track failures for backoff
    }
  }

  private extras(pr: PRResult, cwd: string) {
    return [pr.checks ?? this.fetchChecks(pr.number, cwd), this.reviewers(pr, cwd)] as const
  }

  private empty(worktreeId: string, fallback: string, branch: string | undefined): void {
    const hash = `${worktreeId}:${fallback}:none`
    if (this.lastHash.get(worktreeId) === hash) return
    this.lastHash.set(worktreeId, hash)
    this.options.onStatus(worktreeId, null, undefined, branch)
  }

  private invalidateThreadCache(
    pr: PRResult,
    threads: { baseRefOid?: string; headRefOid?: string } | undefined,
    branch: string,
    cwd: string,
  ): void {
    if (!threads) return
    if (threads.baseRefOid === pr.baseRefOid && threads.headRefOid === pr.headRefOid) return
    this.prCache.delete(this.key(branch, cwd))
  }

  /**
   * `gh pr view --json reviews` returns reviewer logins without avatars, so
   * merge avatar URLs from the GraphQL query and cache them per login. States
   * from `gh pr view` stay authoritative.
   */
  private async reviewers(pr: PRResult, cwd: string): Promise<PRReviewer[]> {
    if (pr.reviewers === undefined) return (await this.fetchReviewers(pr.number, cwd)).items
    const list = pr.reviewers
    if (list.length === 0 || list.every((item) => item.avatar || this.resolvedAvatars.has(item.login)))
      return list.map((item) => (item.avatar ? item : { ...item, avatar: this.avatars.get(item.login) }))
    const fetched = await this.fetchReviewers(pr.number, cwd)
    if (fetched.ok) {
      for (const item of list) this.resolvedAvatars.add(item.login)
      for (const item of fetched.items) {
        this.resolvedAvatars.add(item.login)
        if (item.avatar) this.avatars.set(item.login, item.avatar)
      }
    }
    return list.map((item) => (item.avatar ? item : { ...item, avatar: this.avatars.get(item.login) }))
  }

  private handleError(worktreeId: string, branch: string | undefined, cwd: string, err: unknown): void {
    const msg = err instanceof Error ? err.message : String(err)
    const kind = existsSync(cwd) ? classifyPRError(msg) : "unknown"
    this.options.log(`PR fetch failed for ${branch ?? "unknown"}:`, msg)
    const key = kind === "gh_missing" ? "gh_missing" : kind === "gh_auth" ? "gh_auth" : "fetch_failed"
    if (kind === "gh_missing") this.ghAvailable = false
    const hash = `${worktreeId}:${branch ?? ""}:error:${key}`
    if (this.lastHash.get(worktreeId) === hash) return
    this.lastHash.set(worktreeId, hash)
    this.options.onStatus(worktreeId, null, key, branch)
  }

  private target(worktreeId: string): Worktree | undefined {
    if (!this.options.getWorkspaceRoot()) return
    const worktree = this.options.getWorktrees().find((item) => item.id === worktreeId)
    if (!worktree || !existsSync(worktree.path)) return
    return worktree
  }

  private static readonly BASE_JSON_FIELDS =
    "id,number,title,body,url,state,isDraft,reviewDecision,additions,deletions,changedFiles,headRefName,baseRefOid,headRefOid,author,createdAt"
  private static readonly PR_JSON_FIELDS = `${PRStatusPoller.BASE_JSON_FIELDS},statusCheckRollup,reviewRequests,reviews,mergeable,mergeStateStatus,autoMergeRequest`

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
        // New branches can share HEAD with a merged PR without belonging to it.
        ["pr", "list", "--state", "open", "--search", `${head} is:pr`, "--limit", "5"],
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

  private async getRepoInfo(cwd: string): Promise<RepoInfo> {
    const root = this.options.getWorkspaceRoot() ?? cwd
    if (this.cachedRepo?.root === root) return this.cachedRepo
    if (this.repoRequest?.root === root) return this.repoRequest.promise
    const promise = this.fetchRepoInfo(cwd, root)
      .then((info) => {
        this.cachedRepo = info
        return info
      })
      .catch((err) => {
        if (this.repoRequest?.promise === promise) this.repoRequest = undefined
        throw err
      })
    this.repoRequest = { root, promise }
    return promise
  }

  private async fetchRepoInfo(cwd: string, root: string): Promise<RepoInfo> {
    const fields = "owner,name,mergeCommitAllowed,squashMergeAllowed,rebaseMergeAllowed,viewerPermission"
    const stdout = await this.gh(["repo", "view", "--json", fields], { cwd, timeout: 10_000 }).then(
      (result) => result.stdout,
      (err) => {
        const msg = err instanceof Error ? err.message : String(err)
        if (!/unknown.*field|does(?:n't| not) exist|not accessible/i.test(msg)) throw err
        return this.gh(["repo", "view", "--json", "owner,name,viewerPermission"], { cwd, timeout: 10_000 }).then(
          (result) => result.stdout,
          (fallback) => {
            const reason = fallback instanceof Error ? fallback.message : String(fallback)
            if (!/unknown.*field|does(?:n't| not) exist|not accessible/i.test(reason)) throw fallback
            return this.gh(["repo", "view", "--json", "owner,name"], { cwd, timeout: 10_000 }).then(
              (result) => result.stdout,
            )
          },
        )
      },
    )
    const data = JSON.parse(stdout) as Record<string, unknown>
    const owner = typeof data.owner === "string" ? data.owner : (data.owner as { login?: string } | undefined)?.login
    const name = typeof data.name === "string" ? data.name : undefined
    if (!owner || !name) throw new Error("GitHub repository identity is missing")
    const settings = await this.gh(["api", `repos/${owner}/${name}`], { cwd, timeout: 10_000 }).then(
      (result) => JSON.parse(result.stdout) as { allow_auto_merge?: boolean },
      (err) => {
        this.options.log("Failed to read GitHub auto-merge settings:", err)
        return { allow_auto_merge: undefined }
      },
    )
    const methods = [
      ...(data.squashMergeAllowed !== false ? (["squash"] as const) : []),
      ...(data.mergeCommitAllowed !== false ? (["merge"] as const) : []),
      ...(data.rebaseMergeAllowed !== false ? (["rebase"] as const) : []),
    ]
    return {
      owner,
      name,
      root,
      methods: methods.length > 0 ? [...methods] : ["squash"],
      autoAllowed: settings.allow_auto_merge === true,
      canWrite:
        data.viewerPermission === "WRITE" || data.viewerPermission === "MAINTAIN" || data.viewerPermission === "ADMIN",
    }
  }

  private async fetchReviewers(prNumber: number, cwd: string): Promise<{ items: PRReviewer[]; ok: boolean }> {
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
      return {
        items: parseReviewers(
          (pr?.reviewRequests?.nodes ?? []) as GhReviewRequest[],
          (pr?.reviews?.nodes ?? []) as GhReview[],
        ),
        ok: true,
      }
    } catch (err) {
      this.options.log("Failed to fetch PR reviewers:", err)
      return { items: [], ok: false }
    }
  }

  private async fetchThreads(
    prNumber: number,
    cwd: string,
    full: boolean,
  ): Promise<
    | Pick<
        PRStatus,
        | "comments"
        | "unresolvedThreads"
        | "conversation"
        | "conversationHasEarlier"
        | "baseRefOid"
        | "headRefOid"
        | "viewerDidAuthor"
      >
    | undefined
  > {
    let refs: { baseRefOid: string; headRefOid: string } | undefined
    try {
      const repo = await this.getRepoInfo(cwd)
      const fields = full
        ? `id
           isOutdated
           path
           diffSide
           line
           originalLine
           startLine
           originalStartLine
           startDiffSide
           latest: comments(last: 10) {
             nodes { id author { login avatarUrl } body viewerDidAuthor viewerCanUpdate viewerCanDelete }
           }
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
                reactionGroups { content reactors { totalCount } viewerHasReacted }
                viewerDidAuthor viewerCanUpdate viewerCanDelete
             }
           }`
        : ""
      // Keep the timeline in the first review-thread request. This avoids a
      // second GitHub round trip while leaving non-active worktree polls cheap.
      let extra = full ? TIMELINE_QUERY : ""
      const nodes: GhThread[] = []
      const cursors = new Set<string>()
      const ids = new Set<string>()
      let total: number | undefined
      let cursor: string | undefined
      let conversation: PRTimelineItem[] | undefined
      let conversationHasEarlier: boolean | undefined
      while (true) {
        const query = `query($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
          repository(owner: $owner, name: $repo) {
            pullRequest(number: $number) {
              baseRefOid
              headRefOid
              viewerDidAuthor
              reviewThreads(first: 100, after: $cursor) {
                totalCount
                pageInfo { hasNextPage endCursor }
                nodes { isResolved ${fields} }
              }
              ${extra}
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
            ...(cursor ? ["-f", `cursor=${cursor}`] : []),
          ],
          { cwd, timeout: 15_000 },
        )
        const page = threads(stdout)
        const previous = refs
        refs = { baseRefOid: page.baseRefOid, headRefOid: page.headRefOid }
        if (previous && (previous.baseRefOid !== refs.baseRefOid || previous.headRefOid !== refs.headRefOid)) {
          throw new Error("PR revision changed during review thread pagination")
        }
        if (total !== undefined && total !== page.totalCount) throw new Error("PR review thread count changed")
        total = page.totalCount
        if (full) {
          for (const node of page.nodes) {
            if (!node.id || ids.has(node.id)) throw new Error("Invalid PR review thread identity")
            ids.add(node.id)
          }
        }
        nodes.push(...page.nodes)
        if (extra) {
          const parsed = parseConversationPayload(stdout)
          conversation = parsed.items
          conversationHasEarlier = parsed.hasEarlier
          extra = ""
        }
        if (nodes.length > total) throw new Error("Incomplete PR review threads")
        if (!page.pageInfo.hasNextPage) {
          if (nodes.length !== total) throw new Error("Incomplete PR review threads")
          const unresolved = nodes.filter((node) => !node.isResolved).length
          if (!full) return { ...refs, unresolvedThreads: unresolved }
          const comments = await withContext(cwd, parseComments(nodes), {
            repo,
            base: refs.baseRefOid,
            head: refs.headRefOid,
            shell: (cmd, args, options) => this.shell(cmd, args, options),
            gh: (args, options) => this.gh(args, options),
          })
          return {
            ...refs,
            viewerDidAuthor: page.viewerDidAuthor,
            unresolvedThreads: unresolved,
            comments: { total, unresolved, comments },
            conversation,
            conversationHasEarlier,
          }
        }
        cursor = advance(page.pageInfo.endCursor, cursors)
      }
    } catch (err) {
      this.options.log("Failed to fetch PR review threads:", err)
      return refs
    }
  }
}

function advance(value: unknown, cursors: Set<string>): string {
  if (typeof value !== "string" || !value || cursors.has(value)) throw new Error("Invalid PR review thread cursor")
  cursors.add(value)
  return value
}

function threads(json: string) {
  const result = JSON.parse(json) as {
    errors?: unknown[]
    data?: {
      repository?: {
        pullRequest?: {
          baseRefOid?: string
          headRefOid?: string
          viewerDidAuthor?: boolean
          reviewThreads?: {
            totalCount: number
            pageInfo: { hasNextPage: boolean; endCursor?: string | null }
            nodes: GhThread[]
          }
        }
      }
    }
  }
  const pr = result.data?.repository?.pullRequest
  const page = pr?.reviewThreads
  if (!oid(pr?.baseRefOid) || !oid(pr?.headRefOid)) throw new Error("Missing PR revision")
  if (result.errors?.length || !page || !Array.isArray(page.nodes) || !Number.isInteger(page.totalCount)) {
    throw new Error("Invalid PR review threads response")
  }
  if (
    typeof page.pageInfo?.hasNextPage !== "boolean" ||
    page.nodes.some((node) => typeof node?.isResolved !== "boolean")
  ) {
    throw new Error("Incomplete PR review threads response")
  }
  return { ...page, baseRefOid: pr.baseRefOid, headRefOid: pr.headRefOid, viewerDidAuthor: pr.viewerDidAuthor }
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

function parseConversationPayload(stdout: string): { items?: PRTimelineItem[]; hasEarlier: boolean } {
  const page = JSON.parse(stdout)?.data?.repository?.pullRequest?.timelineItems
  if (!page || !Array.isArray(page.nodes)) return { hasEarlier: false }
  return {
    items: parseTimeline(page.nodes as Array<GhTimelineItem | null>),
    hasEarlier: page.pageInfo?.hasPreviousPage === true,
  }
}

function mergeStatus(merge: PRResult["merge"], repo: RepoInfo, saved: PRMergeMethod | undefined): PRStatus["merge"] {
  if (!merge) return undefined
  const method =
    saved && repo.methods.includes(saved)
      ? saved
      : (repo.methods.find((item) => item === "squash") ?? repo.methods[0] ?? "squash")
  return {
    ...merge,
    methods: repo.methods,
    method,
    autoAllowed: repo.autoAllowed,
    canWrite: repo.canWrite,
  }
}
