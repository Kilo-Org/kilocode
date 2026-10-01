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
  log: (...args: unknown[]) => void
}) {
  const browser = input.browser ?? new BrowserBroker({ log: input.log })
  browser.bind(
    (route: BrowserRoute) => {
      const directory = canonicalizePath(route.directory)
      const ctx = input.contexts().byDirectory(directory)
      if (!ctx || (route.projectId && route.projectId !== ctx.id)) return undefined
      const state = ctx.peekState()
      const stored = state?.getSession(route.sessionId)
      const live = ctx.sessions().find((session) => session.id === route.sessionId)
      if (!stored && !live) return undefined
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
    const active = input.contexts().active()
    if ((state.status === "starting" || state.status === "loading") && state.projectId === active?.id) {
      input.openPanel()
    }
    input.post(browserMessage(state))
  }
  const off = browser.subscribe(post)
  const frames = browser.frames((frame) => input.post({ type: "agentManager.browserFrame", ...frame }))
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
    replay(): void {
      browser.replay(post)
    },
    close(sessionId: string, projectId?: string): void {
      void browser.close(sessionId, projectId).catch((error) => input.log("Failed to close browser session:", error))
    },
    closeProject(projectId: string): void {
      for (const session of browser.sessions()) this.close(session, projectId)
    },
    closeAll(): Promise<void> {
      return Promise.all([...browser.sessions()].map((sessionId) => browser.close(sessionId))).then(() => undefined)
    },
    dispose(): Promise<void> {
      current = undefined
      off()
      frames()
      return browser.disposeAsync()
    },
  }
}
