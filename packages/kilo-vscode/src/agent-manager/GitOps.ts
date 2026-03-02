import * as nodePath from "path"
import simpleGit from "simple-git"

export interface GitOpsOptions {
  log: (...args: unknown[]) => void
  refreshMs?: number
  /** Override git command execution for testing. */
  runGit?: (args: string[], cwd: string) => Promise<string>
}

export class GitOps {
  private lastFetch = new Map<string, number>()
  private inflightFetch = new Map<string, Promise<void>>()
  private readonly refreshMs: number
  private readonly log: (...args: unknown[]) => void
  private readonly runGit: (args: string[], cwd: string) => Promise<string>

  constructor(options: GitOpsOptions) {
    this.refreshMs = options.refreshMs ?? 120000
    this.log = options.log
    this.runGit =
      options.runGit ??
      ((args, cwd) =>
        simpleGit(cwd)
          .raw(args)
          .then((out) => out.trim()))
  }

  private raw(args: string[], cwd: string): Promise<string> {
    return this.runGit(args, cwd)
  }

  async currentBranch(cwd: string): Promise<string> {
    return this.raw(["rev-parse", "--abbrev-ref", "HEAD"], cwd).catch(() => "")
  }

  /**
   * Resolve the remote name for a branch. Checks (in order):
   * 1. The configured upstream's remote (e.g. upstream from `upstream/main`)
   * 2. `branch.<name>.remote` config
   * 3. Falls back to `origin`
   */
  async resolveRemote(cwd: string, branch?: string): Promise<string> {
    const upstream = await this.raw(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], cwd).catch(
      () => "",
    )
    if (upstream.includes("/")) return upstream.split("/")[0]

    const name = branch || (await this.raw(["branch", "--show-current"], cwd).catch(() => ""))
    if (name) {
      const configured = await this.raw(["config", `branch.${name}.remote`], cwd).catch(() => "")
      if (configured) return configured
    }

    return "origin"
  }

  async resolveTrackingBranch(cwd: string, branch: string): Promise<string | undefined> {
    const upstream = await this.raw(["rev-parse", "--abbrev-ref", "@{upstream}"], cwd).catch(() => "")
    if (upstream) return upstream

    const remote = await this.resolveRemote(cwd, branch)
    const ref = `${remote}/${branch}`
    const resolved = await this.raw(["rev-parse", "--verify", ref], cwd).catch(() => "")
    if (resolved) return ref

    return undefined
  }

  /** Resolve the repo's default branch via <remote>/HEAD. */
  async resolveDefaultBranch(cwd: string, branch?: string): Promise<string | undefined> {
    const remote = await this.resolveRemote(cwd, branch)
    const head = await this.raw(["symbolic-ref", "--short", `refs/remotes/${remote}/HEAD`], cwd).catch(() => "")
    return head || undefined
  }

  async hasRemoteRef(cwd: string, ref: string): Promise<boolean> {
    return this.raw(["rev-parse", "--verify", "--quiet", `refs/remotes/${ref}`], cwd)
      .then(() => true)
      .catch(() => false)
  }

  async refreshRemote(cwd: string, remote: string): Promise<void> {
    if (!remote) return

    const commonRaw = await this.raw(["rev-parse", "--git-common-dir"], cwd).catch(() => cwd)
    const common = nodePath.isAbsolute(commonRaw) ? commonRaw : nodePath.resolve(cwd, commonRaw)
    const key = `${common}:${remote}`

    const existing = this.inflightFetch.get(key)
    if (existing) return existing

    const prev = this.lastFetch.get(key) ?? 0
    const now = Date.now()
    if (now - prev < this.refreshMs) return
    this.lastFetch.set(key, now)

    const job = this.raw(["fetch", "--quiet", "--no-tags", remote], cwd)
      .catch((err) => {
        this.log(`Failed to refresh remote refs for ${cwd}:`, err)
      })
      .then(() => undefined)
      .finally(() => {
        this.inflightFetch.delete(key)
      })
    this.inflightFetch.set(key, job)
    return job
  }

  /**
   * Compute working-tree stats (staged + unstaged + untracked) without requiring
   * a remote or base branch — mirrors the superset approach of running
   * `git diff --numstat` and `git ls-files --others`.
   */
  async workingTreeStats(cwd: string): Promise<{ files: number; additions: number; deletions: number }> {
    // Staged + unstaged changes relative to HEAD (like superset's dual
    // git diff --cached --numstat + git diff --numstat, combined).
    const numstat = await this.raw(["diff", "HEAD", "--numstat"], cwd).catch(() => "")
    const untracked = await this.raw(["ls-files", "--others", "--exclude-standard"], cwd).catch(() => "")

    let files = 0
    let additions = 0
    let deletions = 0

    if (numstat) {
      for (const line of numstat.split("\n")) {
        if (!line.trim()) continue
        const parts = line.split("\t")
        files++
        if (parts[0] !== "-") additions += parseInt(parts[0], 10) || 0
        if (parts[1] !== "-") deletions += parseInt(parts[1], 10) || 0
      }
    }

    // Count lines in untracked files as additions (like superset's
    // applyUntrackedLineCount). Cap at 1MB to avoid reading huge binaries.
    if (untracked) {
      const paths = untracked.split("\n").filter((l) => l.trim())
      files += paths.length
      const fs = await import("fs/promises")
      await Promise.all(
        paths.map(async (p) => {
          try {
            const full = nodePath.resolve(cwd, p)
            const stat = await fs.stat(full)
            if (stat.size > 1_000_000) return
            const content = await fs.readFile(full, "utf-8")
            additions += content.split("\n").length
          } catch (err) {
            this.log(`Failed to read untracked file ${p}:`, err)
          }
        }),
      )
    }

    return { files, additions, deletions }
  }

  /**
   * Count commits ahead and behind in a single `rev-list --left-right --count`
   * call (like superset's approach). Falls back through upstream → remote/branch
   * → remote/parentBranch → parentBranch.
   */
  async aheadBehind(cwd: string, parentBranch: string): Promise<{ ahead: number; behind: number }> {
    const upstream = await this.raw(["rev-parse", "--abbrev-ref", "@{upstream}"], cwd).catch(() => "")
    const branch = await this.raw(["branch", "--show-current"], cwd).catch(() => "")
    const remote = await this.resolveRemote(cwd, branch)
    await this.refreshRemote(cwd, remote)

    const ref = (() => {
      if (upstream) return upstream
      const remoteBranch = branch ? `${remote}/${branch}` : ""
      // hasRemoteRef is async, so we can't use it inline — resolve below
      return { remoteBranch, remoteParent: `${remote}/${parentBranch}`, parentBranch }
    })()

    if (typeof ref === "string") {
      return this.parseLeftRight(cwd, ref)
    }

    if (ref.remoteBranch && (await this.hasRemoteRef(cwd, ref.remoteBranch))) {
      return this.parseLeftRight(cwd, ref.remoteBranch)
    }
    if (await this.hasRemoteRef(cwd, ref.remoteParent)) {
      return this.parseLeftRight(cwd, ref.remoteParent)
    }
    return this.parseLeftRight(cwd, ref.parentBranch)
  }

  private async parseLeftRight(cwd: string, ref: string): Promise<{ ahead: number; behind: number }> {
    const out = await this.raw(["rev-list", "--left-right", "--count", `${ref}...HEAD`], cwd).catch(() => "0\t0")
    const [behind, ahead] = out.split(/\s+/).map((s) => parseInt(s, 10) || 0)
    return { ahead, behind }
  }
}
