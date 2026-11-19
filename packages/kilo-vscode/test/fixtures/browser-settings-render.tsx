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

// The tab's other rows read the live config and the VS Code settings; the browser section posts its own requests and
// reads the project's saved grants through the client, which this fake answers like the server.
const saved = [
  { id: "psv_1", projectID: "prj_preview", action: "browser", resource: "read:http://127.0.0.2:48251" },
  { id: "psv_2", projectID: "prj_preview", action: "shell", resource: "git *" },
  { id: "psv_3", projectID: "prj_preview", action: "browser", resource: "act:http://127.0.0.2:48251" },
].map((row) => ({ ...row, time: { created: 0, updated: 0 } }))
const removed: string[] = []
const listed: (string | undefined)[] = []
const scope = {
  connection: { status: () => "connected" },
  report: () => undefined,
  directory: "/preview",
  open: () => undefined,
  api: {
    location: {
      get: async (input: { location: { directory: string } }) => ({
        directory: input.location.directory,
        project: { id: "prj_preview", directory: "/preview", canonical: "/preview" },
      }),
    },
    permission: {
      saved: {
        list: async (input: { projectID?: string }) => {
          listed.push(input.projectID)
          return saved.filter((row) => !removed.includes(row.id))
        },
        remove: async (input: { id: string }) => void removed.push(input.id),
      },
    },
  },
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
    status: { playwright: { ready: false }, extension: { state: "none" } },
  },
  window,
)
await wait(10)
assert.ok(text().includes("Chromium is missing"), "a false status shows the missing-browser line")
assert.equal(radios()[2]?.checked, true, "the stored backend is the checked radio")
const extension = (where: HTMLElement) => where.querySelector('[data-slot="browser-extension-status"]')
assert.equal(extension(root)?.textContent, "Off", "the off backend is the extension row's state")
assert.equal(
  [...root.querySelectorAll("*")].filter((node) => node.childElementCount === 0 && node.textContent?.trim() === "Backend")
    .length,
  1,
  "Backend is named once, as the section header",
)
// The chat's grants for this workspace's project are listed under Site permissions, browser grants only.
assert.deepEqual(listed, ["prj_preview"], "the saved grants are read for the panel's project")
const grants = () =>
  [...root.querySelectorAll('[data-slot="browser-saved-grant"]')].map(
    (node) => `${node.textContent} ${node.nextElementSibling?.textContent}`,
  )
assert.deepEqual(grants(), ["http://127.0.0.2:48251 Read", "http://127.0.0.2:48251 Act"], "each saved grant is a row")
root.querySelector<HTMLButtonElement>('button[aria-label="Revoke"]')?.click()
await wait(10)
assert.deepEqual(removed, ["psv_1"], "revoke removes that saved grant")
assert.deepEqual(grants(), ["http://127.0.0.2:48251 Act"], "the list is read again after a revoke")

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
assert.ok(button(second, "Retry"), "the error state offers a retry")
// The live status refresh keeps running; its success must not take the config read's retry away.
await wait(2_200)
const refresh = posted.filter((message) => message.type === "browserSettingsStatus").at(-1)
assert.ok(refresh, "the status refresh runs while the config read has failed")
post(
  {
    type: "browserSettingsLoaded",
    requestId: refresh?.requestId,
    status: { playwright: { ready: true, target: "chrome" }, extension: { state: "waiting" } },
  },
  window,
)
await wait(10)
assert.ok(secondText().includes("Waiting for the browser extension"), "the refreshed status fills the rows")
const retry = button(second, "Retry")
assert.ok(retry, "the failed config read keeps its retry after a status refresh")
const before = reads().length
retry.click()
await wait(10)
assert.equal(reads().length, before + 1, "the retry reads again")
post(
  {
    type: "browserSettingsLoaded",
    requestId: reads().at(-1)?.requestId,
    state: { backend: "playwright", observation: "diff", allowSensitive: false, rules: [], allowAll: false },
    status: {
      playwright: { ready: true, target: "chrome" },
      extension: { state: "connected", browser: "Chrome", profile: "Work" },
    },
  },
  window,
)
await wait(10)
assert.equal(extension(second)?.textContent, "Connected · Chrome (Work)", "the retried read fills the rows")

// The status rows follow the machine while the tab is open: a refresh asks for the status alone.
const statuses = () => posted.filter((message) => message.type === "browserSettingsStatus")
const polled = statuses().length
await wait(2_200)
assert.ok(statuses().length > polled, "the open tab asks for the status again on its own")
post(
  {
    type: "browserSettingsLoaded",
    requestId: statuses().at(-1)?.requestId,
    status: { playwright: { ready: true, target: "chrome" }, extension: { state: "waiting" } },
  },
  window,
)
await wait(10)
assert.equal(
  extension(second)?.textContent,
  "Waiting for the browser extension",
  "a hub with no extension is waiting, not connected",
)
// Coming back to the tab reads at once.
const before2 = statuses().length
document.dispatchEvent(new Event("visibilitychange"))
await wait(10)
assert.equal(statuses().length, before2 + 1, "a visible tab reads the status at once")
post(
  {
    type: "browserSettingsLoaded",
    requestId: statuses().at(-1)?.requestId,
    status: { playwright: { ready: true, target: "chrome" }, extension: { state: "none" } },
  },
  window,
)
await wait(10)
assert.equal(extension(second)?.textContent, "Not connected", "no hub is not connected")
assert.ok(!secondText().includes("Browser status unavailable"), "the error state clears with the reply")

disposeSecond()
second.remove()
await window.happyDOM.close()
