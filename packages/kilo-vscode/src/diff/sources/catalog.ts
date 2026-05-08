import * as vscode from "vscode"
import type { KiloConnectionService } from "../../services/cli-backend"
import { GitOps } from "../../agent-manager/GitOps"
import { resolveLocalDiffTarget } from "../shared/target"
import { appendOutput, getWorkspaceRoot } from "../../review-utils"
import type { BranchListItem } from "../../agent-manager/git-import"
import type { PanelContext } from "../types"
import type { DiffSource, DiffSourceDescriptor } from "./types"
import { createWorktreeDiffSource, WORKSPACE_DESCRIPTOR, WORKSPACE_SOURCE_ID } from "./worktree"
import {
  SESSION_PREFIX,
  createSessionDiffSource,
  sessionDescriptor,
  sessionSourceId,
  type SessionDiffFetch,
  type SnapshotEnabledCheck,
} from "./session"
import { TURN_PREFIX, createTurnDiffSource, type TurnDiffFetch } from "./turn"
import { STAGED_DESCRIPTOR, STAGED_SOURCE_ID, createStagedDiffSource } from "./staged"
import { UNSTAGED_DESCRIPTOR, UNSTAGED_SOURCE_ID, createUnstagedDiffSource } from "./unstaged"

export interface WorkspaceBranchesResult {
  branches: BranchListItem[]
  defaultBranch: string
  /** Resolved auto base (tracking → default), shown next to the "Default" option. */
  autoBase: string | undefined
  /** Currently active base — the override when set, otherwise `autoBase`. */
  currentBase: string | undefined
  /** True when no override is active and `currentBase === autoBase`. */
  isAuto: boolean
  /** Currently checked-out branch (HEAD). Undefined when detached or unresolved. */
  currentBranch: string | undefined
}

/**
 * Enumerates and constructs diff sources for a PanelContext.
 */
export class DiffSourceCatalog implements vscode.Disposable {
  private readonly sessionFetch: SessionDiffFetch = async ({ sessionID, directory }) => {
    const client = this.connection.getClient()
    const { data } = await client.session.diff({ sessionID, directory }, { throwOnError: true })
    return data ?? []
  }

  /**
   * Turn diffs are stored on the user message itself (`summary.diffs`), not
   * on the session-level snapshot. The `/session/:id/diff` endpoint ignores
   * its `messageID` param today, so we fetch the message directly instead.
   */
  private readonly turnFetch: TurnDiffFetch = async ({ sessionID, messageID, directory }) => {
    const client = this.connection.getClient()
    const { data } = await client.session.message({ sessionID, messageID, directory }, { throwOnError: true })
    const info = data?.info
    if (!info || info.role !== "user") return []
    return info.summary?.diffs ?? []
  }

  private readonly checkSnapshotsEnabled: SnapshotEnabledCheck = async (directory) => {
    const client = this.connection.getClient()
    const { data } = await client.config.get({ directory }, { throwOnError: true })
    // Snapshot tracking defaults to true when omitted.
    return data?.snapshot !== false
  }

  // Lazily created git ops for branch listing / auto base resolution. The
  // worktree source has its own GitOps for diff operations; this one is
  // owned by the catalog so it survives source swaps.
  private branchGit: GitOps | undefined
  private branchOutput: vscode.OutputChannel | undefined

  constructor(private readonly connection: KiloConnectionService) {}

  listAvailable(ctx: PanelContext): DiffSourceDescriptor[] {
    if (ctx.hidePicker) return []
    const out: DiffSourceDescriptor[] = []
    if (ctx.workspaceRoot) {
      out.push(WORKSPACE_DESCRIPTOR)
      out.push(STAGED_DESCRIPTOR)
      out.push(UNSTAGED_DESCRIPTOR)
    }
    if (ctx.sessionId) out.push(sessionDescriptor(ctx.sessionId))
    return out
  }

  defaultSourceId(ctx: PanelContext): string | undefined {
    if (ctx.initialSourceId) return ctx.initialSourceId
    if (ctx.workspaceRoot) return WORKSPACE_SOURCE_ID
    if (ctx.sessionId) return sessionSourceId(ctx.sessionId)
    return undefined
  }

  build(id: string, ctx: PanelContext): DiffSource {
    if (id === WORKSPACE_SOURCE_ID) {
      return createWorktreeDiffSource(this.connection, { baseBranchOverride: ctx.baseBranchOverride })
    }

    if (id === STAGED_SOURCE_ID) return createStagedDiffSource()
    if (id === UNSTAGED_SOURCE_ID) return createUnstagedDiffSource()

    if (id.startsWith(TURN_PREFIX)) {
      const [sessionId, messageId] = id.slice(TURN_PREFIX.length).split(":")
      if (!sessionId || !messageId) {
        throw new Error(`DiffSourceCatalog.build: malformed turn id "${id}" (expected turn:<sessionId>:<messageId>)`)
      }
      return createTurnDiffSource(sessionId, messageId, this.turnFetch, ctx.workspaceRoot)
    }

    if (id.startsWith(SESSION_PREFIX)) {
      const sessionId = id.slice(SESSION_PREFIX.length)
      if (!sessionId) throw new Error(`DiffSourceCatalog.build: empty session id in "${id}"`)
      return createSessionDiffSource(sessionId, this.sessionFetch, ctx.workspaceRoot, this.checkSnapshotsEnabled)
    }

    throw new Error(`DiffSourceCatalog.build: unknown source id "${id}"`)
  }

  async listWorkspaceBranches(override: string | undefined): Promise<WorkspaceBranchesResult | undefined> {
    const root = getWorkspaceRoot()
    if (!root) return undefined

    const git = this.ensureBranchGit()
    const [{ branches, defaultBranch }, autoTarget, head] = await Promise.all([
      git.listBranches(root),
      resolveLocalDiffTarget(git, this.branchLog, root),
      git.currentBranch(root),
    ])
    const autoBase = autoTarget?.baseBranch
    const currentBase = override ?? autoBase
    const currentBranch = head && head !== "HEAD" ? head : undefined
    return {
      branches,
      defaultBranch,
      autoBase,
      currentBase,
      isAuto: !override,
      currentBranch,
    }
  }

  dispose(): void {
    this.branchGit?.dispose()
    this.branchGit = undefined
    this.branchOutput?.dispose()
    this.branchOutput = undefined
  }

  private readonly branchLog = (...args: unknown[]) => {
    if (!this.branchOutput) return
    appendOutput(this.branchOutput, "DiffSourceCatalog", ...args)
  }

  private ensureBranchGit(): GitOps {
    if (this.branchGit) return this.branchGit
    this.branchOutput = vscode.window.createOutputChannel("Kilo Diff: Branches")
    this.branchGit = new GitOps({ log: this.branchLog })
    return this.branchGit
  }
}
