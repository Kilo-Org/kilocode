import { For, Show, createEffect, createMemo, createSignal, onCleanup, type Accessor } from "solid-js"
import { useLanguage } from "../src/context/language"
import { useVSCode } from "../src/context/vscode"
import type { ExtensionMessage, WebviewMessage } from "../src/types/messages/agent-manager"
import { formatBrowserFeedback, type BrowserReference } from "../../src/shared/browser-feedback"
import { BrowserPanel as BrowserPanelView } from "../browser"
import {
  browserCursorEvent,
  browserDevtoolsEvent,
  browserFrameEvent,
  browserInspectionEvent,
  browserLabels,
  browserScope,
  browserStateEvent,
  browserTransport,
} from "../browser"
import type { BrowserCommand, BrowserEvent } from "../browser"
import {
  browserScopeKey,
  browserScopeParts,
  evictBrowserScopes,
  rememberBrowserScope,
  type BrowserScopes,
} from "./browser-panel-cache"

export function createBrowserPanel(input: {
  active: Accessor<boolean>
  open: () => void
  close: () => void
  sessionId: Accessor<string | undefined>
  projectId: Accessor<string | undefined>
  sessions: Accessor<{ id: string }[]>
  onReference: (text: string, sessionId: string) => void
}) {
  const [enabled, configure] = createSignal(
    (globalThis as typeof globalThis & { KILO_BROWSER_AUTOMATION?: boolean }).KILO_BROWSER_AUTOMATION === true,
  )
  const [cached, setCached] = createSignal(false)
  const toggle = () => {
    if (!enabled()) return
    if (input.active()) return input.close()
    input.open()
  }
  return {
    tabs: { browserOpen: input.active, browserAutomation: enabled, onToggleBrowser: toggle },
    bind: () => ({ browser: configure, current: input.sessionId, openBrowser: input.open }),
    render: () => (
      <Show when={enabled()}>
        <BrowserPanelCache
          active={input.active}
          sessionId={input.sessionId}
          projectId={input.projectId}
          sessions={input.sessions}
          onReference={input.onReference}
          onClose={input.close}
          onChange={setCached}
        />
      </Show>
    ),
    hasCache: cached,
  }
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
  if (command.type === "inspect") {
    return {
      type: "agentManager.browser.inspect",
      ...command.scope,
      ...command.position,
      hover: command.hover,
      requestId: command.requestId,
    }
  }
  throw new Error(`Unhandled browser command: ${JSON.stringify(command)}`)
}

function event(message: ExtensionMessage): BrowserEvent | undefined {
  if (message.type === "agentManager.browserCursor") {
    return browserCursorEvent(browserScope(message.sessionId, message.projectId), message)
  }
  if (message.type === "agentManager.browserFrame") {
    return browserFrameEvent(browserScope(message.sessionId, message.projectId), message)
  }
  if (message.type === "agentManager.browserState") {
    return browserStateEvent(browserScope(message.sessionId, message.projectId), message)
  }
  if (message.type === "agentManager.browserInspection") {
    return browserInspectionEvent(browserScope(message.sessionId, message.projectId), message)
  }
  if (message.type !== "agentManager.browserDevtools") return
  return browserDevtoolsEvent(browserScope(message.sessionId, message.projectId), message)
}

function BrowserAdapter(props: {
  sessionId: Accessor<string | undefined>
  projectId: Accessor<string | undefined>
  onReference: (text: string, sessionId: string) => void
  onClose: () => void
}) {
  const language = useLanguage()
  const vscode = useVSCode()
  const transport = browserTransport<WebviewMessage, ExtensionMessage>(
    (message) => vscode.postMessage(message as never),
    vscode.onMessage as unknown as (handler: (message: ExtensionMessage) => void) => () => void,
    command,
    event,
  )
  const labels = createMemo(() => browserLabels(language.t))
  const reference = (value: BrowserReference) =>
    props.onReference(formatBrowserFeedback([value]), value.sessionId)
  const theme = () =>
    document.body.classList.contains("vscode-light") || document.body.classList.contains("vscode-high-contrast-light")
      ? "light"
      : "dark"
  return (
    <BrowserPanelView
      scope={() => {
        const session = props.sessionId()
        return session ? browserScope(session, props.projectId()) : undefined
      }}
      transport={transport}
      labels={labels()}
      theme={theme}
      download={() =>
        vscode.postMessage({ type: "agentManager.openExternal", url: "https://www.google.com/chrome/" } as never)
      }
      settings={() =>
        vscode.postMessage({ type: "openSettingsPanel", tab: "browser", projectId: props.projectId() } as never)
      }
      openExternal={(url) => vscode.postMessage({ type: "agentManager.openExternal", url } as never)}
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
  onReference: (text: string, sessionId: string) => void
  onClose: () => void
  onChange: (value: boolean) => void
}) {
  const [scopes, setScopes] = createSignal<BrowserScopes>({ entries: [], recent: [] })
  const current = () => {
    const session = props.sessionId()
    return session ? browserScopeKey(props.projectId(), session) : undefined
  }
  const list = createMemo(() => {
    const entry = props.active() ? current() : undefined
    return (entry ? rememberBrowserScope(scopes(), entry) : scopes()).entries
  })
  createEffect(() => {
    const entry = props.active() ? current() : undefined
    if (!entry) return
    setScopes((prev) => rememberBrowserScope(prev, entry))
  })
  createEffect(() => {
    const known = new Set(props.sessions().map((item) => item.id))
    setScopes((prev) => evictBrowserScopes(prev, known, props.projectId(), current()))
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
                onReference={props.onReference}
                onClose={() => {
                  setScopes((prev) => ({
                    entries: prev.entries.filter((item) => item !== entry),
                    recent: prev.recent.filter((item) => item !== entry),
                  }))
                  props.onClose()
                }}
              />
            </div>
          )
        }}
      </For>
      <Show when={props.active() && !props.sessionId()}>
        <div class="am-browser-cache am-browser-cache-active">
          <BrowserAdapter
            sessionId={() => undefined}
            projectId={props.projectId}
            onReference={props.onReference}
            onClose={props.onClose}
          />
        </div>
      </Show>
    </>
  )
}
