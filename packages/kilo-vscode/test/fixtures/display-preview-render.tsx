import assert from "node:assert/strict"
import { Window } from "happy-dom"

const window = new Window({ url: "http://localhost" })
Object.assign(globalThis, {
  window,
  document: window.document,
  navigator: window.navigator,
  Node: window.Node,
  NodeList: window.NodeList,
  HTMLCollection: window.HTMLCollection,
  DOMRect: window.DOMRect,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  HTMLDivElement: window.HTMLDivElement,
  HTMLSpanElement: window.HTMLSpanElement,
  HTMLAnchorElement: window.HTMLAnchorElement,
  HTMLImageElement: window.HTMLImageElement,
  HTMLPreElement: window.HTMLPreElement,
  HTMLTextAreaElement: window.HTMLTextAreaElement,
  HTMLSelectElement: window.HTMLSelectElement,
  HTMLTemplateElement: window.HTMLTemplateElement,
  HTMLInputElement: window.HTMLInputElement,
  HTMLButtonElement: window.HTMLButtonElement,
  SVGElement: window.SVGElement,
  DocumentFragment: window.DocumentFragment,
  Text: window.Text,
  Comment: window.Comment,
  NodeFilter: window.NodeFilter,
  MutationObserver: window.MutationObserver,
  ResizeObserver: window.ResizeObserver,
  IntersectionObserver: window.IntersectionObserver,
  Event: window.Event,
  MouseEvent: window.MouseEvent,
  customElements: window.customElements,
  getComputedStyle: window.getComputedStyle.bind(window),
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
})
Object.assign(globalThis, {
  acquireVsCodeApi: () => ({ postMessage: () => undefined, getState: () => undefined, setState: () => undefined }),
})
Object.assign(window, { KILO_SETTINGS: {} })

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const { render } = await import("solid-js/web")
const { DialogProvider } = await import("@kilocode/kilo-ui/context/dialog")
const { VSCodeProvider } = await import("../../webview-ui/src/context/vscode")
const { LanguageProvider } = await import("../../webview-ui/src/context/language")
const { V2Scope } = await import("../../webview-ui/src/v2/client")
const { SettingsConfigProvider } = await import("../../webview-ui/src/v2/settings-config")
const { default: DisplayTab } = await import("../../webview-ui/src/components/settings/DisplayTab")

// The scopes the Display tab reads: the live config list and the opening of a link. The preview itself draws only
// from its fixtures, so the rest stays empty.
const scope = {
  connection: { status: () => "connected" },
  report: () => undefined,
  directory: "/preview",
  open: () => undefined,
  api: { session: { diff: async () => [] } },
  data: { location: { config: { list: () => [], sync: async () => undefined } } },
} as never

const root = document.createElement("div")
document.body.append(root)
const dispose = render(
  () => (
    <DialogProvider>
      <VSCodeProvider>
        <LanguageProvider>
          <V2Scope value={scope}>
            <SettingsConfigProvider>
              <DisplayTab />
            </SettingsConfigProvider>
          </V2Scope>
        </LanguageProvider>
      </VSCodeProvider>
    </DialogProvider>
  ),
  root,
)

const preview = () => root.querySelector<HTMLElement>(".settings-session-preview")!

// The sample streams before the tools run, so the first paint covers the reasoning block.
await wait(300)
assert.ok(preview(), "the Display tab renders the preview")
assert.ok(
  preview().querySelector('[data-component="reasoning-part"]'),
  "the reasoning block renders through the rich content providers",
)

// Give the playback enough painted time to reach its final frame.
await wait(2700)
const tool = (name: string) =>
  preview().querySelector(`[data-component="tool-part-wrapper"][data-part-type="tool"][data-tool="${name}"]`)
for (const name of ["sample_docs_lookup", "edit", "execute", "shell"])
  assert.ok(tool(name), `${name} renders in the preview`)
assert.ok(preview().querySelector('[data-part-type="text"]'), "the answer part renders")

dispose()
root.remove()
await window.happyDOM.close()
