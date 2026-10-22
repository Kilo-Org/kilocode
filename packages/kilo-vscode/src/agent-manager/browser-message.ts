import { type BrowserBroker, type BrowserState } from "../services/browser-automation"
import {
  browserControlMessage,
  browserStatePayload,
  controlBrowser,
  controlBrowserFailure,
  type BrowserControlKind,
  type BrowserControlMessage,
  type BrowserControlSurface,
} from "../services/browser-automation/browser-control"
import type { AgentManagerInMessage, AgentManagerOutMessage } from "./types"
import type { ProjectContexts } from "./project/contexts"
import type { Host } from "./host"

type BrowserMessage = Extract<AgentManagerInMessage, { type: `agentManager.browser.${string}` }>
type Dependencies = {
  host: Host
  contexts: ProjectContexts
  browser: BrowserBroker
  post: (message: AgentManagerOutMessage) => void
  log: (...args: unknown[]) => void
}

const prefix = "agentManager.browser."

function control(message: BrowserMessage): BrowserControlMessage {
  return browserControlMessage(message.type.slice(prefix.length) as BrowserControlKind, message)
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

function surface(
  deps: Dependencies,
  message: BrowserMessage,
  projectId: string | undefined,
  directory?: string,
): BrowserControlSurface {
  return {
    sessionId: message.sessionId,
    projectId,
    openDirectory: () => directory,
    readClipboard: deps.host.readClipboard?.bind(deps.host),
    writeClipboard: (text) => deps.host.copyToClipboard(text),
    state: (state, error, missing) => {
      if (state) {
        deps.post(browserMessage(error ? { ...state, error } : state))
        return
      }
      deps.post({
        type: "agentManager.browserState",
        browserId: "",
        projectId,
        sessionId: message.sessionId,
        status: "error",
        errors: 0,
        error,
        missing,
      })
    },
    inspection: ({ requestId, hover, value, error }) => {
      if (value) {
        deps.post({
          type: "agentManager.browserInspection",
          projectId,
          sessionId: message.sessionId,
          requestId,
          ...value,
          hover,
        })
        return
      }
      deps.post({
        type: "agentManager.browserInspection",
        projectId,
        sessionId: message.sessionId,
        requestId,
        hover,
        logs: [],
        error,
      })
    },
    devtools: (tools) =>
      deps.post({ type: "agentManager.browserDevtools", projectId, sessionId: message.sessionId, ...tools }),
    log: deps.log,
  }
}

export function handleBrowserMessage(message: AgentManagerInMessage, deps: Dependencies): boolean {
  if (!message.type.startsWith(prefix)) return false
  const m = message as BrowserMessage
  const controlMessage = control(m)
  if (!deps.host.isTrusted()) {
    controlBrowserFailure(
      controlMessage,
      surface(deps, m, m.projectId),
      "Browser preview requires a trusted workspace.",
    )
    return true
  }
  if (!deps.host.browserAutomation()) {
    controlBrowserFailure(
      controlMessage,
      surface(deps, m, m.projectId),
      "Browser automation is disabled. Enable it in Kilo Settings > Experimental.",
    )
    return true
  }
  const scope = route(deps.contexts, m)
  if (!scope) {
    controlBrowserFailure(
      controlMessage,
      surface(deps, m, m.projectId),
      "Browser session is not available in the selected project.",
    )
    return true
  }
  controlBrowser(controlMessage, deps.browser, surface(deps, m, scope.project, scope.directory))
  return true
}

export function browserMessage(state: BrowserState): AgentManagerOutMessage {
  return {
    type: "agentManager.browserState",
    ...browserStatePayload(state),
  }
}
