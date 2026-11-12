import * as vscode from "vscode"
import { randomUUID } from "node:crypto"
import { addCommentReaction, isPRReactionContent, removeCommentReaction } from "../agent-manager/pr/PRActions"
import { ghErrorReason } from "../agent-manager/pr/am-pr-utils"
import { PRReviewActions } from "../agent-manager/pr/review-actions"
import type { PRReviewContext } from "../agent-manager/pr/review-context"
import { execWithShellEnv } from "../agent-manager/shell-env"
import type { PRStatus } from "../agent-manager/types"
import { wire, type ChangesTab } from "../chat"
import { thread } from "../shared/pr-review"
import { isHttpsUrl, type PRReviewCommentData, type ReviewCommentEntry } from "../shared/review-comments"
import { appendOutput, getWorkspaceRoot, openRelativeFile } from "../review-utils"
import { getDiffMarkdownRender, getUserDiffStyle, setDiffMarkdownRender, setUserDiffStyle } from "../review-settings"
import type { Manager } from "../server"
import type { PanelContext } from "./context"
import { SourceController } from "./SourceController"
import { createDiffCommentActions } from "./comment-actions"
import { createDiffPRPolling, type DiffPRPoller, type DiffPRPollerOptions } from "./pr-poller"
import type { DiffSourceCatalog } from "./sources/catalog"
import { turnSourceId } from "./sources/turn"
import { WORKSPACE_SOURCE_ID } from "./sources/worktree"

type CommentHandler = (comments: ReviewCommentEntry[], autoSend: boolean) => void
type OpenArgs = {
  sessionId?: string
  turnId?: string
  initialSourceId?: string
  directory?: string
  file?: string
  comment?: PRReviewCommentData
  beside?: boolean
}

function openDirectory(
  arg: OpenArgs | undefined,
  sessionId: string | undefined,
  lookup: (id: string) => string | undefined,
) {
  if (arg && "directory" in arg) return arg.directory
  if (!sessionId) return undefined
  return lookup(sessionId)
}

function openSource(arg: OpenArgs | undefined, sessionId: string | undefined): string | undefined {
  if (arg?.comment) return WORKSPACE_SOURCE_ID
  if (!arg?.turnId || !sessionId) return arg?.initialSourceId
  return turnSourceId(sessionId, arg.turnId)
}

type ReactionRequest = {
  commentId: string
  reaction: Parameters<typeof addCommentReaction>[1]
  add: boolean
}

function reactionRequest(msg: Record<string, unknown>): ReactionRequest | undefined {
  if (typeof msg.commentId !== "string") return
  if (!isPRReactionContent(msg.reaction)) return
  if (typeof msg.add !== "boolean") return
  return { commentId: msg.commentId, reaction: msg.reaction, add: msg.add }
}

export function hasReactionComment(pr: PRStatus | undefined, id: string): boolean {
  return (
    // A reply has its own reaction buttons, so its id is a valid target too.
    pr?.comments?.comments.some((comment) => comment.id === id || comment.replies?.some((reply) => reply.id === id)) ||
    pr?.conversation?.some((comment) => comment.id === id) ||
    false
  )
}

function context(
  arg: OpenArgs | undefined,
  sessionId: string | undefined,
  dir: string | undefined,
  source: string | undefined,
): PanelContext {
  const ctx: PanelContext = {
    workspaceRoot: getWorkspaceRoot(),
    sessionId,
    dir,
    comment: arg?.comment,
    beside: arg?.beside,
    initialSourceId: source,
    initialFile: arg?.file ?? arg?.comment?.file,
    hidePicker: !!(!arg?.comment && arg?.turnId && sessionId),
  }
  if (arg?.comment) {
    ctx.initialMarkdown = false
    return ctx
  }
  if (typeof arg?.file === "string" && /\.(md|mdx|markdown)$/i.test(arg.file)) {
    ctx.initialMarkdown = true
  }
  return ctx
}

