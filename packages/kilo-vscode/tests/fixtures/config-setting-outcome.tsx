import assert from "node:assert/strict"
import { Window } from "happy-dom"
import type { WebviewMessage } from "../../webview-ui/src/types/messages"

const sent: WebviewMessage[] = []
const window = new Window({ url: "http://localhost" })
Object.defineProperty(window, "origin", { value: window.location.origin })
const api = {
  postMessage: (message: WebviewMessage) => {
    sent.push(message)
  },
  getState: () => undefined,
  setState: () => {},
}

Object.assign(globalThis, {
  window,
  document: window.document,
  navigator: window.navigator,
  localStorage: window.localStorage,
  Node: window.Node,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  HTMLDivElement: window.HTMLDivElement,
  HTMLInputElement: window.HTMLInputElement,
  HTMLTextAreaElement: window.HTMLTextAreaElement,
  HTMLButtonElement: window.HTMLButtonElement,
  SVGElement: window.SVGElement,
  ShadowRoot: window.ShadowRoot,
  customElements: window.customElements,
  CSSStyleSheet: window.CSSStyleSheet,
  MutationObserver: window.MutationObserver,
  IntersectionObserver: window.IntersectionObserver,
  ResizeObserver: window.ResizeObserver,
  CustomEvent: window.CustomEvent,
  Event: window.Event,
  MouseEvent: window.MouseEvent,
  MessageEvent: window.MessageEvent,
  PointerEvent: window.PointerEvent,
  getComputedStyle: window.getComputedStyle.bind(window),
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  acquireVsCodeApi: () => api,
})

// The providers read browser globals at module scope, so they load after the stubs above.
const { render } = await import("solid-js/web")
const { VSCodeProvider } = await import("../../webview-ui/src/context/vscode")
const { ConfigProvider, useConfig } = await import("../../webview-ui/src/context/config")
const { post } = await import("../../webview-ui/src/utils/webview-message")

interface ProbeError {
  message: string
  details?: string
}

/** The slice of the config context these assertions drive. */
interface ConfigProbe {
  settings: () => Record<string, unknown>
  saveError: () => ProbeError | null
  isDirty: () => boolean
  updateSetting: (key: string, value: unknown) => void
  applySetting: (key: string, value: unknown, writeKey?: string) => void
  saveConfig: () => void
}

const settle = async () => {
  await Promise.resolve()
  await window.happyDOM.waitUntilComplete()
}

const ui: { value?: ConfigProbe } = {}
const probe = () => {
  if (!ui.value) throw new Error("the config probe has not rendered")
  return ui.value
}

/** Hands the real config context back here so the assertions drive the shipping code. */
const Probe = () => {
  ui.value = useConfig()
  return null
}

const writes = () => sent.filter((message) => message.type === "updateSetting")
const lastWrite = () => {
  const write = writes().at(-1)
  assert.ok(write, "Expected a posted updateSetting message")
  return write
}

const failures: string[] = []
const check = async (step: string, body: () => void | Promise<void>) => {
  try {
    await body()
    console.log(`RESULT ${JSON.stringify({ step, ok: true })}`)
  } catch (error) {
    failures.push(`${step}: ${(error as Error).message}`)
  }
}

const host = document.createElement("div")
document.body.append(host)
const dispose = render(
  () => (
    <VSCodeProvider>
      <ConfigProvider>
        <Probe />
      </ConfigProvider>
    </VSCodeProvider>
  ),
  host,
)

