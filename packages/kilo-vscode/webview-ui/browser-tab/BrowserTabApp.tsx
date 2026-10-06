import { Show, createMemo, createSignal, onCleanup, onMount, type Component } from "solid-js"
import { useLanguage } from "../src/context/language"
import { useVSCode } from "../src/context/vscode"
import type { ExtensionMessage } from "../src/types/messages"
import { formatBrowserFeedback, type BrowserReference } from "../../src/shared/browser-feedback"
import { BrowserPanel } from "../browser"
import type { BrowserScope, BrowserTransport } from "../browser"
import { command, event, scope } from "./messages"

export const BrowserTabApp: Component = () => {
  const vscode = useVSCode()
  const language = useLanguage()
  const [session, setSession] = createSignal<string>()
  const [enabled, setEnabled] = createSignal(false)

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
    noSession: language.t("browserTab.noSession"),
    screenshotAlt: language.t("agentManager.browser.screenshotAlt"),
    errors: (count: number) => language.t("agentManager.browser.errors", { count }),
  }))

  const reference = (value: BrowserReference) => {
    const id = session()
    if (!id) return
    vscode.postMessage({ type: "browserTab.reference", sessionId: id, reference: value })
  }

  const theme = () =>
    document.body.classList.contains("vscode-light") || document.body.classList.contains("vscode-high-contrast-light")
      ? "light"
      : "dark"

  onMount(() => {
    const off = vscode.onMessage((message: ExtensionMessage) => {
      if (message.type === "browserTab.scope") {
        setSession(message.sessionId)
        setEnabled(message.browserAutomation)
      }
    })
    vscode.postMessage({ type: "browserTab.ready" })
    onCleanup(off)
  })

  return (
    <Show when={session()} fallback={<div class="am-browser-panel" data-status="closed" />}>
      <Show
        when={enabled()}
        fallback={
          <div class="am-browser-panel" data-status="closed">
            <div class="am-browser-empty">{language.t("browserTab.disabled")}</div>
          </div>
        }
      >
        <BrowserPanel
          scope={() => {
            const id = session()
            return id ? scope(id) : undefined
          }}
          transport={transport}
          labels={labels()}
          theme={theme}
          download={() =>
            vscode.postMessage({ type: "browserTab.openExternal", url: "https://www.google.com/chrome/" })
          }
          settings={() => vscode.postMessage({ type: "browserTab.openSettings" })}
          onReference={reference}
          onClose={() => undefined}
        />
      </Show>
    </Show>
  )
}
