import assert from "node:assert/strict"
import { Window } from "happy-dom"

const window = new Window({ url: "http://localhost" })
Object.assign(globalThis, {
  window,
  document: window.document,
  navigator: window.navigator,
  Node: window.Node,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  HTMLHeadElement: window.HTMLHeadElement,
  HTMLButtonElement: window.HTMLButtonElement,
  SVGElement: window.SVGElement,
  MutationObserver: window.MutationObserver,
  Event: window.Event,
  MouseEvent: window.MouseEvent,
  getComputedStyle: window.getComputedStyle.bind(window),
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
})
Object.assign(window, { KILO_SETTINGS: { "chat.sendWhileRunning": "steer" } })

const { render } = await import("solid-js/web")
const { LanguageContext } = await import("../../webview-ui/src/context/language")
const { resolveTemplate } = await import("../../webview-ui/src/context/language-utils")
const { dict } = await import("../../webview-ui/src/i18n/en")
const { SendHint } = await import("../../webview-ui/src/v2/send-hint")
const { clickModifier } = await import("../../webview-ui/src/v2/send-hint-text")
const { applyKiloSettings } = await import("../../webview-ui/src/v2/kilo-settings")

const language = {
  locale: () => "en" as const,
  setLocale: () => undefined,
  userOverride: () => "" as const,
  t: (key: string, params?: Record<string, string | number | boolean | undefined>) =>
    resolveTemplate((dict as Record<string, string>)[key] ?? key, params),
}

const root = document.createElement("div")
document.body.append(root)

render(
  () => (
    <LanguageContext.Provider value={language}>
      <SendHint title="Send all to chat" keybind="⌘Enter" forceOpen>
        <button>Send all to chat</button>
      </SendHint>
    </LanguageContext.Provider>
  ),
  root,
)

const click = `${clickModifier()}+click`
const rows = () =>
  [...document.querySelectorAll("[data-slot=tooltip-keybind]")].map((row) =>
    [...row.querySelectorAll("span")].map((span) => span.textContent),
  )
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

await tick()
assert.deepEqual(rows(), [
  ["Send all to chat", "⌘Enter"],
  ["Queue for after this turn", click],
])

// The hint follows the setting: with Enter queueing, the Option-click steers.
applyKiloSettings({ "chat.sendWhileRunning": "queue" })
await tick()
assert.deepEqual(rows(), [
  ["Send all to chat", "⌘Enter"],
  ["Steer this turn", click],
])
