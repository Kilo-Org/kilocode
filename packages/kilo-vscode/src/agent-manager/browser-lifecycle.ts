import { BrowserBroker, type BrowserRoute, type BrowserState } from "../services/browser-automation"
import type { Host, PanelContext } from "./host"
import type { AgentManagerInMessage, AgentManagerOutMessage } from "./types"
import type { ProjectContexts } from "./project/contexts"
import { canonicalizePath, samePath } from "./project/paths"
import { browserMessage, handleBrowserMessage } from "./browser-message"

type Panel = Pick<PanelContext, "visible" | "onDidChangeVisibility" | "onDidDispose">

export function createBrowserLifecycle(input: {
  browser?: BrowserBroker
  host: Host
  contexts: () => ProjectContexts
  post: (message: AgentManagerOutMessage) => void
  openPanel: () => void
  /** True when the editor tab serves the session, so a browser_open route for it is not claimed here. */
  editorTab: (sessionId: string) => boolean
  log: (...args: unknown[]) => void
}) {
  const browser = input.browser ?? new BrowserBroker({ log: input.log })
  const owner = browser.bind(
    (route: BrowserRoute) => {
      const directory = canonicalizePath(route.directory)
      const ctx = input.contexts().byDirectory(directory)
      if (!ctx || (route.projectId && route.projectId !== ctx.id)) return undefined
      // A route without a project comes from the browser_open tool. The project catalog also lists the sidebar's
      // sessions rooted in this directory, so the tool route for a session the editor tab serves (the one the sidebar
      // shows, or one whose tab stays open) belongs to the tab. A route with a project comes from the panel itself.
      if (!route.projectId && (input.editorTab(route.sessionId) || browser.ownedByOther(route.sessionId, owner)))
        return undefined
      const state = ctx.peekState()
      const stored = state?.getSession(route.sessionId)
      const live = ctx.sessions().find((session) => session.id === route.sessionId)
      const worktree = stored?.worktreeId ?? live?.worktreeId
      const expected = worktree ? state?.getWorktree(worktree)?.path : ctx.root
      if (!expected || !samePath(canonicalizePath(expected), directory)) return undefined
      return { projectId: ctx.id, sessionId: route.sessionId, directory }
    },
    async (_route, url) => {
      if (!input.host.isTrusted() || !input.host.browserAutomation()) return false
      return (await input.host.approveBrowserNavigation?.(url.origin)) === true
    },
  )
  const post = (state: BrowserState) => {
    // Browser entries opened for sidebar or editor-tab sessions carry no Agent
    // Manager project. The tab browser owns and renders those, so Agent Manager
    // must not broadcast them or reveal its own panel.
    if (!state.projectId) return
    const active = input.contexts().active()
    if ((state.status === "starting" || state.status === "loading") && state.projectId === active?.id) {
      input.openPanel()
    }
    input.post(browserMessage(state))
  }
  const off = browser.subscribe(post)
  const frames = browser.frames((frame) => {
    if (!frame.projectId) return
    input.post({ type: "agentManager.browserFrame", ...frame })
  })
  const cursors = browser.cursors((cursor) => {
    if (!cursor.projectId) return
    input.post({ type: "agentManager.browserCursor", ...cursor })
  })
  let current: Panel | undefined
  return {
    attach(panel: Panel): void {
      current = panel
      panel.onDidChangeVisibility((visible) => {
        if (current === panel && !visible) browser.suspend()
      })
      panel.onDidDispose(() => {
        if (current !== panel) return
        current = undefined
        browser.suspend()
      })
      if (!panel.visible) browser.suspend()
      browser.replay(post)
    },
    handle(message: AgentManagerInMessage): boolean {
      return handleBrowserMessage(message, {
        host: input.host,
        contexts: input.contexts(),
        browser,
        post: input.post,
        log: input.log,
      })
    },
    close(sessionId: string, projectId?: string): void {
      void browser.close(sessionId, projectId).catch((error) => input.log("Failed to close browser session:", error))
    },
    closeProject(projectId: string): void {
      for (const session of browser.sessions()) this.close(session, projectId)
    },
    closeAll(): Promise<void> {
      return browser.closeOwned(owner)
    },
    dispose(): Promise<void> {
      current = undefined
      off()
      frames()
      cursors()
      browser.unbind(owner)
      return browser.disposeAsync()
    },
  }
}
