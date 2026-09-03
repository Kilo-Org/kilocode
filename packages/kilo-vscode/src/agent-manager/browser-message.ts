import { diagnostic, type BrowserBroker, type BrowserState } from "../services/browser-automation"
import type { AgentManagerInMessage, AgentManagerOutMessage } from "./types"
import type { ProjectContexts } from "./project/contexts"
import type { Host } from "./host"

type BrowserMessage = Extract<AgentManagerInMessage, { type: `agentManager.browser.${string}` }>

function position(message: BrowserMessage): { x: number; y: number; width: number; height: number } | undefined {
  if (
    typeof message.x !== "number" ||
    typeof message.y !== "number" ||
    typeof message.width !== "number" ||
    typeof message.height !== "number"
  ) {
    return
  }
  return { x: message.x, y: message.y, width: message.width, height: message.height }
}

function fail(
  deps: { post: (message: AgentManagerOutMessage) => void },
  m: BrowserMessage,
  error: string,
  state?: BrowserState,
): void {
  if (m.type === "agentManager.browser.inspect") {
    deps.post({
      type: "agentManager.browserInspection",
      projectId: m.projectId,
      sessionId: m.sessionId,
      requestId: m.requestId ?? "",
      hover: m.hover,
      logs: [],
      error,
    })
    return
  }
  if (state) {
    deps.post(browserMessage({ ...state, error }))
    return
  }
  deps.post({
    type: "agentManager.browserState",
    browserId: "",
    projectId: m.projectId,
    sessionId: m.sessionId,
    status: "error",
    errors: 0,
    error,
  })
}

function route(contexts: ProjectContexts, message: BrowserMessage): { project: string; directory: string } | undefined {
  const ctx = contexts.resolve(message.projectId ?? contexts.active()?.id ?? "")
  if (!ctx) return
  const state = ctx.peekState()
  const session = state?.getSession(message.sessionId)
  const live = ctx.sessions().find((item) => item.id === message.sessionId)
  if (!session && !live) return
  const worktree = session?.worktreeId ?? live?.worktreeId
  const directory = worktree ? state?.getWorktree(worktree)?.path : ctx.root
  return directory ? { project: ctx.id, directory } : undefined
}

function action(
  m: BrowserMessage,
  deps: {
    host: Host
    contexts: ProjectContexts
    browser: BrowserBroker
    post: (message: AgentManagerOutMessage) => void
    log: (...args: unknown[]) => void
  },
): boolean {
  const scope = route(deps.contexts, m)
  if (!scope) {
    fail(deps, m, "Browser session is not available in the selected project.")
    return true
  }
  if (m.type === "agentManager.browser.state") {
    const current = deps.browser.get(m.sessionId, scope.project)
    if (current) deps.post(browserMessage(current))
    return true
  }
  if (m.type === "agentManager.browser.devtools") {
    void deps.browser
      .devtools(m.sessionId, scope.project, m.theme === "light" ? "light" : "dark")
      .then((tools) =>
        deps.post({
          type: "agentManager.browserDevtools",
          projectId: scope.project,
          sessionId: m.sessionId,
          ...tools,
        }),
      )
      .catch((error: unknown) => {
        deps.log("Browser developer tools failed:", error)
        fail(deps, m, diagnostic(error), deps.browser.get(m.sessionId, scope.project))
      })
    return true
  }
  if (m.type === "agentManager.browser.open") {
    if (!m.url) return true
    void deps.browser
      .open({ projectId: scope.project, sessionId: m.sessionId, directory: scope.directory }, m.url)
      .catch((error: unknown) => {
        deps.log("Browser open failed:", error)
        const current = deps.browser.get(m.sessionId, scope.project)
        if (current) {
          deps.post(browserMessage(current))
          return
        }
        fail(deps, m, diagnostic(error, m.url))
      })
    return true
  }
  if (m.type === "agentManager.browser.refresh") {
    void deps.browser.refresh(m.sessionId, scope.project).catch((error: unknown) => {
      deps.log("Browser refresh failed:", error)
      const current = deps.browser.get(m.sessionId, scope.project)
      if (current) deps.post(browserMessage(current))
    })
    return true
  }
  if (m.type === "agentManager.browser.inspect" || m.type === "agentManager.browser.input") {
    const point = position(m)
    if (!point) {
      fail(deps, m, "Browser element coordinates are required.", deps.browser.get(m.sessionId, scope.project))
      return true
    }
    if (m.type === "agentManager.browser.input") {
      void deps.browser.input(m.sessionId, scope.project, point, m.click === true).catch((error: unknown) => {
        deps.log("Browser developer tools input failed:", error)
        fail(deps, { ...m, projectId: scope.project }, diagnostic(error), deps.browser.get(m.sessionId, scope.project))
      })
      return true
    }
    void deps.browser
      .inspect(m.sessionId, scope.project, point, m.hover !== true)
      .then((inspection) =>
        deps.post({
          type: "agentManager.browserInspection",
          projectId: scope.project,
          sessionId: m.sessionId,
          requestId: m.requestId ?? "",
          ...inspection,
          hover: m.hover,
        }),
      )
      .catch((error: unknown) => {
        deps.log("Browser element inspection failed:", error)
        fail(deps, { ...m, projectId: scope.project }, diagnostic(error))
      })
    return true
  }
  void deps.browser
    .close(m.sessionId, scope.project)
    .catch((error: unknown) => deps.log("Browser close failed:", error))
  return true
}

export function handleBrowserMessage(
  message: AgentManagerInMessage,
  deps: {
    host: Host
    contexts: ProjectContexts
    browser: BrowserBroker
    post: (message: AgentManagerOutMessage) => void
    log: (...args: unknown[]) => void
  },
): boolean {
  if (!message.type.startsWith("agentManager.browser.")) return false
  const m = message as BrowserMessage
  if (!deps.host.isTrusted()) {
    fail(deps, m, "Browser preview requires a trusted workspace.")
    return true
  }
  if (!deps.host.browserAutomation()) {
    fail(deps, m, "Browser automation is disabled. Enable it in Kilo Settings > Experimental.")
    return true
  }
  return action(m, deps)
}

export function browserMessage(state: BrowserState): AgentManagerOutMessage {
  return {
    type: "agentManager.browserState",
    browserId: state.browserId,
    projectId: state.projectId,
    sessionId: state.sessionId,
    navigation: state.navigation,
    status: state.status,
    inspecting: state.inspecting,
    url: state.url,
    title: state.title,
    errors: state.errors,
    logs: state.logs,
    error: state.error,
    frameError: state.frameError,
  }
}
