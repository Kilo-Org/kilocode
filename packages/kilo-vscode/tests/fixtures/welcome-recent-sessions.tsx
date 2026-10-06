import assert from "node:assert/strict"
import { Window } from "happy-dom"
import type { SessionInfo } from "../../webview-ui/src/types/messages"

const window = new Window({ url: "https://kilo.test" })
Object.defineProperty(window, "origin", { value: window.location.origin })
Object.assign(globalThis, {
  window,
  document: window.document,
  navigator: window.navigator,
  Node: window.Node,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  HTMLButtonElement: window.HTMLButtonElement,
  HTMLHeadElement: window.HTMLHeadElement,
  SVGElement: window.SVGElement,
  CustomEvent: window.CustomEvent,
  MouseEvent: window.MouseEvent,
  Event: window.Event,
  MutationObserver: window.MutationObserver,
  ResizeObserver: window.ResizeObserver,
  IntersectionObserver: window.IntersectionObserver,
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  getComputedStyle: window.getComputedStyle.bind(window),
  acquireVsCodeApi: () => ({
    postMessage: () => {},
    getState: () => undefined,
    setState: () => {},
  }),
})

const { render } = await import("solid-js/web")
const { DialogProvider } = await import("@kilocode/kilo-ui/context/dialog")
const { LanguageContext } = await import("../../webview-ui/src/context/language")
const { SessionContext } = await import("../../webview-ui/src/context/session")
const { WelcomeEmptyState } = await import("../../webview-ui/src/components/chat/WelcomeEmptyState")

const info = (id: string, title: string, updatedAt: string): SessionInfo => ({
  id,
  title,
  parentID: null,
  createdAt: updatedAt,
  updatedAt,
})

const shared = [info("shared", "Shared session", "2026-08-03T10:00:00.000Z")]
const scoped = [info("scoped", "Scoped session", "2026-08-02T10:00:00.000Z")]
const store = { sessions: () => shared }
const language = { t: (key: string) => key }

const root = document.createElement("div")
document.body.append(root)
const titles = () => [...root.querySelectorAll(".recent-session-title")].map((node) => node.textContent)

const show = (props: { sessions?: () => SessionInfo[] }) =>
  render(
    () => (
      <DialogProvider>
        <LanguageContext.Provider value={language as never}>
          <SessionContext.Provider value={store as never}>
            <WelcomeEmptyState sessions={props.sessions} onSelectSession={() => {}} />
          </SessionContext.Provider>
        </LanguageContext.Provider>
      </DialogProvider>
    ),
    root,
  )

const scopedView = show({ sessions: () => scoped })
await window.happyDOM.waitUntilComplete()
assert.deepEqual(titles(), ["Scoped session"], "the scoped sessions accessor was not consumed")

scopedView()
const defaultView = show({})
await window.happyDOM.waitUntilComplete()
assert.deepEqual(titles(), ["Shared session"], "the sidebar default did not read the shared store")

defaultView()
