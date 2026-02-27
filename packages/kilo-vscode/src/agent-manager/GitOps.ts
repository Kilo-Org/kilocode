import * as cp from "child_process"
import * as nodePath from "path"

export interface GitOpsOptions {
  log: (...args: unknown[]) => void
  refreshMs?: number
  runGit?: (args: string[], cwd: string) => Promise<string>
}

export class GitOps {
  private lastFetch = new Map<string, number>()
  private inflightFetch = new Map<string, Promise<void>>()
  private readonly refreshMs: number
  private readonly runGit: (args: string[], cwd: string) => Promise<string>
  private readonly log: (...args: unknown[]) => void

  constructor(options: GitOpsOptions) {
    this.refreshMs = options.refreshMs ?? 120000
    this.log = options.log
    this.runGit =
      options.runGit ??
      ((args, cwd) =>
        new Promise((resolve, reject) => {
          cp.execFile("git", args, { cwd, timeout: 10000 }, (err, stdout) => {
            if (err) reject(err)
            else resolve(stdout.trim())
          })
        }))
  }

  exec(args: string[], cwd: string): Promise<string> {
    return this.runGit(args, cwd)
  }

  currentBranch(cwd: string): Promise<string> {
    return this.exec(["rev-parse", "--abbrev-ref", "HEAD"], cwd).catch(() => "")
  }

  async resolveTrackingBranch(cwd: string, branch: string): Promise<string | undefined> {
    const upstream = await this.exec(["rev-parse", "--abbrev-ref", "@{upstream}"], cwd).catch(() => "")
    if (upstream) return upstream

    const ref = `origin/${branch}`
    const resolved = await this.exec(["rev-parse", "--verify", ref], cwd).catch(() => "")
    if (resolved) return ref

    return undefined
  }

  /** Resolve the repo's default branch via origin/HEAD. */
  async resolveDefaultBranch(cwd: string): Promise<string | undefined> {
    const head = await this.exec(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], cwd).catch(() => "")
    return head || undefined
  }

  hasRemoteRef(cwd: string, ref: string): Promise<boolean> {
    return this.exec(["rev-parse", "--verify", "--quiet", `refs/remotes/${ref}`], cwd)
      .then(() => true)
      .catch(() => false)
  }

  async refreshRemote(cwd: string, remote: string): Promise<void> {
    if (!remote) return

    const commonRaw = await this.exec(["rev-parse", "--git-common-dir"], cwd).catch(() => cwd)
    const common = nodePath.isAbsolute(commonRaw) ? commonRaw : nodePath.resolve(cwd, commonRaw)
    const key = `${common}:${remote}`

    const existing = this.inflightFetch.get(key)
    if (existing) return existing

    const prev = this.lastFetch.get(key) ?? 0
    const now = Date.now()
    if (now - prev < this.refreshMs) return
    this.lastFetch.set(key, now)

    const job = this.exec(["fetch", "--quiet", "--no-tags", remote], cwd)
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
    const upstream = await this.exec(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], cwd).catch(
      () => "",
    )

    const branch = await this.exec(["branch", "--show-current"], cwd).catch(() => "")
    const branchRemote = branch ? await this.exec(["config", `branch.${branch}.remote`], cwd).catch(() => "") : ""
    const upstreamRemote = upstream.includes("/") ? upstream.split("/")[0] : ""
    const remote = upstreamRemote || branchRemote || "origin"
    await this.refreshRemote(cwd, remote)

    if (upstream) {
      const count = await this.exec(["rev-list", "--count", `${upstream}..HEAD`], cwd).catch(() => "0")
      return parseInt(count, 10) || 0
    }

    const remoteBranch = branch ? `${remote}/${branch}` : ""
    const hasRemoteBranch = remoteBranch ? await this.hasRemoteRef(cwd, remoteBranch) : false

    const remoteParent = `${remote}/${parentBranch}`
    const hasRemoteParent = await this.hasRemoteRef(cwd, remoteParent)

    const ref = hasRemoteBranch ? remoteBranch : hasRemoteParent ? remoteParent : parentBranch
    const count = await this.exec(["rev-list", "--count", `${ref}..HEAD`], cwd).catch(() => "0")
    return parseInt(count, 10) || 0
  }
}
