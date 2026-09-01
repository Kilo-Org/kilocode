import { createMemo, createSignal, Show, type Accessor, type Setter } from "solid-js"
import { useLanguage } from "../src/context/language"
import { useVSCode } from "../src/context/vscode"
import type { ExtensionMessage, WebviewMessage } from "../src/types/messages"
import { formatBrowserFeedback, type BrowserReference } from "../../src/shared/browser-feedback"
import { BrowserPanel as BrowserPanelView } from "../browser"
import type {
  BrowserCommand,
  BrowserEvent,
  BrowserInspection,
  BrowserScope,
  BrowserState,
  BrowserTransport,
} from "../browser"
import { SidePanel } from "./side-panel-layout"
import { post } from "../src/utils/webview-message"

export function createBrowserPanel(
  current: Accessor<SidePanel | null>,
  panel: Setter<SidePanel | null>,
  history: Setter<boolean>,
  review: Setter<boolean>,
) {
  const [enabled, configure] = createSignal(
    (globalThis as typeof globalThis & { KILO_BROWSER_AUTOMATION?: boolean }).KILO_BROWSER_AUTOMATION === true,
  )
  const visible = () => current() === SidePanel.Browser
  const close = () => panel((current) => (current === SidePanel.Browser ? null : current))
  const open = () => {
    history(false)
    review(false)
    panel(SidePanel.Browser)
  }
  const toggle = () => {
    if (!enabled()) return
    if (visible()) return close()
    open()
  }
  return {
    tabs: { browserOpen: visible, browserAutomation: enabled, onToggleBrowser: toggle },
    bind: (current: Accessor<string | undefined>) => ({
      browser: configure,
      current,
      closeBrowser: close,
      openBrowser: open,
    }),
    render: (session: Accessor<string | undefined>, project: Accessor<string | undefined>) => (
      <Show when={enabled() && visible()}>
        <BrowserAdapter sessionId={session} projectId={project} onClose={close} />
      </Show>
    ),
  }
}

function scope(sessionId: string, projectId?: string): BrowserScope {
  return { sessionId, projectId }
}

function command(command: BrowserCommand): WebviewMessage {
  if (command.type === "open") {
    return { type: "agentManager.browser.open", ...command.scope, url: command.url }
  }
  if (command.type === "refresh") return { type: "agentManager.browser.refresh", ...command.scope }
  if (command.type === "close") return { type: "agentManager.browser.close", ...command.scope }
  if (command.type === "state") return { type: "agentManager.browser.state", ...command.scope }
  if (command.type === "devtools") {
    return { type: "agentManager.browser.devtools", ...command.scope, theme: command.theme }
  }
  if (command.type === "input") {
    return { type: "agentManager.browser.input", ...command.scope, ...command.position, click: command.click }
  }
  return {
    type: "agentManager.browser.inspect",
    ...command.scope,
    ...command.position,
    hover: command.hover,
    requestId: command.requestId,
  }
}

function event(message: ExtensionMessage): BrowserEvent | undefined {
  if (message.type === "agentManager.browserState") {
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
      frameError: message.frameError,
    }
    return { type: "state", value }
  }
  if (message.type === "agentManager.browserInspection") {
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
  if (message.type !== "agentManager.browserDevtools") return
  return {
    type: "devtools",
    value: {
      scope: scope(message.sessionId, message.projectId),
      browserId: message.browserId,
      url: message.url,
    },
  }
}

function BrowserAdapter(props: {
  sessionId: Accessor<string | undefined>
  projectId: Accessor<string | undefined>
  onClose: () => void
}) {
  const language = useLanguage()
  const vscode = useVSCode()
  const transport: BrowserTransport = {
    send: (value) => vscode.postMessage(command(value)),
    subscribe: (listener) =>
      vscode.onMessage((message) => {
        const value = event(message)
        if (value) listener(value)
      }),
  }
  const labels = createMemo(() => ({
    title: language.t("agentManager.browser.title"),
    url: language.t("agentManager.browser.url"),
    urlPlaceholder: language.t("agentManager.browser.urlPlaceholder"),
    open: language.t("agentManager.browser.open"),
    refresh: language.t("agentManager.browser.refresh"),
    close: language.t("agentManager.browser.close"),
    inspect: language.t("agentManager.browser.inspect"),
    devtoolsTitle: language.t("agentManager.browser.devtoolsTitle"),
    diagnostics: language.t("agentManager.browser.diagnostics"),
    diagnosticsHint: language.t("agentManager.browser.diagnosticsHint"),
    empty: language.t("agentManager.browser.empty"),
    noSession: language.t("agentManager.browser.noSession"),
    screenshotAlt: language.t("agentManager.browser.screenshotAlt"),
    errors: (count: number) => language.t("agentManager.browser.errors", { count }),
  }))
  const reference = (value: BrowserReference) => {
    post({ type: "appendChatBoxMessage", text: formatBrowserFeedback([value]), browser: value })
  }
  const theme = () =>
    document.body.classList.contains("vscode-light") || document.body.classList.contains("vscode-high-contrast-light")
      ? "light"
      : "dark"
  return (
    <BrowserPanelView
      scope={() => {
        const session = props.sessionId()
        return session ? scope(session, props.projectId()) : undefined
      }}
      transport={transport}
      labels={labels()}
      theme={theme}
      onReference={reference}
      onClose={props.onClose}
    />
  )
}
