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
const { ConfigProvider, useConfig, saveBound } = await import("../../webview-ui/src/context/config")
// The bound case shortens this so it proves the settle without a ten-second wait; every other
// case keeps the real bound.
const realBound = saveBound.ms
const { post } = await import("../../webview-ui/src/utils/webview-message")

interface ProbeError {
  message: string
  details?: string
}

/** The same union `SaveError` exports: a host-worded message, or a key to translate. */
type ProbeSaveError = ProbeError | { key: string; params?: Record<string, string | number>; details?: string }

/** The slice of the config context these assertions drive. */
interface ConfigProbe {
  config: () => Record<string, unknown>
  globalConfig: () => Record<string, unknown>
  projectConfig: () => Record<string, unknown>
  isDirty: () => boolean
  saving: () => boolean
  saveError: () => ProbeSaveError | null
  clearSaveError: () => void
  updateConfig: (partial: Record<string, unknown>) => void
  saveConfig: () => void
  discardConfig: () => void
}

const settle = async () => {
  await Promise.resolve()
  await window.happyDOM.waitUntilComplete()
}

/**
 * Wait until `ready` holds, returning whether it did before `timeout` ms elapsed. The bound
 * case shortens the save bound, so it observes the settle when it lands instead of guessing
 * how long a loaded runner needs for it.
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

const features = { indexing: false, sandboxControls: false, backgroundSubagents: false, speechToText: false }
const saves = () => sent.filter((message) => message.type === "updateConfig")
const lastSave = () => {
  const message = saves().at(-1)
  assert.ok(message, "Expected a posted updateConfig message")
  assert.equal(message.type, "updateConfig")
  return message as Extract<WebviewMessage, { type: "updateConfig" }>
}
const failures: string[] = []
let checked = 0
const check = async (step: string, body: () => void | Promise<void>) => {
  checked += 1
  try {
    await body()
    console.log(`RESULT ${JSON.stringify({ step, ok: true })}`)
  } catch (error) {
    failures.push(`${step}: ${(error as Error).message}`)
  }
}

/** The `requestId` of the save the running case is waiting on. */
const current: { id?: string } = {}

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

  await check("saveConfig posts a requestId and keeps the save pending until an answer", async () => {
    const before = saves().length
    probe().updateConfig({ model: "draft-model" })
    await settle()
    assert.equal(probe().isDirty(), true, "the edit is staged before the save")
    probe().saveConfig()
    await settle()
    assert.equal(saves().length, before + 1, "one save posts exactly one updateConfig")
    const message = lastSave()
    assert.equal(typeof message.requestId, "string", "the save names itself so its answer can be told apart")
    assert.ok((message.requestId ?? "").length > 0, "the request id is a non-empty string")
    assert.equal(probe().saving(), true, "the Save button stays disabled until the host answers")
    assert.equal(probe().isDirty(), true, "the draft is not dropped before the host answers")
    current.id = message.requestId
  })

  await check("a foreign configUpdated leaves the pending save and its draft alone", async () => {
    post({ type: "configUpdated", config: { share: "manual" }, features })
    await settle()
    assert.equal(probe().saving(), true, "an answer without a request id cannot be this save's confirmation")
    assert.equal(probe().isDirty(), true, "the draft survives a foreign push")
    assert.equal(probe().config().model, "draft-model", "the drafted edit stays on screen")
    assert.equal(probe().config().share, "manual", "the foreign push still lands its own config")
    assert.equal(probe().saveError(), null, "a foreign push reports no error")
  })

  await check("a configUpdated naming another request leaves the pending save alone", async () => {
    post({
      type: "configUpdated",
      config: { share: "auto" },
      features,
      requestId: `${current.id}-other`,
    })
    await settle()
    assert.equal(probe().saving(), true, "another writer's confirmation cannot settle this save")
    assert.equal(probe().isDirty(), true, "the draft survives another writer's confirmation")
    assert.equal(probe().config().model, "draft-model", "the drafted edit stays on screen")
    assert.equal(probe().saveError(), null, "another writer's confirmation reports no error")
  })

  await check("the configUpdated echoing the save's requestId confirms it and drops the draft", async () => {
    const before = saves().length
    // A setting rejection for a key this context never wrote reports on the save bar without
    // touching the in-flight save, so this case proves the confirmation clears that report.
    post({ type: "settingUpdateFailed", key: "unrelated.write", message: "unrelated failure" })
    await settle()
    assert.deepEqual(probe().saveError(), { message: "unrelated failure", details: undefined })
    assert.equal(probe().saving(), true, "the save is still in flight")
    post({
      type: "configUpdated",
      config: { share: "auto" },
      globalConfig: { share: "auto" },
      projectConfig: { commit_message: { template: "team" } },
      features,
      requestId: current.id,
    })
    await settle()
    assert.equal(probe().saving(), false, "the Save button is enabled again")
    assert.equal(probe().isDirty(), false, "nothing is left unsaved")
    assert.deepEqual(probe().config(), { share: "auto" }, "the server config replaces the confirmed draft")
    assert.deepEqual(probe().globalConfig(), { share: "auto" }, "the global config follows the host")
    assert.deepEqual(
      probe().projectConfig(),
      { commit_message: { template: "team" } },
      "the project config follows the host",
    )
    assert.equal(probe().saveError(), null, "a confirmed save clears the reported error")
    probe().saveConfig()
    await settle()
    assert.equal(saves().length, before, "a confirmed save leaves nothing for the next save to post")
  })

  await check("an edit made while a save is pending survives its confirmation", async () => {
    probe().updateConfig({ model: "pending-edit" })
    await settle()
    probe().saveConfig()
    await settle()
    const id = lastSave().requestId
    assert.equal(probe().saving(), true, "the save is in flight before the answer")
    probe().updateConfig({ share: "while-pending" })
    await settle()
    assert.equal(probe().isDirty(), true, "the second edit is staged")
    post({ type: "configUpdated", config: { model: "pending-edit" }, features, requestId: id })
    await settle()
    assert.equal(probe().saving(), false, "the answer settles the save")
    assert.equal(probe().config().model, "pending-edit", "the saved value shows the host's config")
    assert.equal(probe().config().share, "while-pending", "the edit made after the save stays on screen")
    assert.equal(probe().isDirty(), true, "the edit made after the save is still unsaved")
    assert.equal(probe().saveError(), null, "the confirmation reports no error")
    const before = saves().length
    probe().saveConfig()
    await settle()
    assert.equal(saves().length, before + 1, "the kept edit is what the next save posts")
    assert.deepEqual(lastSave().config, { share: "while-pending" }, "the confirmed value is not posted again")
    probe().discardConfig()
    await settle()
    assert.equal(probe().isDirty(), false, "the discarded edit is gone")
  })

  await check("a configUpdateFailed naming another request leaves the pending save alone", async () => {
    probe().updateConfig({ model: "second-draft" })
    await settle()
    probe().saveConfig()
    await settle()
    current.id = lastSave().requestId
    assert.equal(probe().saving(), true, "the second save is pending")
    post({
      type: "configUpdateFailed",
      message: "another writer failed",
      requestId: `${current.id}-other`,
    })
    await settle()
    assert.equal(probe().saving(), true, "another writer's failure cannot settle this save")
    assert.equal(probe().isDirty(), true, "another writer's failure keeps the draft")
    assert.equal(probe().config().model, "second-draft", "the drafted edit stays on screen")
    assert.equal(probe().saveError(), null, "another writer's failure reports no error")
  })

  await check("a configUpdateFailed echoing the save's requestId settles it and keeps the draft", async () => {
    post({ type: "configUpdateFailed", message: "rejected by the host", requestId: current.id })
    await settle()
    assert.equal(probe().saving(), false, "the rejection ends the pending save")
    assert.equal(probe().isDirty(), true, "the rejected draft stays so it can be retried")
    assert.equal(probe().config().model, "second-draft", "the rejected edit stays on screen")
    assert.deepEqual(probe().saveError(), { message: "rejected by the host", details: undefined })
  })

  await check("a save the host never answers settles at the bound with a translated error", async () => {
    probe().discardConfig()
    await settle()
    assert.equal(probe().isDirty(), false, "the discarded edits are gone")
    try {
      saveBound.ms = 800
      probe().updateConfig({ model: "unanswered" })
      await settle()
      probe().saveConfig()
      assert.equal(probe().saving(), true, "the save is pending before the bound")
      const settled = await until(() => probe().saving() === false, 5_000)
      assert.ok(settled, "the unanswered save settled within the shortened bound")
      assert.equal(probe().isDirty(), true, "the unanswered draft stays so it can be retried")
      assert.equal(probe().config().model, "unanswered", "the unanswered edit stays on screen")
      assert.deepEqual(probe().saveError(), { key: "settings.saveBar.unconfirmedSave" })
      const posted = saves().length
      probe().saveConfig()
      await settle()
      assert.equal(saves().length, posted + 1, "the kept draft is what the retry saves")
    } finally {
      saveBound.ms = realBound
    }
  })

  await check("a configUpdated answering the bound save late confirms it and keeps a later edit", async () => {
    probe().discardConfig()
    await settle()
    assert.equal(probe().isDirty(), false, "the discarded retry is gone")
    try {
      saveBound.ms = 800
      probe().updateConfig({ model: "late-answer" })
      await settle()
      probe().saveConfig()
      await settle()
      const id = lastSave().requestId
      assert.equal(typeof id, "string", "the save names itself so its late answer can be told apart")
      const settled = await until(() => probe().saving() === false, 5_000)
      assert.ok(settled, "the save settled at the bound")
      assert.equal(probe().isDirty(), true, "the unconfirmed draft stays before the answer lands")
      assert.deepEqual(probe().saveError(), { key: "settings.saveBar.unconfirmedSave" })
      probe().updateConfig({ share: "after-bound" })
      await settle()
      post({ type: "configUpdated", config: { model: "late-answer" }, features, requestId: id })
      await settle()
      assert.equal(probe().saving(), false, "the Save button is enabled")
      assert.equal(probe().config().model, "late-answer", "the saved value shows the host's config")
      assert.equal(probe().config().share, "after-bound", "the edit made after the bound stays on screen")
      assert.equal(probe().isDirty(), true, "the edit made after the bound is still unsaved")
      assert.equal(probe().saveError(), null, "the answer resolves the unconfirmed report")
      const posted = saves().length
      probe().saveConfig()
      await settle()
      assert.equal(saves().length, posted + 1, "the kept edit is what the next save posts")
      assert.deepEqual(lastSave().config, { share: "after-bound" }, "the stored value is not posted again")
    } finally {
      saveBound.ms = realBound
    }
  })

  await check("dismissing the bound report leaves the late answer that resolves the save armed", async () => {
    probe().discardConfig()
    await settle()
    assert.equal(probe().isDirty(), false, "the discarded edit is gone")
    try {
      saveBound.ms = 800
      probe().updateConfig({ model: "dismissed" })
      await settle()
      probe().saveConfig()
      await settle()
      const id = lastSave().requestId
      assert.equal(typeof id, "string", "the save names itself so its late answer can be told apart")
      const settled = await until(() => probe().saving() === false, 5_000)
      assert.ok(settled, "the save settled at the bound")
      assert.deepEqual(probe().saveError(), { key: "settings.saveBar.unconfirmedSave" })
      probe().clearSaveError()
      await settle()
      assert.equal(probe().saveError(), null, "the report is dismissed")
      post({ type: "configUpdated", config: { model: "dismissed" }, features, requestId: id })
      await settle()
      assert.equal(probe().saving(), false, "the answer does not restart the save")
      assert.equal(probe().isDirty(), false, "the answer clears the paths the save posted")
      assert.deepEqual(probe().config(), { model: "dismissed" }, "the server config replaces the posted draft")
      assert.equal(probe().saveError(), null, "the dismissed report stays dismissed")
      const posted = saves().length
      probe().saveConfig()
      await settle()
      assert.equal(saves().length, posted, "the stored value is not posted again")
    } finally {
      saveBound.ms = realBound
    }
  })
} finally {
  dispose()
}

if (failures.length > 0) console.error(failures.join("\n"))
// A fixture that reached no case would exit 0 without proving anything.
if (checked !== 10) failures.push(`ran ${checked} of 10 cases`)
process.exit(failures.length === 0 ? 0 : 1)
