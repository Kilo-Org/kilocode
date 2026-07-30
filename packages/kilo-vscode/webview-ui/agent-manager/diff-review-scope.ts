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
import { createDiffScope, isDiffScope, scopeDescriptors, type DiffScope } from "./diff-scope-state"

interface VsCode {
  postMessage(msg: unknown): void
}

export interface DiffReviewScopeOptions {
  /** Current diff context (worktree session id or the LOCAL pseudo-id). */
  ctx: Accessor<string | undefined>
  /** Whether the diff side panel is open. */
  panelOpen: Accessor<boolean>
  /** Whether the full-screen review tab is active. */
  reviewActive: Accessor<boolean>
  /** The id that marks the local pseudo-context (omits the Session scope). */
  local: string
  vscode: VsCode
}

export function createDiffReviewScope(opts: DiffReviewScopeOptions) {
  const scope = createDiffScope(opts.ctx)
  // The composite id (ctx#scope) the extension keys diff data by.
  const id = createMemo(() => scope.id())

  // Branch picker state for the active context (Branch scope only).
  const [branches, setBranches] = createSignal<BranchInfo[]>([])
  const [loading, setLoading] = createSignal(false)
  const [defaultBranch, setDefaultBranch] = createSignal("")
  const [autoBase, setAutoBase] = createSignal<string | undefined>(undefined)
  const [currentBase, setCurrentBase] = createSignal<string | undefined>(undefined)
  const [isAuto, setIsAuto] = createSignal(true)
  const [currentBranch, setCurrentBranch] = createSignal<string | undefined>(undefined)

  // Scope descriptors for the current context. The `local` pseudo-context and
  // contexts without a real session omit the Session scope.
  const descriptors = createMemo(() => {
    const ctx = opts.ctx()
    if (!ctx) return []
    return scopeDescriptors(ctx, ctx !== opts.local)
  })

  const isBranch = () => scope.scope() === "branch"

  const select = (next: string) => {
    const ctx = opts.ctx()
    if (!ctx) return
    const value = next.slice(ctx.length + 1)
    scope.setScope(isDiffScope(value) ? value : "branch")
  }

  const selectBase = (branch: string | undefined) => {
    const ctx = opts.ctx()
    if (!ctx) return
    // Optimistic update; the extension echoes authoritative state back.
    setCurrentBase(branch ?? autoBase())
    setIsAuto(branch === undefined)
    opts.vscode.postMessage({ type: "agentManager.setDiffBaseBranch", sessionId: ctx, scope: scope.scope(), branch })
  }

  // Fetch branch picker data whenever the Branch scope becomes active for the
  // current context. The extension owns override state, so ask each time.
  createEffect(() => {
    if (scope.scope() !== "branch") return
    const ctx = opts.ctx()
    if (!ctx) return
    if (!opts.panelOpen() && !opts.reviewActive()) return
    setLoading(true)
    opts.vscode.postMessage({ type: "agentManager.requestDiffBranches", sessionId: ctx, scope: scope.scope() })
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