try {
  await settle()
  post({ type: "extensionDataReady" })
  await settle()

  await check("applySetting posts the write key and adopts the host value", async () => {
    probe().applySetting("agentManagerBrowserOpenLinksIn", "external", "agentManager.browser.openLinksIn")
    await settle()
    assert.deepEqual(lastWrite(), {
      type: "updateSetting",
      key: "agentManager.browser.openLinksIn",
      value: "external",
    })
    post({ type: "settingUpdated", key: "agentManager.browser.openLinksIn", value: "external" })
    await settle()
    assert.equal(probe().settings().agentManagerBrowserOpenLinksIn, "external")
    assert.equal(probe().saveError(), null)
  })

  await check("settingUpdateFailed restores the previous value and reports the error", async () => {
    probe().applySetting("agentManagerBrowserOpenLinksIn", "integrated", "agentManager.browser.openLinksIn")
    await settle()
    assert.equal(probe().settings().agentManagerBrowserOpenLinksIn, "integrated")
    post({
      type: "settingUpdateFailed",
      key: "agentManager.browser.openLinksIn",
      message: "agentManager.browser.openLinksIn is invalid",
      details: "detail line",
    })
    await settle()
    assert.equal(probe().settings().agentManagerBrowserOpenLinksIn, "external")
    assert.deepEqual(probe().saveError(), {
      message: "agentManager.browser.openLinksIn is invalid",
      details: "detail line",
    })
  })

  await check("settingUpdated with a different value makes settings follow the host", async () => {
    const key = "agentManager.worktreePool"
    probe().applySetting(key, true)
    await settle()
    assert.deepEqual(lastWrite(), { type: "updateSetting", key, value: true })
    post({ type: "settingUpdated", key, value: true })
    await settle()
    assert.equal(probe().settings()[key], true)
    probe().applySetting(key, false)
    await settle()
    assert.equal(probe().settings()[key], false)
    post({ type: "settingUpdated", key, value: true })
    await settle()
    assert.equal(probe().settings()[key], true)
    assert.equal(probe().saveError(), null)
  })

  await check("an older acknowledgement does not replace a newer intent", async () => {
    const key = "agentManager.browser.useSystemChrome"
    probe().applySetting(key, false)
    probe().applySetting(key, true)
    await settle()
    assert.deepEqual(writes().slice(-2), [
      { type: "updateSetting", key, value: false },
      { type: "updateSetting", key, value: true },
    ])
    assert.equal(probe().settings()[key], true)
    post({ type: "settingUpdated", key, value: false })
    await settle()
    assert.equal(probe().settings()[key], true, "the older stored value must not replace the newer intent")
    post({ type: "settingUpdated", key, value: true })
    await settle()
    assert.equal(probe().settings()[key], true, "the display ends on the newest value")
    assert.equal(probe().saveError(), null)
  })

  await check("a rejection of the newer write restores the value before it", async () => {
    const key = "experimental.browserAutomation"
    probe().applySetting("browserAutomation", false, key)
    post({ type: "settingUpdated", key, value: false })
    await settle()
    assert.equal(probe().settings().browserAutomation, false)
    probe().applySetting("browserAutomation", true, key)
    probe().applySetting("browserAutomation", false, key)
    await settle()
    assert.equal(probe().settings().browserAutomation, false)
    post({ type: "settingUpdated", key, value: true })
    await settle()
    assert.equal(probe().settings().browserAutomation, false, "the older acknowledgement leaves the newer intent")
    post({ type: "settingUpdateFailed", key, message: "rejected" })
    await settle()
    assert.equal(probe().settings().browserAutomation, true, "the newer rejection restores the value before it")
    assert.deepEqual(probe().saveError(), { message: "rejected", details: undefined })
  })

  await check("a failed saveConfig settings write restores the value it replaced", async () => {
    probe().updateSetting("showShortcutHints", true)
    await settle()
    assert.equal(probe().isDirty(), true)
    probe().saveConfig()
    await settle()
    assert.deepEqual(lastWrite(), { type: "updateSetting", key: "showShortcutHints", value: true })
    assert.equal(probe().isDirty(), false)
    post({ type: "settingUpdateFailed", key: "showShortcutHints", message: "rejected" })
    await settle()
    assert.equal(probe().settings().showShortcutHints, undefined)
    assert.deepEqual(probe().saveError(), { message: "rejected", details: undefined })
  })
} finally {
  dispose()
}

if (failures.length > 0) console.error(failures.join("\n"))
process.exit(failures.length === 0 ? 0 : 1)
