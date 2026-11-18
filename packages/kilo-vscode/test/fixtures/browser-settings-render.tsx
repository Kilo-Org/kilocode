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

/** A button by its visible label, so the assertions name what the user presses. */
const button = (where: HTMLElement, label: string) =>
  [...where.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent?.trim() === label)

// An install the host cannot start answers with the load message, not the installed one; the attempt must still end.
const install = button(root, "Install")
assert.ok(install, "a missing browser offers the install")
install.click()
await wait(10)
const installing = request("browserSettingsInstall")
assert.ok(installing, "the click asks the host to install")
assert.equal(button(root, "Install"), undefined, "the button shows the install is running")
post({ type: "browserSettingsLoaded", requestId: installing?.requestId, error: "the download failed" }, window)
await wait(10)
const again = button(root, "Install")
assert.ok(again, "a failed install ends the attempt")
assert.equal(again?.disabled, false, "the install can be tried again")
assert.ok(text().includes("the download failed"), "the install failure is shown")

dispose()
root.remove()

// A first read that fails must not leave the status rows claiming to be loading, and it offers a retry.
const second = document.createElement("div")
document.body.append(second)
const secondText = () => second.textContent ?? ""
const disposeSecond = render(
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
  second,
)
await wait(50)
const reads = () => posted.filter((message) => message.type === "browserSettingsRead")
const first = reads().at(-1)
post({ type: "browserSettingsLoaded", requestId: first?.requestId, error: "the config is unreadable" }, window)
await wait(10)
assert.ok(secondText().includes("Browser status unavailable"), "a failed first read shows an error state")
assert.ok(!secondText().includes("Loading"), "neither status row is left loading")
const retry = button(second, "Retry")
assert.ok(retry, "the error state offers a retry")
const before = reads().length
retry.click()
await wait(10)
assert.equal(reads().length, before + 1, "the retry reads again")
post(
  {
    type: "browserSettingsLoaded",
    requestId: reads().at(-1)?.requestId,
    state: { backend: "playwright", observation: "diff", allowSensitive: false, rules: [], allowAll: false },
    status: { playwright: { ready: true, target: "chrome" }, extension: { connected: true } },
  },
  window,
)
await wait(10)
assert.ok(secondText().includes("Connected"), "the retried read fills the rows")
assert.ok(!secondText().includes("Browser status unavailable"), "the error state clears with the reply")

disposeSecond()
second.remove()
await window.happyDOM.close()
