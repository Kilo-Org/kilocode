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
import { createSettingsHandler, type SettingsHandler } from "./settings"

export interface ProjectWiring {
  registry: ProjectRegistry
  contexts: ProjectContexts
  /** Project-scoped settings handler shared with the Kilo Settings editor. */
  settings: SettingsHandler
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
  /** Push one project's state (or every context when omitted) to the webview. */
  pushState: (ctx?: ProjectContext) => void
  /** Re-derive the pinned project after workspace folder changes. */
  changed: () => void
  /** Acknowledge an atomically validated sidebar selection. */
  selected: (target: import("./route").SidebarTarget) => void
  /** Route one session to a directory inside a project (override + project route). */
  routeSession?: (projectId: string, sessionId: string, directory: string, generation: number) => void
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
    pushState: opts.pushState,
    selected: opts.selected,
    routeSession: opts.routeSession,
    git: opts.git,
    error: (message) => opts.host.showError(message),
    openSettings: (tab, projectId) => opts.host.openSettings(tab, projectId),
    log: opts.log,
  }
  const settings = createSettingsHandler({
    contexts,
    open: (path) => opts.host.openDocument(path),
    push: opts.pushState,
    log: opts.log,
  })
  const listeners: Disposable[] = [
    opts.host.onDidChangeWorkspaceFolders(() => opts.changed()),
    opts.host.onDidChangeMultiProject((enabled) => {
      if (!enabled) {
        const pinned = contexts.disable()
        if (pinned) opts.activate(pinned)
      }
      opts.push()
      opts.pushState()
    }),
  ]
  return {
    registry,
    contexts,
    settings,
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
