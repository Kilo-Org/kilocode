import type { UiI18nParams } from "@kilocode/kilo-ui/context"
import type { BrowserFrame } from "../../src/shared/browser-stream"
import type { ExtensionMessage, WebviewMessage } from "../src/types/messages"
import type {
  BrowserCommand,
  BrowserDevtools,
  BrowserEvent,
  BrowserInspection,
  BrowserLabels,
  BrowserScope,
  BrowserState,
  BrowserTransport,
} from "./types"

export function browserScope(sessionId: string, projectId?: string): BrowserScope {
  return { sessionId, projectId }
}

export function browserStateEvent(scope: BrowserScope, message: Omit<BrowserState, "scope">): BrowserEvent {
  return { type: "state", value: { scope, ...message } }
}

export function browserInspectionEvent(scope: BrowserScope, message: Omit<BrowserInspection, "scope">): BrowserEvent {
  return { type: "inspection", value: { scope, ...message } }
}

export function browserDevtoolsEvent(scope: BrowserScope, message: Omit<BrowserDevtools, "scope">): BrowserEvent {
  return { type: "devtools", value: { scope, ...message } }
}

export function browserFrameEvent(scope: BrowserScope, frame: BrowserFrame): BrowserEvent {
  return { type: "frame", value: { ...frame, scope } }
}

/** Shared browser panel labels. Both browser surfaces use the Agent Manager keys. */
export function browserLabels(
  t: (key: string, params?: UiI18nParams) => string,
  noSessionKey = "agentManager.browser.noSession",
): BrowserLabels {
  return {
    title: t("agentManager.browser.title"),
    url: t("agentManager.browser.url"),
    urlPlaceholder: t("agentManager.browser.urlPlaceholder"),
    open: t("agentManager.browser.open"),
    openExternal: t("agentManager.browser.openExternal"),
    refresh: t("agentManager.browser.refresh"),
    back: t("agentManager.browser.back"),
    forward: t("agentManager.browser.forward"),
    close: t("agentManager.browser.close"),
    inspect: t("agentManager.browser.inspect"),
    devtoolsTitle: t("agentManager.browser.devtoolsTitle"),
    diagnostics: t("agentManager.browser.diagnostics"),
    diagnosticsHint: t("agentManager.browser.diagnosticsHint"),
    empty: t("agentManager.browser.empty"),
    requirement: t("agentManager.browser.requirement"),
    missingTitle: t("agentManager.browser.missingTitle"),
    missingChrome: t("agentManager.browser.missingChrome"),
    missingChromium: t("agentManager.browser.missingChromium"),
    download: t("agentManager.browser.downloadChrome"),
    retry: t("common.retry"),
    settings: t("agentManager.browser.settings"),
    noSession: t(noSessionKey),
    screenshotAlt: t("agentManager.browser.screenshotAlt"),
    errors: (count: number) => t("agentManager.browser.errors", { count }),
  }
}

/** Shared transport that frames browser commands and events for one surface. */
export function browserTransport(
  post: (message: WebviewMessage) => void,
  onMessage: (handler: (message: ExtensionMessage) => void) => () => void,
  command: (value: BrowserCommand) => WebviewMessage,
  event: (message: ExtensionMessage) => BrowserEvent | undefined,
): BrowserTransport {
  return {
    send: (value) => post(command(value)),
    subscribe: (listener) =>
      onMessage((message) => {
        const value = event(message)
        if (value) listener(value)
      }),
  }
}