/** The part of a PanelContext a reload restores. The injected GitOps and log handles stay with the provider. */
function restorable(ctx: PanelContext): PanelContext {
  return { ...ctx, git: undefined, log: undefined }
}

/** The context a restored panel saved in its webview state, or undefined when the state predates it. */
export function restoredContext(state: unknown): PanelContext | undefined {
  if (!state || typeof state !== "object" || !("diffViewer" in state)) return undefined
  const saved = state.diffViewer
  if (!saved || typeof saved !== "object") return undefined
  const value = saved as Record<string, unknown>
  const text = (item: unknown) => (typeof item === "string" ? item : undefined)
  return {
    workspaceRoot: getWorkspaceRoot(),
    sessionId: text(value.sessionId),
    dir: text(value.dir),
    comment: savedComment(value.comment),
    beside: value.beside === true || undefined,
    initialSourceId: text(value.initialSourceId),
    initialFile: text(value.initialFile),
    initialMarkdown: typeof value.initialMarkdown === "boolean" ? value.initialMarkdown : undefined,
    hidePicker: value.hidePicker === true || undefined,
    baseBranchOverride: text(value.baseBranchOverride),
    strictDir: value.strictDir === true || undefined,
    baseBranch: text(value.baseBranch),
  }
}

/** The saved PR comment, when the state carries one the review flow can reopen. */
function savedComment(value: unknown): PRReviewCommentData | undefined {
  if (!value || typeof value !== "object") return undefined
  const record = value as Record<string, unknown>
  if (typeof record.id !== "string" || record.origin !== "pr") return undefined
  return value as PRReviewCommentData
}

export interface DiffViewerProviderOptions {
  sessionIdProvider?: () => string | undefined
  sessionDirectoryProvider?: (sessionId: string) => string | undefined
  createPRPoller?: (opts: DiffPRPollerOptions) => DiffPRPoller
}

/**
 * Single global "Changes" panel. Owns the webview panel lifecycle and routes webview messages to a
 * SourceController, which owns the active DiffSource.
 */
export class DiffViewerProvider implements vscode.Disposable, ChangesTab {
  public static readonly viewType = "kilo-code.v2.DiffViewerPanel"

  private panel: vscode.WebviewPanel | undefined
  private post: ((message: unknown) => void) | undefined
  private surface: vscode.Disposable | undefined
  private ctx: PanelContext | undefined
  private controller: SourceController | undefined
  private baseBranchOverride: string | undefined
  private readonly prPolling: ReturnType<typeof createDiffPRPolling>
  private readonly reviews: PRReviewActions
  private focusPending = false
  private openGeneration = 0
  private readonly identity = randomUUID()
  private readonly actions = createDiffCommentActions({
    context: () => this.commentContext(),
    post: (message) => this.send(message),
    refresh: () => this.prPolling.refresh(),
    log: (...args) => this.log(...args),
  })
  private readonly sessionIdProvider: () => string | undefined
  private readonly sessionDirectoryProvider: (sessionId: string) => string | undefined
  private readonly output: vscode.OutputChannel

