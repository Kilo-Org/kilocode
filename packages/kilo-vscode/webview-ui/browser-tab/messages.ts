import type { ExtensionMessage, WebviewMessage } from "../src/types/messages"
import {
  browserDevtoolsEvent,
  browserFrameEvent,
  browserInspectionEvent,
  browserScope,
  browserStateEvent,
} from "../browser"
import type { BrowserCommand, BrowserEvent } from "../browser"

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
    return browserFrameEvent(browserScope(message.sessionId), message)
  }
  if (message.type === "browserTab.state") {
    return browserStateEvent(browserScope(message.sessionId, message.projectId), message)
  }
  if (message.type === "browserTab.inspection") {
    return browserInspectionEvent(browserScope(message.sessionId, message.projectId), message)
  }
  if (message.type !== "browserTab.devtools") return
  return browserDevtoolsEvent(browserScope(message.sessionId, message.projectId), message)
}
