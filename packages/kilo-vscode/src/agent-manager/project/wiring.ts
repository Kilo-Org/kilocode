/**
 * Factory for the Agent Manager multi-project wiring: registry, context
 * coordinator, message-handler dependencies, and host change listeners.
 *
 * Extracted from AgentManagerProvider (file-size cap). VS Code-free; the Host
 * interface abstracts all platform capabilities.
 */

import type { Host, Disposable } from "../host"
import type { GitOps } from "../GitOps"
import { ProjectRegistry } from "./registry"
import type { ProjectContext, ProjectInitResult } from "./context"
import { ProjectContexts, type ProjectSnapshot } from "./contexts"
import type { ProjectMessageDeps } from "./messages"

export interface ProjectWiring {
  registry: ProjectRegistry
  contexts: ProjectContexts
  messages: ProjectMessageDeps
  /** Payload for the agentManager.projects webview message. */
  snapshots(): { type: "agentManager.projects"; multiProject: boolean; projects: ProjectSnapshot[] }
  dispose(): void
}

export function createProjectWiring(opts: {
  host: Host
  git: GitOps
  log: (...args: unknown[]) => void
  output: (msg: string) => void
  /** Re-initialize provider state for a freshly activated context. */
  activate: (ctx: ProjectContext) => void
  /** Initialize an expanded background context and push its state. */
  expand: (ctx: ProjectContext) => void
  /** Ensure a context's repository state is ready (no-op once initialized). */
  ready: (ctx: ProjectContext) => Promise<ProjectInitResult>
  /** Push the project catalog to the webview. */
  push: () => void
  /** Re-derive the pinned project after workspace folder changes. */
  changed: () => void
  /** Re-push worktree state (e.g. after the flag toggles). */
  refresh: () => void
  /** Acknowledge an atomically validated sidebar selection. */
  selected: (target: import("./route").SidebarTarget) => void
}): ProjectWiring {
  const registry = new ProjectRegistry(
    { read: () => opts.host.readProjects(), write: (value) => opts.host.writeProjects(value) },
    (msg) => opts.log(msg),
  )
  const contexts = new ProjectContexts({
    workspaceRoot: () => opts.host.workspacePath(),
    registry,
    enabled: () => opts.host.multiProject(),
    remove: (id) => opts.host.unregisterProjectRoutes(id),
    deps: { log: opts.output, git: opts.git },
  })
  const messages: ProjectMessageDeps = {
    registry,
    contexts,
    enabled: () => opts.host.multiProject(),
    pickFolder: () => opts.host.pickFolder(),
    activate: opts.activate,
    expand: opts.expand,
    ready: opts.ready,
    push: opts.push,
    selected: opts.selected,
    error: (message) => opts.host.showError(message),
    log: opts.log,
  }
  const listeners: Disposable[] = [
    opts.host.onDidChangeWorkspaceFolders(() => opts.changed()),
    opts.host.onDidChangeMultiProject((enabled) => {
      if (!enabled) {
        const pinned = contexts.disable()
        if (pinned) opts.activate(pinned)
      }
      opts.push()
      opts.refresh()
    }),
  ]
  return {
    registry,
    contexts,
    messages,
    snapshots: () => ({
      type: "agentManager.projects",
      multiProject: opts.host.multiProject(),
      projects: contexts.snapshots(),
    }),
    dispose: () => {
      for (const listener of listeners) listener.dispose()
    },
  }
}
