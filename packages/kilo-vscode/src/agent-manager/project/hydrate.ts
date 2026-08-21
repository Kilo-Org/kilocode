/**
 * Background project hydration for the Agent Manager sidebar.
 *
 * An expanded project accordion renders entirely from a pushed
 * agentManager.state payload, so a project without one stays on loading
 * placeholders. For background (non-active) projects that payload is produced
 * asynchronously after the context loads, which means it can be posted before
 * the webview mounts and is then lost: the panel attaches and pushes the
 * catalog first, and the webview only asks for the catalog again on mount.
 *
 * Re-pushing already loaded contexts on every catalog push closes that gap for
 * both a freshly opened panel and a reloaded webview, instead of leaving the
 * accordion on placeholders until the user clicks a row inside it.
 */

import type { ProjectContext } from "./context"
import type { ProjectSnapshot } from "./contexts"

interface Hooks {
  /** Expand a project without activating it; undefined when not allowed. */
  expand: (id: string) => ProjectContext | undefined
  /** Re-post the state of an already loaded context. */
  push: (ctx: ProjectContext) => void
  /** Load a cold context and push its state once it is ready. */
  init: (ctx: ProjectContext) => void
}

/** Ensure every expanded background project has current state in the webview. */
export function hydrateExpanded(projects: readonly ProjectSnapshot[], hooks: Hooks): void {
  for (const project of projects) {
    if (project.active || !project.expanded || project.missing) continue
    const ctx = hooks.expand(project.id)
    if (!ctx) continue
    if (ctx.lifecycle === "ready") hooks.push(ctx)
    else hooks.init(ctx)
  }
}
