/**
 * ProjectContexts — coordinator owning all ProjectContext instances for one panel.
 *
 * Derives the pinned context from the current workspace root, creates registry
 * project contexts on demand (expand/select), tracks which project is active
 * and which are expanded, and serializes snapshots for the webview. See
 * ./context.ts for the per-repository lifecycle policy.
 */

import * as fs from "fs"
import * as path from "path"
import { canonicalizePath, projectIdFor, samePath } from "./paths"
import type { StoredProject } from "./registry"
import { ProjectContext, type ProjectContextDeps } from "./context"

/** Serializable project description for the webview. */
export interface ProjectSnapshot {
  id: string
  root: string
  label: string
  pinned: boolean
  active: boolean
  expanded: boolean
  initialized: boolean
  trusted: boolean
  missing: boolean
}

interface ContextsOptions {
  /** Current VS Code workspace root; may change when workspace folders change. */
  workspaceRoot: () => string | undefined
  registry: {
    list(): StoredProject[]
    get(id: string): StoredProject | undefined
    expanded?(id: string): boolean | undefined
  }
  /** Registry trust lookup for non-pinned projects. */
  trusted: (id: string) => boolean
  /** Whether the multi-project experiment is enabled. */
  enabled: () => boolean
  remove?: (id: string) => void
  deps: ProjectContextDeps
}

export class ProjectContexts {
  private readonly contexts = new Map<string, ProjectContext>()
  private activeId: string | undefined
  private readonly expansion = new Map<string, boolean>()

  constructor(private readonly opts: ContextsOptions) {}

  /** The pinned workspace project, derived lazily from the current workspace root. */
  pinned(): ProjectContext | undefined {
    const root = this.opts.workspaceRoot()
    if (!root) return undefined
    const canonical = canonicalizePath(root)
    return this.ensure(projectIdFor(canonical), canonical, true)
  }

  private ensure(id: string, root: string, pinned: boolean): ProjectContext {
    let ctx = this.contexts.get(id)
    if (!ctx) {
      ctx = new ProjectContext(id, root, pinned, this.opts.deps)
      this.contexts.set(id, ctx)
    }
    return ctx
  }

  /** Resolve any known project id to a context, creating it on demand. */
  private resolveCtx(id: string): ProjectContext | undefined {
    const existing = this.contexts.get(id)
    if (existing) return existing
    const pinned = this.pinned()
    if (pinned?.id === id) return pinned
    if (!this.opts.enabled()) return undefined
    const stored = this.opts.registry.get(id)
    if (!stored) return undefined
    return this.ensure(stored.id, stored.root, false)
  }

  /** The active context. Defaults to the pinned project, or the first trusted registry project without a workspace. */
  active(): ProjectContext | undefined {
    if (this.activeId) return this.contexts.get(this.activeId)
    const pinned = this.pinned()
    if (pinned) {
      this.activeId = pinned.id
      this.rememberExpansion(pinned.id, true)
      return pinned
    }
    if (!this.opts.enabled()) return undefined
    const first = this.opts.registry.list().find((p) => this.opts.trusted(p.id))
    if (!first) return undefined
    const ctx = this.ensure(first.id, first.root, false)
    this.activeId = ctx.id
    this.rememberExpansion(ctx.id, false)
    return ctx
  }

  get(id: string): ProjectContext | undefined {
    return this.contexts.get(id)
  }

  /** The context that owns a directory: its root or one of its worktree paths. */
  byDirectory(dir: string): ProjectContext | undefined {
    for (const ctx of this.contexts.values()) {
      if (samePath(ctx.root, dir)) return ctx
      const state = ctx.peekState()
      if (state?.getWorktrees().some((wt) => wt.path && samePath(wt.path, dir))) return ctx
    }
    return undefined
  }

  /** The context whose state owns the worktree id. */
  byWorktree(id: string): ProjectContext | undefined {
    for (const ctx of this.contexts.values()) {
      if (ctx.peekState()?.getWorktree(id)) return ctx
    }
    return undefined
  }

  /** The context whose live session list contains the session. */
  byLiveSession(id: string): ProjectContext | undefined {
    for (const ctx of this.contexts.values()) {
      if (ctx.hasLiveSession(id)) return ctx
    }
    return undefined
  }

  /** Resolve any known project id to a context without activating it. */
  resolve(id: string): ProjectContext | undefined {
    return this.resolveCtx(id)
  }

  /** Whether a project may be shown or initialized: known, flag-gated, and trusted. */
  usable(id: string): ProjectContext | undefined {
    return this.usableCtx(id)
  }

  isActive(id: string): boolean {
    return this.active()?.id === id
  }

