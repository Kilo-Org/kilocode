import type { Worktree } from "../agent-manager/WorktreeStateManager"
import { PRStatusPoller } from "../agent-manager/PRStatusPoller"
import { mergePRStatus, retainPRStatus } from "../agent-manager/pr/am-pr-utils"
import type { PRStatus } from "../agent-manager/types"
import { execWithShellEnv } from "../agent-manager/shell-env"
import type { PanelContext } from "./types"

export type DiffPRPollerError = "gh_missing" | "gh_auth" | "fetch_failed"

export interface DiffPRPoller {
  setActiveWorktreeId(id: string | undefined): void
  setEnabled(enabled: boolean): void
  setVisible(visible: boolean): void
  stop(): void
}

export interface DiffPRPollerOptions {
  directory: string
  onStatus: (id: string, pr: PRStatus | null, error?: DiffPRPollerError, branch?: string) => void
  log: (...args: unknown[]) => void
}

interface Options {
  createPoller?: (opts: DiffPRPollerOptions) => DiffPRPoller
  onStatus: () => void
  log: (...args: unknown[]) => void
}

export function createDiffPRPolling(opts: Options) {
  let poller: DiffPRPoller | undefined
  let status: PRStatus | undefined
  let branch: string | undefined
  let scope = ""
  let generation = 0

  const stop = () => {
    generation += 1
    poller?.stop()
    poller = undefined
    status = undefined
    branch = undefined
    scope = ""
  }

  return {
    sync(ctx: PanelContext | undefined, sourceId: string | undefined, visible: boolean) {
      const directory = ctx?.sessionId ? ctx.dir : (ctx?.dir ?? ctx?.workspaceRoot)
      const next = ctx ? JSON.stringify([ctx.sessionId ?? "", ctx.dir ?? ctx.workspaceRoot ?? ""]) : ""
      if (!directory || (sourceId?.startsWith("turn:") && !ctx?.comment)) {
        stop()
        opts.onStatus()
        return
      }
      if (poller && scope === next) {
        poller.setVisible(visible)
        return
      }

      stop()
      scope = next
      const gen = generation
      const create = opts.createPoller ?? createDiffPRPoller
      poller = create({
        directory,
        onStatus: (id, pr, error, name) => {
          if (id !== "diff" || gen !== generation) return
          if (error || !pr) {
            if (retainPRStatus(status, branch, name, null)) return
            status = undefined
            branch = name
            opts.onStatus()
            return
          }
          if (status && branch !== name) status = undefined
          branch = name
          status = status ? mergePRStatus(status, pr) : pr
          opts.onStatus()
        },
        log: opts.log,
      })
      poller.setVisible(visible)
      poller.setActiveWorktreeId("diff")
      poller.setEnabled(true)
    },
    getStatus() {
      return status
    },
    setVisible(visible: boolean) {
      poller?.setVisible(visible)
    },
    stop,
  }
}

export function createDiffPRPoller(opts: DiffPRPollerOptions): DiffPRPoller {
  const worktree: Worktree = {
    id: "diff",
    path: opts.directory,
    branch: "HEAD",
    parentBranch: "",
    createdAt: "",
  }
  return new PRStatusPoller({
    getWorktrees: () => [worktree],
    getWorkspaceRoot: () => opts.directory,
    getBranch: async (item) => {
      const { stdout } = await execWithShellEnv("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
        cwd: item.path,
        timeout: 5_000,
      })
      const branch = stdout.trim()
      return branch && branch !== "HEAD" ? branch : undefined
    },
    onStatus: opts.onStatus,
    log: opts.log,
  })
}
