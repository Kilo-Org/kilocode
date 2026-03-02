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

  async countMissingOriginCommits(cwd: string, parentBranch: string): Promise<number> {
    const upstream = await this.raw(["rev-parse", "--abbrev-ref", "@{upstream}"], cwd).catch(() => "")
    const branch = await this.raw(["branch", "--show-current"], cwd).catch(() => "")
    const remote = await this.resolveRemote(cwd, branch)
    await this.refreshRemote(cwd, remote)

    if (upstream) {
      const count = await this.raw(["rev-list", "--count", `${upstream}..HEAD`], cwd).catch(() => "0")
      return parseInt(count, 10) || 0
    }

    const remoteBranch = branch ? `${remote}/${branch}` : ""
    const hasRemoteBranch = remoteBranch ? await this.hasRemoteRef(cwd, remoteBranch) : false

    const remoteParent = `${remote}/${parentBranch}`
    const hasRemoteParent = await this.hasRemoteRef(cwd, remoteParent)

    const ref = hasRemoteBranch ? remoteBranch : hasRemoteParent ? remoteParent : parentBranch
    const count = await this.raw(["rev-list", "--count", `${ref}..HEAD`], cwd).catch(() => "0")
    return parseInt(count, 10) || 0
  }
}
