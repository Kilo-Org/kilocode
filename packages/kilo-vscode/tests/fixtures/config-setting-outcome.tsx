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
const { ConfigProvider, useConfig, settleBound } = await import("../../webview-ui/src/context/config")
// The bound cases shorten this so they prove the settle without a ten-second wait; every
// other case keeps the real bound.
const realBound = settleBound.ms
const { post } = await import("../../webview-ui/src/utils/webview-message")

interface ProbeError {
  message: string
  details?: string
}

/** The same union `SaveError` exports: a host-worded message, or a key to translate. */
type ProbeSaveError = ProbeError | { key: string; params?: Record<string, string | number>; details?: string }

/** The slice of the config context these assertions drive. */
interface ConfigProbe {
  settings: () => Record<string, unknown>
  saveError: () => ProbeSaveError | null
  isDirty: () => boolean
  updateSetting: (key: string, value: unknown) => void
  applySetting: (key: string, value: unknown, writeKey?: string) => void
  saveConfig: () => void
}

const settle = async () => {
  await Promise.resolve()
  await window.happyDOM.waitUntilComplete()
}

/**
 * Wait until `ready` holds, returning whether it did before `timeout` ms elapsed. The bound
 * cases shorten the settle bound, so they observe the settle when it lands instead of
 * guessing how long a loaded runner needs for it.
 */
