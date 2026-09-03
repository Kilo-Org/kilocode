/**
 * Webview-side diff scope state for Agent Manager.
 *
 * Mirrors the extension's composite diff id (`ctx#scope`, or `ctx#session:<sid>`
 * for the session scope — see `src/agent-manager/diff-scope.ts`) and builds the
 * fixed scope descriptor list shown in the scope selector. The context is the
 * sidebar selection (a worktree id or the `local` pseudo-context), so it stays
 * stable across session tab switches; only the Session scope follows the active
 * session. Agent Manager always offers the same four scopes per context, so the
 * descriptors are computed client-side rather than pushed from the extension.
 */

import { createMemo, createSignal, type Accessor } from "solid-js"
import type { DiffSourceDescriptor } from "../../src/diff/sources/types"

import { composeDiffId, DEFAULT_DIFF_SCOPE, type DiffScope } from "../../src/agent-manager/diff-scope"

export {
  composeDiffId,
  parseDiffId,
  isDiffScope,
  DEFAULT_DIFF_SCOPE,
  type DiffScope,
} from "../../src/agent-manager/diff-scope"

/**
 * The fixed scope descriptors for a context. `workspace` maps to the Branch
 * scope to reuse the existing i18n keys (`diffViewer.source.workspace.*`).
 * Session scope is only meaningful when the context has an active session, so
 * it is omitted while a context has none (e.g. an empty worktree or the local
 * context with no open session).
 */
export function scopeDescriptors(ctx: string, sessionId?: string): DiffSourceDescriptor[] {
  const out: DiffSourceDescriptor[] = [
    {
      id: composeDiffId(ctx, "branch"),
      type: "workspace",
      group: "Git",
      capabilities: { revert: true, comments: true },
    },
    { id: composeDiffId(ctx, "staged"), type: "staged", group: "Git", capabilities: { revert: false, comments: true } },
    {
      id: composeDiffId(ctx, "unstaged"),
      type: "unstaged",
      group: "Git",
      capabilities: { revert: false, comments: true },
    },
  ]
  if (sessionId) {
    out.push({
      id: composeDiffId(ctx, "session", sessionId),
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
 * new context defaults to Branch. The context is the sidebar selection, so the
 * picked scope survives session tab switches inside the context.
 */
export function createDiffScope(currentCtx: Accessor<string | undefined>) {
  const [scopes, setScopes] = createSignal<Record<string, DiffScope>>({})

  const scope = createMemo((): DiffScope => {
    const ctx = currentCtx()
    if (!ctx) return DEFAULT_DIFF_SCOPE
    return scopes()[ctx] ?? DEFAULT_DIFF_SCOPE
  })

  const setScope = (next: DiffScope) => {
    const ctx = currentCtx()
    if (!ctx) return
    setScopes((prev) => ({ ...prev, [ctx]: next }))
  }

  return { scope, setScope }
}