  constructor(
    private readonly input: {
      context: vscode.ExtensionContext
      server: Manager
      directory: string
      catalog: DiffSourceCatalog
      /**
       * Receives the comments the user sends to chat. The sidebar is the only chat that opens this panel, so every
       * open shares one destination instead of carrying its own callback.
       */
      onComments: CommentHandler
    },
    opts: DiffViewerProviderOptions = {},
  ) {
    this.sessionIdProvider = opts.sessionIdProvider ?? (() => undefined)
    this.sessionDirectoryProvider = opts.sessionDirectoryProvider ?? (() => undefined)
    this.output = vscode.window.createOutputChannel("Kilo Diff Panel")
    this.prPolling = createDiffPRPolling({
      createPoller: opts.createPRPoller,
      onStatus: () => this.sendComments(),
      log: (...args) => this.log(...args),
    })
    this.reviews = new PRReviewActions({
      context: (message) => this.reviewContext(message),
      post: (message) => this.send(message),
      refresh: (review) => {
        if (this.commentContext()?.token === review.projectId) this.prPolling.refresh()
      },
      dirtyFiles: () => [],
      checkBranch: async (directory) => {
        const result = await execWithShellEnv("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
          cwd: directory,
          timeout: 5_000,
        })
        return result.stdout.trim()
      },
    })
  }

  /** The Changes tab contract of the sidebar. */
  open(input: { sessionId?: string; turnId?: string }): void {
    this.openFromCommand({ sessionId: input.sessionId, turnId: input.turnId })
  }

  openPanel(ctx: PanelContext): void {
    const generation = ++this.openGeneration
    const previous = this.ctx
    const changed = previous !== undefined && this.contextKey(previous) !== this.contextKey(ctx)
    if (previous && (previous.dir ?? previous.workspaceRoot) !== (ctx.dir ?? ctx.workspaceRoot))
      this.baseBranchOverride = undefined
    this.focusPending = !!ctx.comment
    this.ctx = { ...ctx, baseBranchOverride: this.baseBranchOverride }

    if (this.panel && this.controller) {
      this.reveal()
      const nextId = this.input.catalog.defaultSourceId(this.ctx)
      const sourceId = changed ? nextId : (this.controller.currentId ?? nextId)
      this.prPolling.sync(this.ctx, sourceId, this.panel.visible)
      this.openContext(changed)
      if (changed) this.controller.stop()
      this.controller.setContext(this.ctx)
      if (nextId && nextId !== this.controller.currentId) {
        void this.activate(nextId, generation)
        return
      }
      if (nextId) void this.reactivate(nextId, generation)
      else this.focus()
      return
    }

    this.createPanel(this.ctx)
  }

  /**
   * Entry point for the `kilo-code.v2.showChanges` command. Composes the PanelContext from the argument and the
   * injected session lookups.
   *
   * When `turnId` is passed, opens the panel scoped to that single turn with the source picker hidden.
   */
  openFromCommand(arg?: OpenArgs): void {
    const sessionId = arg?.sessionId ?? this.sessionIdProvider()
    const dir = openDirectory(arg, sessionId, this.sessionDirectoryProvider)
    this.openPanel(context(arg, sessionId, dir, openSource(arg, sessionId)))
  }

  /**
   * Called when VS Code restores a serialized panel after a window reload. The webview saved the context it showed,
   * so the panel attaches to the same session and turn again. A panel from before that state existed has nothing to
   * show and closes.
   */
  deserializePanel(panel: vscode.WebviewPanel, state: unknown): void {
    const ctx = restoredContext(state)
    if (!ctx) return panel.dispose()
    this.baseBranchOverride = ctx.baseBranchOverride
    this.attach(panel, ctx)
  }

  dispose(): void {
    this.prPolling.stop()
    this.controller?.dispose()
    this.controller = undefined
    // Close the webview first: its dispose handler logs, so it must run before the output channel is gone.
    this.panel?.dispose()
    this.disposePanel()
    this.output.dispose()
  }

  private createPanel(ctx: PanelContext): void {
    const panel = vscode.window.createWebviewPanel(
      DiffViewerProvider.viewType,
      "Changes",
      ctx.beside ? vscode.ViewColumn.Beside : vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this.input.context.extensionUri],
      },
    )
    this.attach(panel, ctx)
  }

  /** Wires a panel the provider created or VS Code restored to the context it shows. */
  private attach(panel: vscode.WebviewPanel, ctx: PanelContext): void {
    panel.iconPath = {
      light: vscode.Uri.joinPath(this.input.context.extensionUri, "assets", "icons", "kilo-light.svg"),
      dark: vscode.Uri.joinPath(this.input.context.extensionUri, "assets", "icons", "kilo-dark.svg"),
    }
    this.panel = panel
    this.ctx = ctx
    this.post = (message) => void panel.webview.postMessage(message)
    this.surface = wire({
      context: this.input.context,
      server: this.input.server,
      directory: ctx.dir ?? this.input.directory,
      webview: panel.webview,
      view: "diffViewer",
      handle: (message) => this.onMessage(message as unknown as Record<string, unknown>),
    })

    this.controller = new SourceController(
      (id, context) => this.input.catalog.build(id, context),
      (context) => this.input.catalog.listAvailable(context),
      (message) => this.send(message as Record<string, unknown>),
    )
    this.controller.setVisible(panel.visible).catch((err) => this.log("Failed to update diff visibility:", err))
    this.controller.setContext(ctx)

    panel.onDidChangeViewState(() =>
      this.controller?.setVisible(panel.visible).catch((err) => this.log("Failed to update diff visibility:", err)),
    )
    panel.onDidChangeViewState((state) => this.prPolling.setVisible(state.webviewPanel.visible))
    panel.onDidDispose(() => this.onPanelDisposed())
    this.openContext(false)
    this.prPolling.sync(ctx, ctx.initialSourceId, panel.visible)
  }

  private onPanelDisposed(): void {
    this.log("Panel disposed")
    this.controller?.dispose()
    this.controller = undefined
    this.prPolling.stop()
    this.baseBranchOverride = undefined
    this.disposePanel()
  }

  private disposePanel(): void {
    this.surface?.dispose()
    this.surface = undefined
    this.post = undefined
    this.panel = undefined
  }

  private onMessage(msg: Record<string, unknown>): boolean {
    if (this.actions.handle(msg) || this.reviews.handle(msg)) return true
    const handler = this.messageHandlers[msg.type as string]
    if (!handler) return false
    handler(msg)
    return true
  }

  private async onCommentReaction(msg: Record<string, unknown>): Promise<void> {
    const request = reactionRequest(msg)
    if (!request) return
    const { commentId, reaction, add } = request
    const result = (success: boolean, error?: string) => {
      this.send({
        type: "agentManager.commentReactionResult",
        worktreeId: "diff",
        // The webview drops a result whose project differs from the PR it shows, so echo the request's project.
        ...(typeof msg.projectId === "string" ? { projectId: msg.projectId } : {}),
        commentId,
        reaction,
        add,
        success,
        ...(error ? { error } : {}),
      })
    }
    const pr = this.prPolling.getStatus()
    if (!hasReactionComment(pr, commentId)) {
      result(false, "PR comment not found. Refresh and try again.")
      return
    }
    const dir = this.ctx?.dir ?? this.ctx?.workspaceRoot ?? getWorkspaceRoot()
    if (!dir) {
      result(false, "The PR comment directory is unavailable.")
      return
    }
    try {
      await (add ? addCommentReaction(commentId, reaction, dir) : removeCommentReaction(commentId, reaction, dir))
      result(true)
      this.prPolling.refresh()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.log("Failed to update PR comment reaction:", message)
      result(false, ghErrorReason(message))
    }
  }

  private readonly messageHandlers: Record<string, (msg: Record<string, unknown>) => void> = {
    webviewReady: () => this.onWebviewReady(),
    selectSource: (msg) => {
      if (typeof msg.id !== "string") return
      this.focusPending = false
      void this.activate(msg.id, this.openGeneration, false)
    },
    "diffViewer.sendComments": (msg) => {
      if (Array.isArray(msg.comments)) this.input.onComments(msg.comments as ReviewCommentEntry[], !!msg.autoSend)
    },
    "agentManager.copyToClipboard": (msg) => {
      if (typeof msg.text === "string") void vscode.env.clipboard.writeText(msg.text)
    },
    "agentManager.commentReaction": (msg) => void this.onCommentReaction(msg),
    openExternal: (msg) => {
      if (typeof msg.url !== "string" || !isHttpsUrl(msg.url)) return
      void vscode.env.openExternal(vscode.Uri.parse(msg.url))
    },
    "diffViewer.close": () => this.panel?.dispose(),
    "diffViewer.setDiffStyle": (msg) => {
      if (msg.style === "unified" || msg.style === "split") void setUserDiffStyle(msg.style)
    },
    "diffViewer.setMarkdownRender": (msg) => {
      if (typeof msg.render === "boolean") void setDiffMarkdownRender(msg.render)
    },
    "diffViewer.revertFile": (msg) => {
      if (typeof msg.file === "string") void this.controller?.revertFile(msg.file)
    },
    "diffViewer.requestFile": (msg) => {
      if (typeof msg.file === "string") void this.controller?.requestFile(msg.file)
    },
    "diffViewer.requestBranches": () => {
      void this.sendBranches()
    },
    "diffViewer.setBaseBranch": (msg) => {
      const branch = typeof msg.branch === "string" && msg.branch.length > 0 ? msg.branch : undefined
      this.baseBranchOverride = branch
      if (this.ctx) {
        // Drops an activation still running for the old base. The PR identity does not change.
        this.openGeneration += 1
        this.ctx = { ...this.ctx, baseBranchOverride: branch }
        this.controller?.setContext(this.ctx)
        this.sendComments()
      }
      void this.controller?.reactivate()
      void this.sendBranches()
    },
    openFile: (msg) => {
      if (typeof msg.filePath !== "string") return
      openRelativeFile(
        this.ctx?.dir ?? this.ctx?.workspaceRoot,
        msg.filePath,
        typeof msg.line === "number" ? msg.line : undefined,
      )
    },
  }

  private async sendBranches(): Promise<void> {
    if (!this.panel) return
    const ctx = this.ctx
    const branch = this.baseBranchOverride
    try {
      const result = await this.input.catalog.listWorkspaceBranches(branch, ctx?.dir)
      if (!result || !this.panel || ctx !== this.ctx || branch !== this.baseBranchOverride) return
      this.send({
        type: "diffViewer.branches",
        branches: result.branches,
        defaultBranch: result.defaultBranch,
        autoBase: result.autoBase,
        currentBase: result.currentBase,
        isAuto: result.isAuto,
        currentBranch: result.currentBranch,
      })
    } catch (err) {
      this.log("Failed to list workspace branches:", err instanceof Error ? err.message : String(err))
    }
  }

  private onWebviewReady(): void {
    if (!this.panel) return
    this.send({ type: "diffViewer.markdownRender", render: getDiffMarkdownRender() })
    const style = getUserDiffStyle()
    if (style) this.send({ type: "diffViewer.initialDiffStyle", style })
    this.openContext(false)
    const initial = this.ctx ? this.input.catalog.defaultSourceId(this.ctx) : undefined
    if (!initial) {
      this.focus()
      return
    }
    if (this.controller?.currentId === initial) {
      void this.reactivate(initial, this.openGeneration)
      return
    }
    void this.activate(initial, this.openGeneration)
  }

  private async activate(id: string, generation: number, jump = true): Promise<void> {
    if (!this.panel || !this.controller) return
    if (this.controller.currentId === id) return

    this.prPolling.sync(this.ctx, id, this.panel.visible)
    this.resetView()
    await this.controller.activate(id).catch((err) => {
      const message = err instanceof Error ? err.message : String(err)
      this.log("Failed to activate source:", message)
    })
    if (generation !== this.openGeneration) return
    this.sendComments()
    if (jump) this.focus()
  }

  private async reactivate(id: string, generation: number): Promise<void> {
    if (!this.panel || !this.controller || this.controller.currentId !== id) return
    await this.controller.reactivate().catch((err) => {
      const message = err instanceof Error ? err.message : String(err)
      this.log("Failed to reactivate source:", message)
    })
    if (generation !== this.openGeneration) return
    this.sendComments()
    this.focus()
  }

  private resetView(): void {
    this.send({ type: "diffViewer.loading", loading: true })
    this.send({ type: "diffViewer.diffs", diffs: [] })
    this.send({ type: "diffViewer.notice", notice: undefined })
  }

  private reveal(): void {
    if (!this.panel) return
    this.panel.reveal(this.ctx?.beside ? vscode.ViewColumn.Beside : (this.panel.viewColumn ?? vscode.ViewColumn.One))
  }

  private openContext(changed: boolean): void {
    if (!this.panel || !this.ctx) return
    if (changed) {
      this.resetView()
      this.send({ type: "diffViewer.prComments", comments: [] })
    }
    this.send({ type: "diffViewer.context", key: this.contextKey(this.ctx), restore: restorable(this.ctx) })
    this.send({ type: "diffViewer.initialFile", file: this.ctx.initialFile })
    if (this.ctx.initialMarkdown !== undefined)
      this.send({ type: "diffViewer.initialMarkdown", render: this.ctx.initialMarkdown })
    this.sendComments()
  }

  private contextKey(ctx: PanelContext): string {
    return JSON.stringify([ctx.sessionId ?? "", ctx.dir ?? ctx.workspaceRoot ?? ""])
  }

  private sendComments(): void {
    if (!this.panel) return
    const live = this.prPolling.getStatus()?.comments?.comments ?? []
    const selected = this.ctx?.comment ? thread(this.ctx.comment) : undefined
    const match = selected
      ? live.find((comment) => comment.threadId === selected.threadId || comment.id === selected.threadId)
      : undefined
    const comments = selected && !match ? [...live, { ...selected, outdated: true }] : live
    const ctx = this.commentContext()
    const target = ctx
      ? {
          projectId: ctx.token,
          worktreeId: "diff",
          prNumber: ctx.pr.number,
          prUrl: ctx.pr.url,
          baseRefOid: ctx.pr.baseRefOid,
          headRefOid: ctx.pr.headRefOid,
        }
      : undefined
    this.send({
      type: "diffViewer.prComments",
      comments,
      target,
      threads: live.map((comment) => comment.threadId),
    })
    if (!match || !this.focusPending) return
    this.focusPending = false
    this.focus()
  }

  private focus(): void {
    if (!this.panel || !this.ctx?.comment?.file) return
    const id = this.ctx.comment.id
    const comment =
      this.prPolling.getStatus()?.comments?.comments.find((item) => item.threadId === id || item.id === id) ??
      thread(this.ctx.comment)
    this.send({
      type: "diffViewer.focusComment",
      id: comment.threadId,
      file: comment.file ?? this.ctx.comment.file,
    })
  }

  private commentContext() {
    const pr = this.prPolling.getStatus()
    const branch = this.prPolling.getBranch()
    const directory = this.ctx?.dir ?? this.ctx?.workspaceRoot
    if (!this.panel || !pr || !branch || !directory) return
    return {
      // The PR identity only. A re-open or a base-branch change shows the same PR, so unsent comments must survive it.
      token: JSON.stringify([this.identity, branch, pr.number, pr.url]),
      directory,
      branch,
      pr,
    }
  }

  private reviewContext(message: Record<string, unknown>): PRReviewContext {
    const ctx = this.commentContext()
    if (
      !ctx ||
      message.projectId !== ctx.token ||
      message.worktreeId !== "diff" ||
      message.prNumber !== ctx.pr.number ||
      message.prUrl !== ctx.pr.url
    )
      throw new Error("Pull request context changed. Refresh and try again.")
    return {
      pr: ctx.pr,
      directory: ctx.directory,
      branch: ctx.branch,
      worktreeId: "diff",
      projectId: ctx.token,
    }
  }

  private send(message: unknown): void {
    this.post?.(message)
  }

  private log(...args: unknown[]): void {
    appendOutput(this.output, "DiffViewerProvider", ...args)
  }
}
