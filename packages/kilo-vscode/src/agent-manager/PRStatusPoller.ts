import type { Worktree } from "./WorktreeStateManager"
import type { PRStatus, PRCheck, PRComment, CheckStatus, AggregateCheckStatus, PRState, ReviewDecision } from "./types"
import { execWithShellEnv } from "./shell-env"
import { classifyPRError } from "./git-import"

interface PRStatusPollerOptions {
  getWorktrees: () => Worktree[]
  getWorkspaceRoot: () => string | undefined
  onStatus: (worktreeId: string, pr: PRStatus | null, error?: "gh_missing" | "gh_auth" | "fetch_failed") => void
  log: (...args: unknown[]) => void
  intervalMs?: number
}

const GH_PROBE_TTL = 300_000 // 5 minutes — gh installation state rarely changes at runtime
const MAX_BACKOFF = 120_000 // 2 minutes — cap for exponential backoff on repeated errors
const BACKOFF_MULTIPLIER = 2

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
  private activeWorktreeId: string | undefined
  private cachedRepo: { owner: string; name: string; cwd: string } | undefined
  private readonly intervalMs: number

  constructor(private readonly options: PRStatusPollerOptions) {
    this.intervalMs = options.intervalMs ?? 15_000
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
      // Resume — poll immediately then schedule normally
      if (this.timer) clearTimeout(this.timer)
      this.timer = undefined
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
    this.cachedRepo = undefined
  }

  /** Force-refresh a specific worktree immediately. */
  refresh(worktreeId: string): void {
    if (!this.active) return
    void this.fetchOne(worktreeId)
  }

  setActiveWorktreeId(id: string | undefined): void {
    this.activeWorktreeId = id
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
    return this.fetchAll().finally(() => {
      this.busy = false
      this.schedule()
    })
  }

  private async probeGh(): Promise<boolean> {
    const now = Date.now()
    if (this.ghAvailable !== undefined && now - this.ghProbeTime < GH_PROBE_TTL) {
      return this.ghAvailable
    }
    try {
      await execWithShellEnv("gh", ["--version"], { timeout: 5_000 })
      this.ghAvailable = true
    } catch {
      this.ghAvailable = false
    }
    this.ghProbeTime = Date.now()
    return this.ghAvailable
  }

  private async fetchAll(): Promise<void> {
    if (!(await this.probeGh())) {
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
    const worktrees = this.options.getWorktrees()
    const results = await Promise.allSettled(worktrees.map((wt) => this.fetchOne(wt.id)))
    const ok = results.every((r) => r.status === "fulfilled")
    if (ok) {
      this.failures = 0
      return
    }
    this.failures++
  }

  private async fetchOne(worktreeId: string): Promise<void> {
    const worktrees = this.options.getWorktrees()
    const wt = worktrees.find((w) => w.id === worktreeId)
    if (!wt) return

    if (!this.options.getWorkspaceRoot()) return

    try {
      const pr = await this.fetchPRForBranch(wt.branch, wt.path)
      if (!pr) {
        const hash = `${worktreeId}:none`
        if (this.lastHash.get(worktreeId) === hash) return
        this.lastHash.set(worktreeId, hash)
        this.options.onStatus(worktreeId, null)
        return
      }

      const [checks, comments] = await Promise.all([
        this.fetchChecks(pr.number, wt.path),
        this.activeWorktreeId === worktreeId ? this.fetchComments(pr.number, wt.path) : undefined,
      ])

      const status: PRStatus = {
        number: pr.number,
        title: pr.title,
        url: pr.url,
        state: pr.state,
        review: pr.review,
        checks,
        ...(comments && { comments }),
        additions: pr.additions,
        deletions: pr.deletions,
        files: pr.files,
      }

      const hash = `${worktreeId}:${pr.number}:${pr.state}:${pr.review}:${checks.status}:${checks.passed}/${checks.total}:${comments?.total ?? ""}:${comments?.unresolved ?? ""}`
      if (this.lastHash.get(worktreeId) === hash) return
      this.lastHash.set(worktreeId, hash)

      this.options.onStatus(worktreeId, status)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const kind = classifyPRError(msg)
      this.options.log(`PR fetch failed for ${wt.branch}:`, msg)

      const errKey = kind === "gh_missing" ? "gh_missing" : kind === "gh_auth" ? "gh_auth" : "fetch_failed"
      if (kind === "gh_missing") this.ghAvailable = false

      // De-duplicate: only emit if the error state changed for this worktree
      const hash = `${worktreeId}:error:${errKey}`
      if (this.lastHash.get(worktreeId) !== hash) {
        this.lastHash.set(worktreeId, hash)
        this.options.onStatus(worktreeId, null, errKey)
      }
      throw err // propagate so fetchAll can track failures for backoff
    }
  }

  private static readonly PR_JSON_FIELDS =
    "number,title,url,state,isDraft,reviewDecision,additions,deletions,changedFiles,headRefName,headRefOid"

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
      args.push("--json", PRStatusPoller.PR_JSON_FIELDS)

      const { stdout } = await execWithShellEnv("gh", args, { cwd, timeout: 15_000 })
      return parsePRResult(stdout)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes("no pull requests found") || msg.includes("Could not resolve")) return null
      throw err
    }
  }

  /** Search for PRs containing the current HEAD SHA. Finds PRs when branch name/tracking ref don't match. */
  private async ghPRListBySHA(cwd: string): Promise<PRResult | null> {
    try {
      const { stdout: sha } = await execWithShellEnv("git", ["rev-parse", "HEAD"], { cwd, timeout: 5_000 })
      const head = sha.trim()
      if (!head) return null

      const { stdout } = await execWithShellEnv(
        "gh",
        [
          "pr",
          "list",
          "--state",
          "all",
          "--search",
          `${head} is:pr`,
          "--limit",
          "5",
          "--json",
          PRStatusPoller.PR_JSON_FIELDS,
        ],
        { cwd, timeout: 15_000 },
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

  private async fetchChecks(
    prNumber: number,
    cwd: string,
  ): Promise<{
    status: AggregateCheckStatus
    total: number
    passed: number
    failed: number
    pending: number
    items: PRCheck[]
  }> {
    try {
      const { stdout } = await execWithShellEnv(
        "gh",
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

      const items: PRCheck[] = data.map((c) => ({
        name: c.name,
        status: mapCheckStatus(c.state),
        url: c.link,
        duration: formatCheckDuration(c.startedAt, c.completedAt),
      }))

      const total = items.length
      const passed = items.filter((c) => c.status === "success").length
      const failed = items.filter((c) => c.status === "failure").length
      const pending = items.filter((c) => c.status === "pending").length

      const status: AggregateCheckStatus =
        total === 0 ? "none" : failed > 0 ? "failure" : pending > 0 ? "pending" : "success"

      return { status, total, passed, failed, pending, items }
    } catch {
      return { status: "none", total: 0, passed: 0, failed: 0, pending: 0, items: [] }
    }
  }

  private async getRepoInfo(cwd: string): Promise<{ owner: string; name: string }> {
    if (this.cachedRepo && this.cachedRepo.cwd === cwd) {
      return this.cachedRepo
    }
    const { stdout } = await execWithShellEnv("gh", ["repo", "view", "--json", "owner,name"], {
      cwd,
      timeout: 10_000,
    })
    const data = JSON.parse(stdout)
    const info = { owner: data.owner.login as string, name: data.name as string, cwd }
    this.cachedRepo = info
    return info
  }

  private async fetchComments(
    prNumber: number,
    cwd: string,
  ): Promise<{ total: number; unresolved: number; items: PRComment[] }> {
    try {
      const repo = await this.getRepoInfo(cwd)

      const query = `query($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $number) {
            reviewThreads(first: 100) {
              nodes {
                isResolved
                comments(first: 1) {
                  nodes {
                    id
                    author { login avatarUrl }
                    body
                    path
                    line
                    url
                    createdAt
                  }
                }
              }
            }
          }
        }
      }`

      const { stdout } = await execWithShellEnv(
        "gh",
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
      const result = JSON.parse(stdout)
      const threads = result?.data?.repository?.pullRequest?.reviewThreads?.nodes ?? []

      const items: PRComment[] = []
      for (const thread of threads) {
        const first = thread.comments?.nodes?.[0]
        if (!first) continue
        items.push({
          id: first.id,
          author: first.author?.login ?? "unknown",
          avatar: first.author?.avatarUrl,
          body: first.body ?? "",
          file: first.path,
          line: first.line,
          url: first.url,
          resolved: thread.isResolved ?? false,
          createdAt: first.createdAt ? new Date(first.createdAt).getTime() : undefined,
        })
      }

      const total = items.length
      const unresolved = items.filter((c) => !c.resolved).length
      return { total, unresolved, items }
    } catch (err) {
      this.options.log("Failed to fetch PR comments:", err)
      return { total: 0, unresolved: 0, items: [] }
    }
  }
}

interface PRResult {
  number: number
  title: string
  url: string
  state: PRState
  review: ReviewDecision | null
  additions: number
  deletions: number
  files: number
}

function parsePRResult(json: string): PRResult | null {
  const data = JSON.parse(json)
  if (!data.number) return null
  return {
    number: data.number,
    title: data.title ?? "",
    url: data.url ?? "",
    state: parsePRState(data.isDraft, data.state),
    review: parseReviewDecision(data.reviewDecision),
    additions: data.additions ?? 0,
    deletions: data.deletions ?? 0,
    files: data.changedFiles ?? 0,
  }
}

function parsePRState(isDraft: boolean, ghState: string): PRState {
  if (isDraft) return "draft"
  if (ghState === "MERGED") return "merged"
  if (ghState === "CLOSED") return "closed"
  return "open"
}

function parseReviewDecision(decision: string | undefined): ReviewDecision | null {
  if (decision === "APPROVED") return "approved"
  if (decision === "CHANGES_REQUESTED") return "changes_requested"
  if (decision === "REVIEW_REQUIRED") return "pending"
  return null
}

function mapCheckStatus(state: string): CheckStatus {
  switch (state.toUpperCase()) {
    case "SUCCESS":
      return "success"
    case "FAILURE":
    case "ERROR":
      return "failure"
    case "PENDING":
    case "QUEUED":
    case "IN_PROGRESS":
    case "REQUESTED":
    case "WAITING":
      return "pending"
    case "SKIPPED":
      return "skipped"
    case "CANCELLED":
    case "TIMED_OUT":
    case "STALE":
    case "STARTUP_FAILURE":
      return "cancelled"
    default:
      return "pending"
  }
}

function formatCheckDuration(startedAt?: string, completedAt?: string): string | undefined {
  if (!startedAt || !completedAt) return undefined
  const secs = Math.round((new Date(completedAt).getTime() - new Date(startedAt).getTime()) / 1000)
  return secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`
}
