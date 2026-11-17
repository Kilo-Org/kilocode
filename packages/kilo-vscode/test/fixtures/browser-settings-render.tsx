import assert from "node:assert/strict"
import { Window } from "happy-dom"

const window = new Window({ url: "http://localhost" })
// The webview's own message guard compares the event origin with the window's; happy-dom's Window leaves `origin`
// undefined, so the fixture names the same origin the page has.
Object.defineProperty(window, "origin", { value: "http://localhost" })
Object.assign(globalThis, {
  window,
  document: window.document,
  navigator: window.navigator,
  Node: window.Node,
  NodeList: window.NodeList,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  HTMLInputElement: window.HTMLInputElement,
  SVGElement: window.SVGElement,
  MutationObserver: window.MutationObserver,
  ResizeObserver: window.ResizeObserver,
  IntersectionObserver: window.IntersectionObserver,
  Event: window.Event,
  MouseEvent: window.MouseEvent,
  MessageEvent: window.MessageEvent,
  getComputedStyle: window.getComputedStyle.bind(window),
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
})

/** Every message the webview posts to the host, so the fixture can answer the request under test. */
const posted: { type: string; requestId?: string; patch?: unknown }[] = []
Object.assign(globalThis, {
  acquireVsCodeApi: () => ({
    postMessage: (message: { type: string; requestId?: string }) => posted.push(message),
    getState: () => undefined,
    setState: () => undefined,
  }),
})
Object.assign(window, { KILO_SETTINGS: {} })

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// Static imports would evaluate these modules before the happy-dom globals above exist, which is what the fixture
// is setting up: the components read `document` and `window` at module load.
const { render } = await import("solid-js/web")
const { DialogProvider } = await import("@kilocode/kilo-ui/context/dialog")
const { VSCodeProvider } = await import("../../webview-ui/src/context/vscode")
const { LanguageProvider } = await import("../../webview-ui/src/context/language")
const { V2Scope } = await import("../../webview-ui/src/v2/client")
const { SettingsConfigProvider } = await import("../../webview-ui/src/v2/settings-config")
const { post } = await import("../../webview-ui/src/utils/webview-message")
const { default: BrowserTab } = await import("../../webview-ui/src/components/settings/BrowserTab")

// The tab's other rows read the live config and the VS Code settings; the browser section only posts its own requests.
const scope = {
  connection: { status: () => "connected" },
  report: () => undefined,
  directory: "/preview",
  open: () => undefined,
  api: {},
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
              <BrowserTab />
            </SettingsConfigProvider>
          </V2Scope>
        </LanguageProvider>
      </VSCodeProvider>
    </DialogProvider>
  ),
  root,
)

const text = () => root.textContent ?? ""
const radios = () => [...root.querySelectorAll<HTMLInputElement>('input[name="kilo-browser-backend"]')]
const request = (type: string) => posted.find((message) => message.type === type)

await wait(50)
assert.equal(radios().length, 3, "the three backends render")
// No reply yet: the panel must not claim the browser is missing before the host answered.
assert.ok(text().includes("Loading"), "the status rows show they are loading before the first reply")
assert.ok(!text().includes("Chromium is missing"), "the missing-browser line waits for the status")

post(
  {
    type: "browserSettingsLoaded",
    requestId: request("browserSettingsRead")?.requestId,
    state: { backend: "off", observation: "diff", allowSensitive: false, rules: [], allowAll: false },
    status: { playwright: { ready: false }, extension: { connected: false } },
  },
  window,
)
await wait(10)
assert.ok(text().includes("Chromium is missing"), "a false status shows the missing-browser line")
assert.equal(radios()[2]?.checked, true, "the stored backend is the checked radio")

// A write shows the chosen backend at once, then a failed reply rolls it back and reports the error.
radios()[0]?.click()
await wait(10)
assert.equal(radios()[0]?.checked, true, "the clicked backend is shown while the write runs")
const write = request("browserSettingsWrite")
assert.deepEqual(write?.patch, { browser: { backend: "playwright" } }, "the write asks the host for the backend")

post({ type: "browserSettingsLoaded", requestId: write?.requestId, error: "the file is read-only" }, window)
await wait(10)
assert.equal(radios()[0]?.checked, false, "a failed write rolls the radio back to the saved backend")
assert.equal(radios()[2]?.checked, true, "the saved backend stays selected")
assert.ok(text().includes("the file is read-only"), "the failure is shown")

dispose()
root.remove()
await window.happyDOM.close()
