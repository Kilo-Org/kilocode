import * as vscode from "vscode"
import type { ConfigEntry } from "@opencode/client"
import type { AgentManagerConnection } from "../../agent-manager/connection"
import { GitOps } from "../../agent-manager/GitOps"
import { gitGeneratedFiles } from "../shared/git-attributes"
import { resolveLocalDiffTarget } from "../shared/target"
import { appendOutput, getWorkspaceRoot } from "../shared/output"
import type { BranchListItem } from "../../agent-manager/git-import"
import type { PanelContext } from "../context"
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
import type { WorktreeDiffEntry } from "../../agent-manager/types"

export interface LocalDiffSource {
  summary: (dir: string, base: string) => Promise<WorktreeDiffEntry[]>
  file: (dir: string, base: string, file: string, signal?: AbortSignal) => Promise<WorktreeDiffEntry | null>
}

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
  /**
   * A session diff covers the whole session, not only its newest turn. The
   * server range starts at the oldest user message and ends at the newest one.
   */
  private readonly sessionFetch: SessionDiffFetch = async ({ sessionID }) => {
    const client = await this.connection.client()
    const [oldest, newest] = await Promise.all([
      client.message.list({ sessionID, type: "user", order: "asc", limit: 1 }),
      client.message.list({ sessionID, type: "user", order: "desc", limit: 1 }),
    ])
    const from = oldest.data[0]?.id
    if (from === undefined) return []
    const last = newest.data[0]?.id
    return await client.session.diff({ sessionID, from, to: last === from ? undefined : last })
  }

  /** A turn diff starts at the user message that opened the turn. */
  private readonly turnFetch: TurnDiffFetch = async ({ sessionID, messageID }) => {
    const client = await this.connection.client()
    return await client.session.diff({ sessionID, from: messageID })
  }

  private readonly checkSnapshotsEnabled: SnapshotEnabledCheck = async (directory) => {
    const client = await this.connection.client()
    const documents = (await client.config.get({ location: { directory } })).filter(isDocument)
    // Documents arrive from lowest to highest priority, so the last one that
    // sets snapshots wins. Tracking defaults to true when none sets it.
    return documents.findLast((entry) => entry.info.snapshots !== undefined)?.info.snapshots ?? true
  }

  // Lazily created git ops for branch listing / auto base resolution. The
  // worktree source has its own GitOps for diff operations; this one is
  // owned by the catalog so it survives source swaps.
  private branchGit: GitOps | undefined
  private branchOutput: vscode.OutputChannel | undefined
  private attributeGit: GitOps | undefined
  private attributeOutput: vscode.OutputChannel | undefined

  constructor(
    private readonly connection: AgentManagerConnection,
    private readonly local?: LocalDiffSource,
  ) {}

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
    const opts = { dir: () => ctx.dir, strictDir: ctx.strictDir, git: ctx.git, log: ctx.log }
    const dir = ctx.dir ?? ctx.workspaceRoot
    const generated = dir
      ? (files: readonly string[]) => gitGeneratedFiles(ctx.git ?? this.ensureAttributeGit(), dir, files)
      : undefined
    if (id === WORKSPACE_SOURCE_ID) {
      return createWorktreeDiffSource({
        ...opts,
        baseBranchOverride: ctx.baseBranchOverride,
        baseBranch: ctx.baseBranch,
        summary: this.local?.summary,
        file: this.local?.file,
      })
    }

    if (id === STAGED_SOURCE_ID) return createStagedDiffSource(opts)
    if (id === UNSTAGED_SOURCE_ID) return createUnstagedDiffSource(opts)

    if (id.startsWith(TURN_PREFIX)) {
      const [sessionId, messageId] = id.slice(TURN_PREFIX.length).split(":")
      if (!sessionId || !messageId) {
        throw new Error(`DiffSourceCatalog.build: malformed turn id "${id}" (expected turn:<sessionId>:<messageId>)`)
      }
      return createTurnDiffSource(sessionId, messageId, this.turnFetch, generated)
    }

    if (id.startsWith(SESSION_PREFIX)) {
      const sessionId = id.slice(SESSION_PREFIX.length)
      if (!sessionId) throw new Error(`DiffSourceCatalog.build: empty session id in "${id}"`)
      return createSessionDiffSource(sessionId, this.sessionFetch, dir, this.checkSnapshotsEnabled, generated)
    }

    throw new Error(`DiffSourceCatalog.build: unknown source id "${id}"`)
  }

  async listWorkspaceBranches(
    override: string | undefined,
    dir?: string,
  ): Promise<WorkspaceBranchesResult | undefined> {
    const root = dir ?? getWorkspaceRoot()
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
    this.attributeGit?.dispose()
    this.attributeGit = undefined
    this.branchOutput?.dispose()
    this.branchOutput = undefined
    this.attributeOutput?.dispose()
    this.attributeOutput = undefined
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

  private ensureAttributeGit(): GitOps {
    if (this.attributeGit) return this.attributeGit
    this.attributeOutput = vscode.window.createOutputChannel("Kilo Diff: Attributes")
    this.attributeGit = new GitOps({
      log: (...args) => appendOutput(this.attributeOutput!, "DiffSourceCatalog", ...args),
    })
    return this.attributeGit
  }
}

function isDocument(entry: ConfigEntry): entry is Extract<ConfigEntry, { type: "document" }> {
  return entry.type === "document"
}