  isExpanded(id: string): boolean {
    const value = this.expansion.get(id)
    if (value !== undefined) return value
    const stored = this.opts.registry.expanded?.(id)
    if (stored !== undefined) return stored
    const root = this.opts.workspaceRoot()
    return root !== undefined && projectIdFor(canonicalizePath(root)) === id
  }

  /** Make a project the active context and expand it. Returns undefined when not allowed. */
  activate(id: string): ProjectContext | undefined {
    const ctx = this.usableCtx(id)
    if (!ctx) return undefined
    this.activeId = id
    this.rememberExpansion(id, false)
    return ctx
  }

  /** Expand a project without activating it. Returns undefined when not allowed. */
  expand(id: string): ProjectContext | undefined {
    const ctx = this.usableCtx(id)
    if (!ctx) return undefined
    this.expansion.set(id, true)
    return ctx
  }

  collapse(id: string): void {
    this.expansion.set(id, false)
    if (this.isActive(id)) return
    this.contexts.get(id)?.suspend()
  }

  /** Return ownership to pinned Local and suspend all secondary contexts. */
  disable(): ProjectContext | undefined {
    const pinned = this.pinned()
    this.activeId = pinned?.id
    if (pinned) this.expansion.set(pinned.id, true)
    for (const ctx of this.contexts.values()) {
      if (ctx.pinned) continue
      this.expansion.set(ctx.id, false)
      ctx.suspend()
      // Match remove()/syncPinned(): drop the routes too, otherwise the shared
      // route service accumulates entries for every disabled project.
      this.opts.remove?.(ctx.id)
    }
    return pinned
  }

  private usableCtx(id: string): ProjectContext | undefined {
    const ctx = this.resolveCtx(id)
    if (!ctx) return undefined
    if (ctx.pinned) return ctx
    if (!this.opts.enabled()) return undefined
    if (!this.opts.trusted(id)) return undefined
    return ctx
  }

  /** Remove a non-pinned project context. Falls back to the pinned project when it was active. */
  async remove(id: string): Promise<boolean> {
    const ctx = this.contexts.get(id)
    if (!ctx || ctx.pinned) return false
    this.expansion.delete(id)
    if (this.activeId === id) this.activeId = undefined
    this.contexts.delete(id)
    this.opts.remove?.(id)
    await ctx.dispose()
    return true
  }

  /**
   * Re-derive the pinned project after workspace folder changes. Disposes the
   * old pinned context so cached services can never mix two roots. Returns
   * true when the active context may have changed.
   */
  syncPinned(): boolean {
    const root = this.opts.workspaceRoot()
    const next = root ? projectIdFor(canonicalizePath(root)) : undefined
    const current = [...this.contexts.values()].find((ctx) => ctx.pinned)?.id
    if (current === next) return false
    for (const [id, ctx] of [...this.contexts]) {
      if (!ctx.pinned) continue
      this.contexts.delete(id)
      this.expansion.delete(id)
      if (this.activeId === id) this.activeId = undefined
      this.opts.remove?.(id)
      ctx.suspend()
      void ctx.dispose()
    }
    return true
  }

  /** Serializable snapshots for the webview: pinned first, then registry order. */
  snapshots(): ProjectSnapshot[] {
    const out: ProjectSnapshot[] = []
    const pinned = this.pinned()
    if (pinned) out.push(this.snapshot(pinned, undefined))
    if (!this.opts.enabled()) return out
    for (const stored of this.opts.registry.list()) {
      if (pinned?.id === stored.id) continue
      out.push(this.snapshot(this.contexts.get(stored.id), stored))
    }
    return out
  }

  private snapshot(ctx: ProjectContext | undefined, stored: StoredProject | undefined): ProjectSnapshot {
    const id = ctx?.id ?? stored!.id
    const root = ctx?.root ?? stored!.root
    const pinned = ctx?.pinned ?? false
    const missing = ctx ? ctx.missing() : !(this.opts.deps.exists ?? fs.existsSync)(root)
    return {
      id,
      root,
      label: stored?.label || path.basename(root) || root,
      pinned,
      active: this.isActive(id),
      expanded: !missing && this.isExpanded(id),
      initialized: ctx?.loaded ?? false,
      trusted: pinned || (stored?.trusted ?? false),
      missing,
    }
  }

  private rememberExpansion(id: string, fallback: boolean): void {
    if (this.expansion.has(id)) return
    this.expansion.set(id, this.opts.registry.expanded?.(id) ?? fallback)
  }

  async dispose(): Promise<void> {
    for (const ctx of this.contexts.values()) {
      this.opts.remove?.(ctx.id)
      await ctx.dispose()
    }
    this.contexts.clear()
    this.expansion.clear()
    this.activeId = undefined
  }
}
