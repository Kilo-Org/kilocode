import { For, Show, createEffect, createMemo, createSignal, onCleanup, type Accessor, type Setter } from "solid-js"
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
import { browserScopeKey, browserScopeParts, evictBrowserScopes, rememberBrowserScope } from "./browser-panel-cache"

export function createBrowserPanel(
  current: Accessor<SidePanel | null>,
  panel: Setter<SidePanel | null>,
  history: Setter<boolean>,
  review: Setter<boolean>,
  sessions: Accessor<{ id: string }[]>,
) {
  const [enabled, configure] = createSignal(
    (globalThis as typeof globalThis & { KILO_BROWSER_AUTOMATION?: boolean }).KILO_BROWSER_AUTOMATION === true,
  )
  const [cached, setCached] = createSignal(false)
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
      <Show when={enabled()}>
        <BrowserPanelCache
          active={visible}
          sessionId={session}
          projectId={project}
          sessions={sessions}
          onClose={close}
          onChange={setCached}
        />
      </Show>
    ),
    hasCache: cached,
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
  if (command.type === "back") return { type: "agentManager.browser.back", ...command.scope }
  if (command.type === "forward") return { type: "agentManager.browser.forward", ...command.scope }
  if (command.type === "close") return { type: "agentManager.browser.close", ...command.scope }
  if (command.type === "state") return { type: "agentManager.browser.state", ...command.scope }
  if (command.type === "devtools") {
    return { type: "agentManager.browser.devtools", ...command.scope, theme: command.theme }
  }
  if (command.type === "input") {
    return { type: "agentManager.browser.input", ...command.scope, ...command.position, click: command.click }
  }
  if (command.type === "viewport") {
    return {
      type: "agentManager.browser.viewport",
      ...command.scope,
      browserId: command.browserId,
      navigation: command.navigation,
      viewport: command.viewport,
    }
  }
  if (command.type === "interact") {
    return { type: "agentManager.browser.interact", ...command.scope, identity: command.identity, event: command.event }
  }
  if (command.type === "acknowledge") {
    return {
      type: "agentManager.browser.acknowledge",
      ...command.scope,
      identity: command.identity,
      sequence: command.sequence,
    }
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
  if (message.type === "agentManager.browserFrame") {
    return { type: "frame", value: { ...message, scope: scope(message.sessionId, message.projectId) } }
  }
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
      missing: message.missing,
      frameError: message.frameError,
      back: message.back,
      forward: message.forward,
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
    back: language.t("agentManager.browser.back"),
    forward: language.t("agentManager.browser.forward"),
    close: language.t("agentManager.browser.close"),
    inspect: language.t("agentManager.browser.inspect"),
    devtoolsTitle: language.t("agentManager.browser.devtoolsTitle"),
    diagnostics: language.t("agentManager.browser.diagnostics"),
    diagnosticsHint: language.t("agentManager.browser.diagnosticsHint"),
    empty: language.t("agentManager.browser.empty"),
    requirement: language.t("agentManager.browser.requirement"),
    missingTitle: language.t("agentManager.browser.missingTitle"),
    missingChrome: language.t("agentManager.browser.missingChrome"),
    missingChromium: language.t("agentManager.browser.missingChromium"),
    download: language.t("agentManager.browser.downloadChrome"),
    retry: language.t("common.retry"),
    settings: language.t("agentManager.browser.settings"),
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
      download={() => vscode.postMessage({ type: "openExternal", url: "https://www.google.com/chrome/" })}
      settings={() => vscode.postMessage({ type: "openSettingsPanel", tab: "browser", projectId: props.projectId() })}
      onReference={reference}
      onClose={props.onClose}
    />
  )
}

/**
 * Keeps one browser panel alive per scope so switching to another worktree,
 * project, or session and back does not reload the page in the iframe. Only the
 * active scope is visible; the rest stay mounted but hidden.
 *
 * Eviction only drops the webview preview. The backend browser belongs to its
 * session or project, so it is closed by the panel close action, session
 * deletion, or project close, not by cache eviction.
 */
function BrowserPanelCache(props: {
  active: Accessor<boolean>
  sessionId: Accessor<string | undefined>
  projectId: Accessor<string | undefined>
  sessions: Accessor<{ id: string }[]>
  onClose: () => void
  onChange: (value: boolean) => void
}) {
  const [entries, setEntries] = createSignal<string[]>([])
  const current = () => {
    const session = props.sessionId()
    return session ? browserScopeKey(props.projectId(), session) : undefined
  }
  const list = createMemo(() => {
    const entry = props.active() ? current() : undefined
    return entry ? rememberBrowserScope(entries(), entry) : entries()
  })
  createEffect(() => {
    const entry = props.active() ? current() : undefined
    if (!entry) return
    setEntries((prev) => rememberBrowserScope(prev, entry))
  })
  createEffect(() => {
    const known = new Set(props.sessions().map((item) => item.id))
    setEntries((prev) => evictBrowserScopes(prev, known, props.projectId(), current()))
  })
  createEffect(() => props.onChange(list().length > 0))
  onCleanup(() => props.onChange(false))
  return (
    <>
      <For each={list()}>
        {(entry) => {
          const parts = browserScopeParts(entry)
          const shown = createMemo(() => props.active() && current() === entry)
          return (
            <div class="am-browser-cache" classList={{ "am-browser-cache-active": shown() }} inert={!shown()}>
              <BrowserAdapter
                sessionId={() => parts.session}
                projectId={() => (parts.project === "single" ? undefined : parts.project)}
                onClose={() => {
                  setEntries((prev) => prev.filter((item) => item !== entry))
                  props.onClose()
                }}
              />
            </div>
          )
        }}
      </For>
      <Show when={props.active() && !props.sessionId()}>
        <div class="am-browser-cache am-browser-cache-active">
          <BrowserAdapter sessionId={() => undefined} projectId={props.projectId} onClose={props.onClose} />
        </div>
      </Show>
    </>
  )
}
