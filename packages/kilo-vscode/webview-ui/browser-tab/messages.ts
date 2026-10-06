import type { ExtensionMessage, WebviewMessage } from "../src/types/messages"
import type { BrowserCommand, BrowserEvent, BrowserInspection, BrowserScope, BrowserState } from "../browser"

export function scope(sessionId: string, projectId?: string): BrowserScope {
  return { sessionId, projectId }
}

function unreachable(value: never): never {
  throw new Error(`Unhandled browser command: ${JSON.stringify(value)}`)
}

export function command(value: BrowserCommand): WebviewMessage {
  if (value.type === "open") {
    return { type: "browserTab.open", ...value.scope, url: value.url }
  }
  if (value.type === "refresh") return { type: "browserTab.refresh", ...value.scope }
  if (value.type === "back") return { type: "browserTab.back", ...value.scope }
  if (value.type === "forward") return { type: "browserTab.forward", ...value.scope }
  if (value.type === "close") return { type: "browserTab.close", ...value.scope }
  if (value.type === "state") return { type: "browserTab.state", ...value.scope }
  if (value.type === "devtools") {
    return { type: "browserTab.devtools", ...value.scope, theme: value.theme }
  }
  if (value.type === "input") {
    return { type: "browserTab.input", ...value.scope, ...value.position, click: value.click }
  }
  if (value.type === "viewport") {
    return {
      type: "browserTab.viewport",
      ...value.scope,
      browserId: value.browserId,
      navigation: value.navigation,
      viewport: value.viewport,
    }
  }
  if (value.type === "interact") {
    return { type: "browserTab.interact", ...value.scope, identity: value.identity, event: value.event }
  }
  if (value.type === "acknowledge") {
    return {
      type: "browserTab.acknowledge",
      ...value.scope,
      identity: value.identity,
      sequence: value.sequence,
    }
  }
  if (value.type === "inspect") {
    return {
      type: "browserTab.inspect",
      ...value.scope,
      ...value.position,
      hover: value.hover,
      requestId: value.requestId,
    }
  }
  return unreachable(value)
}

export function event(message: ExtensionMessage): BrowserEvent | undefined {
  if (message.type === "browserTab.frame") {
    return { type: "frame", value: { ...message, scope: scope(message.sessionId) } }
  }
  if (message.type === "browserTab.state") {
    const value: BrowserState = {
      scope: scope(message.sessionId, message.projectId),
      browserId: message.browserId,
      navigation: message.navigation,
      status: message.status,
      inspecting: message.inspecting,
      url: message.url,
      title: message.title,
      errors: message.errors,
      logs: message.logs,
      error: message.error,
      missing: message.missing,
      frameError: message.frameError,
      back: message.back,
      forward: message.forward,
    }
    return { type: "state", value }
  }
  if (message.type === "browserTab.inspection") {
    const value: BrowserInspection = {
      scope: scope(message.sessionId, message.projectId),
      requestId: message.requestId,
      url: message.url,
      title: message.title,
      element: message.element,
      logs: message.logs,
      hover: message.hover,
      error: message.error,
    }
    return { type: "inspection", value }
  }
  if (message.type !== "browserTab.devtools") return
  return {
    type: "devtools",
    value: {
      scope: scope(message.sessionId, message.projectId),
      browserId: message.browserId,
      url: message.url,
    },
  }
}
