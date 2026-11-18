// The Notifications tab renders the four v1 attention settings, writes each one as a `kilo-code.v2.attention.*` editor
// setting, and renders every `settings.notifications.*` string, so none of them is left without a row.
import assert from "node:assert/strict"
import { Window } from "happy-dom"

const window = new Window({ url: "http://localhost" })
// The webview message guard compares the event origin with the window origin, and happy-dom's Window does not
// expose `origin` on its own.
Object.defineProperty(window, "origin", { configurable: true, value: "http://localhost" })
Object.assign(globalThis, {
  window,
  document: window.document,
  navigator: window.navigator,
  Node: window.Node,
  NodeList: window.NodeList,
  NodeFilter: window.NodeFilter,
  HTMLCollection: window.HTMLCollection,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  HTMLDivElement: window.HTMLDivElement,
  HTMLSpanElement: window.HTMLSpanElement,
  HTMLInputElement: window.HTMLInputElement,
  HTMLTextAreaElement: window.HTMLTextAreaElement,
  HTMLButtonElement: window.HTMLButtonElement,
  SVGElement: window.SVGElement,
  Text: window.Text,
  Comment: window.Comment,
  Event: window.Event,
  CustomEvent: window.CustomEvent,
  MouseEvent: window.MouseEvent,
  PointerEvent: window.PointerEvent,
  KeyboardEvent: window.KeyboardEvent,
  MessageEvent: window.MessageEvent,
  MutationObserver: window.MutationObserver,
  ResizeObserver: window.ResizeObserver,
  IntersectionObserver: window.IntersectionObserver,
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  getComputedStyle: window.getComputedStyle.bind(window),
})
const sent: Array<{ type: string; [key: string]: unknown }> = []
Object.assign(globalThis, {
  KILO_OS_NOTIFICATIONS: true,
  acquireVsCodeApi: () => ({
    postMessage: (message: { type: string }) => sent.push(message),
    getState: () => undefined,
    setState: () => undefined,
  }),
})
Object.assign(window, { KILO_OS_NOTIFICATIONS: true })

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const { render } = await import("solid-js/web")
const { VSCodeProvider } = await import("../../webview-ui/src/context/vscode")
const { LanguageProvider } = await import("../../webview-ui/src/context/language")
const { V2Scope } = await import("../../webview-ui/src/v2/client")
const { SettingsConfigProvider } = await import("../../webview-ui/src/v2/settings-config")
const { post } = await import("../../webview-ui/src/utils/webview-message")
const { dict } = await import("../../webview-ui/src/i18n/en")
const { default: Settings } = await import("../../webview-ui/src/components/settings/Settings")

const scope = {
  connection: { status: () => "connected", error: () => undefined },
  report: () => undefined,
  directory: "/settings",
  version: "0.0.0",
  extensionVersion: "0.0.0",
  open: () => undefined,
  data: { location: { config: { list: () => [], sync: async () => undefined } } },
} as never

const settings = {
  connection: () => "connected",
  connectionError: () => undefined,
  version: () => "0.0.0",
  extensionVersion: () => "0.0.0",
  open: () => undefined,
  reload: async () => undefined,
} as never

const root = document.createElement("div")
document.body.append(root)
const dispose = render(
  () => (
    <VSCodeProvider>
      <LanguageProvider>
        <V2Scope value={scope}>
          <SettingsConfigProvider>
            <Settings settings={settings} onLogin={() => undefined} tab="aboutKiloCode" />
          </SettingsConfigProvider>
        </V2Scope>
      </LanguageProvider>
    </VSCodeProvider>
  ),
  root,
)
await wait(50)

const text = (key: keyof typeof dict) => dict[key]
const row = (key: keyof typeof dict) =>
  [...root.querySelectorAll<HTMLElement>('[data-slot="settings-row"]')].find(
    (element) => element.getAttribute("data-search-label") === text(key),
  )
const toggle = async (key: keyof typeof dict) => {
  const input = row(key)?.querySelector<HTMLInputElement>('[data-slot="switch-input"]')
  assert.ok(input, `${key} has a switch`)
  input.click()
  await wait(10)
}
const button = (label: string, scope: ParentNode = root) =>
  [...scope.querySelectorAll<HTMLButtonElement>("button")].find((element) => element.textContent?.trim() === label)
