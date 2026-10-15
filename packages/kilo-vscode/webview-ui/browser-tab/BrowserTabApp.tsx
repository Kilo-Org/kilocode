import { Show, createMemo, createSignal, onCleanup, onMount, type Component } from "solid-js"
import { useLanguage } from "../src/context/language"
import { useVSCode } from "../src/context/vscode"
import type { ExtensionMessage } from "../src/types/messages"
import { formatBrowserFeedback, type BrowserReference } from "../../src/shared/browser-feedback"
import { BrowserPanel, browserLabels, browserScope, browserTransport } from "../browser"
import { command, event } from "./messages"

export const BrowserTabApp: Component = () => {
  const vscode = useVSCode()
  const language = useLanguage()
  const [session, setSession] = createSignal<string>()
  const [enabled, setEnabled] = createSignal(false)

  const transport = browserTransport((message) => vscode.postMessage(message), vscode.onMessage, command, event)

  const labels = createMemo(() => browserLabels(language.t, "browserTab.noSession"))

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
            return id ? browserScope(id) : undefined
          }}
          transport={transport}
          labels={labels()}
          theme={theme}
          download={() =>
            vscode.postMessage({ type: "browserTab.openExternal", url: "https://www.google.com/chrome/" })
          }
          settings={() => vscode.postMessage({ type: "browserTab.openSettings" })}
          openExternal={(url) => vscode.postMessage({ type: "browserTab.openExternal", url })}
          onReference={reference}
          onClose={() => undefined}
        />
      </Show>
    </Show>
  )
}
