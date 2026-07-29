/**
 * Webview-side diff scope state for Agent Manager.
 *
 * Mirrors the extension's composite diff id (`ctx#scope`, see
 * `src/agent-manager/diff-scope.ts`) and builds the fixed scope descriptor
 * list shown in the scope selector. Agent Manager always offers the same four
 * scopes per context, so the descriptors are computed client-side rather than
 * pushed from the extension.
 */

import { createMemo, createSignal, type Accessor } from "solid-js"
import type { DiffSourceDescriptor } from "../../src/diff/sources/types"

export type DiffScope = "branch" | "staged" | "unstaged" | "session"

export const DEFAULT_DIFF_SCOPE: DiffScope = "branch"

const SEP = "#"

export function composeDiffId(ctx: string, scope: DiffScope): string {
  return `${ctx}${SEP}${scope}`
}

export function isDiffScope(value: string): value is DiffScope {
  return value === "branch" || value === "staged" || value === "unstaged" || value === "session"
}

/**
 * The fixed scope descriptors for a context. `workspace` maps to the Branch
 * scope to reuse the existing i18n keys (`diffViewer.source.workspace.*`).
 * Session scope is only meaningful for a real session context, so it is
 * omitted for the `local` pseudo-context and for contexts without a session.
 */
export function scopeDescriptors(ctx: string, hasSession: boolean): DiffSourceDescriptor[] {
  const out: DiffSourceDescriptor[] = [
    { id: composeDiffId(ctx, "branch"), type: "workspace", group: "Git", capabilities: { revert: true, comments: true } },
    { id: composeDiffId(ctx, "staged"), type: "staged", group: "Git", capabilities: { revert: false, comments: true } },
    {
      id: composeDiffId(ctx, "unstaged"),
      type: "unstaged",
      group: "Git",
      capabilities: { revert: false, comments: true },
    },
  ]
  if (hasSession) {
    out.push({
      id: composeDiffId(ctx, "session"),
      type: "session",
      group: "Session",
      capabilities: { revert: false, comments: true },
    })
  }
  return out
}

/**
 * Whether the Branch scope supports revert. Staged/unstaged/session are
 * read-only; only the Branch scope can revert files back to the merge base.
 */
export function scopeCapabilities(scope: DiffScope): { revert: boolean; comments: boolean } {
  return { revert: scope === "branch", comments: true }
}

/**
 * Per-context scope selection. Keeps the last-picked scope per context id so
 * switching between worktrees restores each worktree's scope, while a brand
 * new context defaults to Branch.
 */
export function createDiffScope(currentCtx: Accessor<string | undefined>) {
  const [scopes, setScopes] = createSignal<Record<string, DiffScope>>({})

  const scope = createMemo((): DiffScope => {
    const ctx = currentCtx()
    if (!ctx) return DEFAULT_DIFF_SCOPE
    return scopes()[ctx] ?? DEFAULT_DIFF_SCOPE
  })

  const id = createMemo(() => {
    const ctx = currentCtx()
    if (!ctx) return undefined
    return composeDiffId(ctx, scope())
  })

  const setScope = (next: DiffScope) => {
    const ctx = currentCtx()
    if (!ctx) return
    setScopes((prev) => ({ ...prev, [ctx]: next }))
  }

  return { scope, id, setScope }
}