const until = async (ready: () => boolean, timeout: number) => {
  const deadline = Date.now() + timeout
  while (!ready()) {
    if (Date.now() > deadline) return false
    const { promise, resolve } = Promise.withResolvers<void>()
    setTimeout(resolve, 20)
    await promise
  }
  return true
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
/**
 * A posted write without its generated id. The id differs every run, so the exact-shape
 * assertions below describe only the key and value each call was written for.
 */
const stripWriteId = (message: WebviewMessage) => {
  const copy: Record<string, unknown> = { ...message }
  delete copy.writeId
  return copy
}
const written = () => writes().map(stripWriteId)
const lastWrite = () => {
  const write = writes().at(-1)
  assert.ok(write, "Expected a posted updateSetting message")
  return stripWriteId(write)
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
    assert.deepEqual(written().slice(-2), [
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

  await check("an older success then a newer failure settles on the stored value", async () => {
    const key = "agentManager.browser.openLinksIn"
    const property = "agentManagerBrowserOpenLinksIn"
    assert.equal(probe().settings()[property], "external", "the chain starts from the previously stored value")
    probe().applySetting(property, "integrated", key)
    probe().applySetting(property, "external", key)
    await settle()
    assert.equal(probe().settings()[property], "external", "the display holds the newer intent")
    post({ type: "settingUpdated", key, value: "integrated" })
    await settle()
    assert.equal(
      probe().settings()[property],
      "external",
      "the older acknowledgement waits while a newer write is in flight",
    )
    post({ type: "settingUpdateFailed", key, message: "rejected" })
    await settle()
    assert.equal(
      probe().settings()[property],
      "integrated",
      "the settle adopts the value the older write stored, not the newer intent",
    )
    assert.deepEqual(probe().saveError(), { message: "rejected", details: undefined })
    post({ type: "settingUpdated", key, value: "external" })
    await settle()
    assert.equal(
      probe().settings()[property],
      "external",
      "the settled key applies a later message as an unsolicited host value",
    )
  })

  await check("a newer failure then an older success settles on the stored value", async () => {
    const key = "agentManager.worktreePool"
    probe().applySetting(key, true)
    post({ type: "settingUpdated", key, value: true })
    await settle()
    assert.equal(probe().settings()[key], true, "the chain starts from a stored true")
    probe().applySetting(key, false)
    probe().applySetting(key, true)
    await settle()
    assert.equal(probe().settings()[key], true, "the display holds the newer intent")
    post({ type: "settingUpdateFailed", key, message: "rejected newer" })
    await settle()
    assert.equal(probe().settings()[key], true, "the newer failure leaves the chain pending")
    assert.deepEqual(probe().saveError(), { message: "rejected newer", details: undefined })
    post({ type: "settingUpdated", key, value: false })
    await settle()
    assert.equal(probe().settings()[key], false, "the older write's stored value wins over the value before the chain")
    post({ type: "settingUpdated", key, value: "host-direct" })
    await settle()
    assert.equal(probe().settings()[key], "host-direct", "the settled key applies a later message as unsolicited")
  })

  await check("two failed writes return to the value before the older write", async () => {
    const key = "experimental.browserAutomation"
    probe().applySetting("browserAutomation", false, key)
    post({ type: "settingUpdated", key, value: false })
    await settle()
    assert.equal(probe().settings().browserAutomation, false, "the chain starts from a stored false")
    probe().applySetting("browserAutomation", true, key)
    probe().applySetting("browserAutomation", false, key)
    await settle()
    assert.equal(probe().settings().browserAutomation, false, "the display holds the newer intent")
    post({ type: "settingUpdateFailed", key, message: "rejected older" })
    await settle()
    assert.equal(probe().settings().browserAutomation, false, "the older failure leaves the chain pending")
    post({ type: "settingUpdateFailed", key, message: "rejected newer" })
    await settle()
    assert.equal(
      probe().settings().browserAutomation,
      false,
      "the display returns to the value before the older write, not the intermediate true",
    )
    assert.deepEqual(probe().saveError(), { message: "rejected newer", details: undefined })
  })

  await check("two failures of the same value return to the value before the first write", async () => {
    const key = "experimental.claudeMigration"
    const property = "claudeMigration"
    assert.equal(probe().settings()[property], undefined, "the key starts with no stored value")
    probe().applySetting(property, true, key)
    post({ type: "settingUpdated", key, value: false })
    await settle()
    assert.equal(probe().settings()[property], false, "the chain starts from a stored false")
    probe().applySetting(property, true, key)
    probe().applySetting(property, true, key)
    await settle()
    assert.equal(probe().settings()[property], true, "the display holds the newest intent")
    post({ type: "settingUpdateFailed", key, message: "rejected first" })
    await settle()
    assert.equal(probe().settings()[property], true, "the first failure leaves the chain pending")
    post({ type: "settingUpdateFailed", key, message: "rejected second" })
    await settle()
    assert.equal(
      probe().settings()[property],
      false,
      "the display returns to the value before the first write, not the intermediate true",
    )
    assert.deepEqual(probe().saveError(), { message: "rejected second", details: undefined })
  })

  await check("a confirmed undefined is adopted instead of the value before the chain", async () => {
    const key = "experimental.conversationPromptHistory"
    const property = "conversationPromptHistory"
    probe().applySetting(property, "alpha", key)
    post({ type: "settingUpdated", key, value: "alpha" })
    await settle()
    assert.equal(probe().settings()[property], "alpha", "the chain starts from a stored value")
    // The older write clears the setting, so the host confirms `undefined`, which a sentinel
    // meaning "nothing confirmed" could not tell apart from a real confirmation.
    probe().applySetting(property, undefined, key)
    probe().applySetting(property, "gamma", key)
    await settle()
    assert.equal(probe().settings()[property], "gamma", "the display holds the newer intent")
    post({ type: "settingUpdated", key, value: undefined })
    await settle()
    assert.equal(probe().settings()[property], "gamma", "the older acknowledgement waits")
    post({ type: "settingUpdateFailed", key, message: "rejected" })
    await settle()
    assert.equal(probe().settings()[property], undefined, "the confirmed undefined is adopted")
    assert.equal(
      Object.hasOwn(probe().settings(), property),
      false,
      "adopting undefined deletes the property instead of restoring the value before the chain",
    )
    assert.deepEqual(probe().saveError(), { message: "rejected", details: undefined })
  })

  await check("a stored value for a write this context did not send adds no property", async () => {
    // The control that keeps its own state (here `fontSize`) posts `updateSetting` itself,
    // so this answer reaches the context with no chain behind it. It must not become a
    // property of `settings()`, where nobody reads it and `discardConfig` would keep it.
    post({ type: "settingUpdated", key: "fontSize", value: 15 })
    await settle()
    assert.equal(
      Object.hasOwn(probe().settings(), "fontSize"),
      false,
      "the control keeps its own state, so the context gains no wire-key-named property",
    )
  })

  await check("a chain the host never answers settles at the bound", async () => {
    const key = "experimental.claudeMigration"
    const property = "claudeMigration"
    // The chain starts from a stored true, so sealing it on the value the host holds is
    // observable as a return to true rather than to anything the writes left behind.
    probe().applySetting(property, true, key)
    post({ type: "settingUpdated", key, value: true })
    await settle()
    const before = probe().settings()[property]
    assert.equal(before, true, "the chain starts from a stored true")
    settleBound.ms = 800
    try {
      probe().applySetting(property, false, key)
      await Promise.resolve()
      assert.equal(probe().settings()[property], false, "the display holds the optimistic value")
      const settled = await until(() => probe().saveError() != null, 5800)
      assert.ok(settled, "the chain settles within the bound")
    } finally {
      settleBound.ms = realBound
    }
    assert.equal(probe().settings()[property], before, "the chain settles on the value the host holds")
    assert.deepEqual(
      probe().saveError(),
      { key: "settings.saveBar.unconfirmedWrite", params: { name: property } },
      "an unanswered write names the setting it wrote, not the raw configuration key",
    )
  })

  await check("a write after an unanswered chain restores its own previous value", async () => {
    const key = "experimental.claudeMigration"
    const property = "claudeMigration"
    probe().applySetting(property, true, key)
    post({ type: "settingUpdated", key, value: true })
    await settle()
    const first = probe().settings()[property]
    assert.equal(first, true, "the chain starts from a stored true")
    settleBound.ms = 800
    try {
      probe().applySetting(property, false, key)
      await Promise.resolve()
      const settled = await until(() => probe().saveError() != null, 5800)
      assert.ok(settled, "the unanswered chain settles within the bound")
      assert.equal(probe().settings()[property], first, "the unanswered chain returns to the stored value")
      // A value different from `first`, so a rejection that restores nothing is visible.
      probe().applySetting(property, false, key)
      await Promise.resolve()
      post({ type: "settingUpdateFailed", key, message: "rejected after bound" })
      await settle()
    } finally {
      settleBound.ms = realBound
    }
    assert.equal(probe().settings()[property], first, "the new chain restores the value before its own write")
    assert.deepEqual(probe().saveError(), { message: "rejected after bound", details: undefined })
  })

  await check("a stored value does not overwrite a newer draft edit", async () => {
    const key = "agentManager.worktreePool"
    probe().applySetting(key, true)
    await Promise.resolve()
    // The user edits the same control again before the answer arrives.
    probe().updateSetting(key, false)
    await Promise.resolve()
    assert.equal(probe().settings()[key], false, "the display holds the newer edit")
    post({ type: "settingUpdated", key, value: true })
    await settle()
    assert.equal(probe().settings()[key], false, "the stored value does not replace the newer edit")
    assert.equal(probe().isDirty(), true, "the newer edit stays pending")
  })
  await check("a rejected write is told apart from a later write with the same value", async () => {
    const key = "agentManager.browser.openLinksIn"
    const property = "agentManagerBrowserOpenLinksIn"
    const base = writes().length
    // The middle write is rejected and the answers arrive out of issue order. The settle must
    // land on the value of the last write the host stored, which is the newest one.
    probe().applySetting(property, "external", key)
    probe().applySetting(property, "integrated", key)
    probe().applySetting(property, "integrated", key)
    await settle()
    const ids = writes()
      .slice(base)
      .map((write) => write.writeId)
    assert.equal(ids.length, 3, "three writes were posted")
    post({ type: "settingUpdateFailed", key, writeId: ids[1], message: "rejected middle" })
    await settle()
    post({ type: "settingUpdated", key, value: "integrated", writeId: ids[2] })
    await settle()
    post({ type: "settingUpdated", key, value: "external", writeId: ids[0] })
    await settle()
    // The host applied the third write last, so that value is what it holds; a value-only
    // match would settle on the rejected write's value instead.
    assert.equal(
      probe().settings()[property],
      "integrated",
      "the control shows the value of the last write the host stored",
    )
    assert.deepEqual(probe().saveError(), { message: "rejected middle", details: undefined })
  })
} finally {
  dispose()
}

if (failures.length > 0) console.error(failures.join("\n"))
process.exit(failures.length === 0 ? 0 : 1)
