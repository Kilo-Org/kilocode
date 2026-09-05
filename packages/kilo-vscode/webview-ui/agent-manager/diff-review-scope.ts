/**
 * Diff scope + base branch state for the Agent Manager review surfaces.
 *
 * Owns the per-context scope selection, the branch picker data for the active
 * context, and the message senders that drive both. Extracted from
 * AgentManagerApp to keep that file under its line cap; both the side panel
 * and the full-screen review tab consume the single instance returned here.
 */

import { createEffect, createMemo, createSignal, type Accessor } from "solid-js"
import type { BranchInfo } from "../src/types/messages"
import { composeDiffId, createDiffScope, isDiffScope, scopeDescriptors } from "./diff-scope-state"

interface VsCode {
  postMessage(msg: unknown): void
}

export interface DiffReviewScopeOptions {
  /** Current diff context (worktree id or the LOCAL pseudo-id). */
  ctx: Accessor<string | undefined>
  /** Active session inside the context; the Session scope follows it. */
  session: Accessor<string | undefined>
  /** Whether the diff side panel is open. */
  panelOpen: Accessor<boolean>
  /** Whether the full-screen review tab is active. */
  reviewActive: Accessor<boolean>
  vscode: VsCode
  project: Accessor<string | undefined>
}

export function createDiffReviewScope(opts: DiffReviewScopeOptions) {
  const scope = createDiffScope(opts.ctx)
  // The composite id (ctx#scope, or ctx#session:<sid>) the extension keys
  // diff data by. Rebuilds when the active session changes while the Session
  // scope is active, so a session tab switch refetches that session's diff.
  const id = createMemo(() => {
    const ctx = opts.ctx()
    if (!ctx) return undefined
    return composeDiffId(ctx, scope.scope(), scope.scope() === "session" ? opts.session() : undefined)
  })

  // Branch picker state for the active context (Branch scope only).
  const [branches, setBranches] = createSignal<BranchInfo[]>([])
  const [loading, setLoading] = createSignal(false)
  const [defaultBranch, setDefaultBranch] = createSignal("")
  const [autoBase, setAutoBase] = createSignal<string | undefined>(undefined)
  const [currentBase, setCurrentBase] = createSignal<string | undefined>(undefined)
  const [isAuto, setIsAuto] = createSignal(true)
  const [currentBranch, setCurrentBranch] = createSignal<string | undefined>(undefined)

  // Scope descriptors for the current context. The Session scope only exists
  // when the context has an active session to diff.
  const descriptors = createMemo(() => {
    const ctx = opts.ctx()
    if (!ctx) return []
    return scopeDescriptors(ctx, opts.session())
  })

  // Fall back to Branch when the active session disappears (tab closed,
  // session deleted) while the Session scope is selected.
  createEffect(() => {
    const ctx = opts.ctx()
    if (!ctx) return
    if (scope.scope() === "session" && !opts.session()) scope.setScope("branch")
  })

  const isBranch = () => scope.scope() === "branch"

  const select = (next: string) => {
    const ctx = opts.ctx()
    if (!ctx) return
    const value = next.slice(ctx.length + 1)
    if (value.startsWith("session")) {
      scope.setScope("session")
      return
    }
    scope.setScope(isDiffScope(value) ? value : "branch")
  }

  const selectBase = (branch: string | undefined) => {
    const ctx = opts.ctx()
    if (!ctx) return
    // Optimistic update; the extension echoes authoritative state back.
    setCurrentBase(branch ?? autoBase())
    setIsAuto(branch === undefined)
    opts.vscode.postMessage({
      type: "agentManager.setDiffBaseBranch",
      projectId: opts.project(),
      sessionId: ctx,
      scope: scope.scope(),
      branch,
    })
  }

  // Fetch branch picker data whenever the Branch scope becomes active for the
  // current context. The extension owns override state, so ask each time.
  createEffect(() => {
    if (scope.scope() !== "branch") return
    const ctx = opts.ctx()
    if (!ctx) return
    if (!opts.panelOpen() && !opts.reviewActive()) return
    setLoading(true)
    opts.vscode.postMessage({
      type: "agentManager.requestDiffBranches",
      projectId: opts.project(),
      sessionId: ctx,
      scope: scope.scope(),
    })
  })

  /** Handle the extension's diffBranches push, ignoring stale contexts. */
  const onBranches = (ev: {
    sessionId: string
    branches: BranchInfo[]
    defaultBranch: string
    autoBase?: string
    currentBase?: string
    isAuto: boolean
    currentBranch?: string
  }) => {
    if (ev.sessionId === id()) {
      setBranches(ev.branches)
      setDefaultBranch(ev.defaultBranch)
      setAutoBase(ev.autoBase)
      setCurrentBase(ev.currentBase)
      setIsAuto(ev.isAuto)
      setCurrentBranch(ev.currentBranch)
    }
    setLoading(false)
  }

  return {
    scope: scope.scope,
    id,
    descriptors,
    isBranch,
    select,
    selectBase,
    onBranches,
    branches,
    loading,
    defaultBranch,
    autoBase,
    currentBase,
    isAuto,
    currentBranch,
  }
}