const writes = () =>
  sent.filter((message) => message.type === "updateVSCodeSettings").map((message) => message.values)
const seen = new Set<string>()
const record = () => {
  const content = root.textContent ?? ""
  for (const [key, value] of Object.entries(dict))
    if (key.startsWith("settings.notifications.") && content.includes(value)) seen.add(key)
}

// Settings search finds the tab's rows and opens the tab on the row, so the tab is a ready tab of the v2 rail.
const search = root.querySelector<HTMLInputElement>('[data-component="settings-search"] input')!
search.value = "os notifications"
search.dispatchEvent(new Event("input", { bubbles: true }))
await wait(50)
const result = [...root.querySelectorAll<HTMLElement>('[data-slot="settings-search-result"]')].find((element) =>
  element.textContent?.includes(text("settings.notifications.os.title")),
)
assert.ok(result, "search lists the OS notification row")
result.click()
await wait(50)
const trigger = root.querySelector<HTMLElement>('[data-slot="tabs-trigger"][aria-selected="true"]')
assert.equal(trigger?.textContent?.trim(), text("settings.notifications.title"), "the result opens the Notifications tab")

// Everything starts off: the sound picker only shows once sounds are on, and the OS test only once OS alerts are on.
assert.ok(row("settings.notifications.enable.title"), "the sound switch renders")
assert.ok(row("settings.notifications.os.title"), "the OS switch renders where the platform supports it")
assert.ok(row("settings.notifications.workbench.title"), "the VS Code notification switch renders")
assert.equal(row("settings.notifications.sounds"), undefined, "the sound picker waits for sounds to be enabled")
for (const key of [
  "settings.notifications.enable.title",
  "settings.notifications.os.title",
  "settings.notifications.workbench.title",
] as const)
  assert.equal(
    row(key)?.querySelector<HTMLInputElement>('[data-slot="switch-input"]')?.checked,
    false,
    `${key} starts off`,
  )
record()

await toggle("settings.notifications.enable.title")
await toggle("settings.notifications.workbench.title")
await toggle("settings.notifications.os.title")
assert.deepEqual(writes(), [
  { "attention.enabled": true },
  { "attention.notifications": true },
  { "attention.OSNotifications": true },
])

const sounds = row("settings.notifications.sounds")
assert.ok(sounds, "the sound picker shows once sounds are on")
assert.ok(sounds.textContent?.includes(text("settings.notifications.sound.default")), "the default sound is selected")
button(text("settings.notifications.testSound"), sounds)!.click()
assert.deepEqual(sent.at(-1), { type: "attentionTestSound", sound: "default" })

// A value the host loaded from the editor settings, such as one set in settings.json, selects that sound.
post({ type: "vscodeSettingsLoaded", values: { "attention.enabled": true, "attention.sound": "nope-07" } })
await wait(10)
assert.ok(row("settings.notifications.sounds")?.textContent?.includes("Nope 07"), "a loaded sound is selected")
button(text("settings.notifications.testSound"), row("settings.notifications.sounds")!)!.click()
assert.deepEqual(sent.at(-1), { type: "attentionTestSound", sound: "nope-07" })
post({ type: "vscodeSettingsLoaded", values: { "attention.enabled": true, "attention.OSNotifications": true } })
await wait(10)

const os = row("settings.notifications.os.title")!
button(text("settings.notifications.testOS"), os)!.click()
await wait(10)
assert.deepEqual(sent.at(-1), { type: "attentionTestOS" })
record()
post({ type: "attentionTestOSResult", ok: true })
await wait(10)
record()
post({ type: "attentionTestOSResult", ok: false, error: "osascript failed" })
await wait(10)
assert.ok(os.textContent?.includes(`${text("settings.notifications.testOS.error")}: osascript failed`))
record()
post({ type: "vscodeSettingsLoaded", values: { "attention.enabled": true, "attention.sound": "system" } })
await wait(10)
record()

const keys = Object.keys(dict).filter((key) => key.startsWith("settings.notifications."))
const missing = keys.filter((key) => !seen.has(key))
assert.deepEqual(missing, [], "every settings.notifications.* string renders in the tab")

dispose()
root.remove()
await window.happyDOM.close()
