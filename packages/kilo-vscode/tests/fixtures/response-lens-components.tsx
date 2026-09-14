import assert from "node:assert/strict"
import { Window } from "happy-dom"
import type { ExplainBrieflyRequest } from "../../src/shared/response-lens"
import type { WebviewMessage } from "../../webview-ui/src/types/messages"

const window = new Window({ url: "http://localhost" })
Object.defineProperty(window, "origin", { value: window.location.origin })
const errors: unknown[] = []
window.addEventListener("error", (event) => errors.push(event.error))
const messages: WebviewMessage[] = []
Object.assign(globalThis, {
  window,
  document: window.document,
  navigator: window.navigator,
  Node: window.Node,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  HTMLHeadElement: window.HTMLHeadElement,
  HTMLButtonElement: window.HTMLButtonElement,
  HTMLInputElement: window.HTMLInputElement,
  HTMLTextAreaElement: window.HTMLTextAreaElement,
  SVGElement: window.SVGElement,
  Event: window.Event,
  InputEvent: window.InputEvent,
  MouseEvent: window.MouseEvent,
  PointerEvent: window.PointerEvent,
  FocusEvent: window.FocusEvent,
  KeyboardEvent: window.KeyboardEvent,
  CustomEvent: window.CustomEvent,
  MessageEvent: window.MessageEvent,
  DOMRect: window.DOMRect,
  MutationObserver: window.MutationObserver,
  IntersectionObserver: window.IntersectionObserver,
  getComputedStyle: window.getComputedStyle.bind(window),
  acquireVsCodeApi: () => ({
    postMessage: (message: WebviewMessage) => messages.push(message),
    getState: () => undefined,
    setState: () => {},
  }),
})
globalThis.requestAnimationFrame = (callback: FrameRequestCallback) =>
  setTimeout(() => callback(Date.now()), 0) as never
globalThis.cancelAnimationFrame = (id) => clearTimeout(id)
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as typeof ResizeObserver
const { createSignal } = await import("solid-js")
const { render } = await import("solid-js/web")
const { ResponseLens } = await import("../../webview-ui/src/components/chat/ResponseLens")
const { AnnotationList } = await import("../../webview-ui/src/components/chat/AnnotationList")
const { newAnnotation } = await import("../../webview-ui/src/utils/annotations")
const { ConfigProvider } = await import("../../webview-ui/src/context/config")
const { VSCodeProvider } = await import("../../webview-ui/src/context/vscode")
const { SessionContext } = await import("../../webview-ui/src/context/session")
const { ProviderContext } = await import("../../webview-ui/src/context/provider")
const { LanguageContext } = await import("../../webview-ui/src/context/language")
const { dict } = await import("../../webview-ui/src/i18n/en")
const { post } = await import("../../webview-ui/src/utils/webview-message")
const settle = () => new Promise((resolve) => setTimeout(resolve, 20))
const language = {
  language: () => "en",
  setLanguage: () => {},
  t: (key: string) => (dict as Record<string, string>)[key] ?? key,
}
const models = ["active", "alternate"].map((id) => ({ id, name: id, providerID: "test", providerName: "Test" }))
const [sessionID, setSessionID] = createSignal("original")
const [active, setActive] = createSignal({ providerID: "test", modelID: "active" })
let selected = ""
let added = 0
const host = document.createElement("div")
const prompt = document.createElement("textarea")
prompt.value = "Untouched prompt draft"
const transcript = document.createElement("div")
transcript.dataset.transcriptRoot = ""
transcript.dataset.session = "original"
const row = document.createElement("div")
row.dataset.row = "assistant"
row.dataset.session = "original"
row.dataset.message = "answer"
const part = document.createElement("div")
part.dataset.component = "text-part"
const paragraph = document.createElement("p")
paragraph.textContent = "Precision measures correct positive predictions."
part.append(paragraph)
row.append(part)
transcript.append(row)
document.body.append(prompt, transcript, host)
const annotation = newAnnotation({
  sessionID: "original",
  messageID: "answer",
  selectedText: "Precision",
  comment: "Retain this annotation",
})
const dispose = render(
  () => (
    <LanguageContext.Provider value={language as never}>
      <VSCodeProvider>
        <ConfigProvider>
          <ProviderContext.Provider
            value={
              {
                connected: () => ["test"],
                models: () => models,
                findModel: (value: { modelID: string } | null) => models.find((model) => model.id === value?.modelID),
              } as never
            }
          >
            <SessionContext.Provider
              value={
                {
                  currentSessionID: sessionID,
                  selected: (id: string) => {
                    assert.equal(id, "original", "explanations resolve only the captured session's model")
                    selected = id
                    return active()
                  },
                  visibleMessages: () => [
                    { id: "user", sessionID: "original", role: "user" },
                    { id: "answer", sessionID: "original", role: "assistant" },
                  ],
                  getParts: (id: string) => [
                    { id, type: "text", text: id === "user" ? "What is precision?" : paragraph.textContent },
                  ],
                  favoriteModels: () => [],
                  modelUsageHistory: () => ({}),
                  recentModels: () => [],
                  selectModel: () => {
                    throw new Error("Explanation must not change the chat model")
                  },
                } as never
              }
            >
              <AnnotationList annotations={[annotation]} onEdit={() => {}} onDelete={() => {}} onClear={() => {}} />
              <ResponseLens
                transcript={() => transcript}
                streamingMessageIDs={() => new Set()}
                disabled={() => false}
                editing={() => false}
                onAdd={() => added++}
                focus={() => prompt}
              />
            </SessionContext.Provider>
          </ProviderContext.Provider>
        </ConfigProvider>
      </VSCodeProvider>
    </LanguageContext.Provider>
  ),
  host,
)
post({
  type: "configLoaded",
  config: {},
  features: { indexing: false, sandboxControls: false, backgroundSubagents: false },
})
const preferences = (value: unknown) =>
  post({ type: "chatSettingsLoaded", settings: { shiftTabCyclesVariant: true, responseLens: value } })
const click = (label: string) => {
  const button = Array.from(document.querySelectorAll("button")).find((item) => item.textContent?.trim() === label)
  assert.ok(button, `Missing button: ${label}`)
  button.click()
}
const capture = () => {
  paragraph.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))
  prompt.focus()
  const range = document.createRange()
  range.selectNodeContents(paragraph)
  Object.defineProperty(range, "getBoundingClientRect", { value: () => new DOMRect(10, 10, 80, 20) })
  window.getSelection()!.removeAllRanges()
  window.getSelection()!.addRange(range)
  document.dispatchEvent(new Event("selectionchange"))
}
const explain = () => {
  capture()
  click("Explain Briefly")
}
const requests = () => messages.filter((message): message is ExplainBrieflyRequest => message.type === "explainBriefly")
const latest = () => requests().at(-1)!
const answer = (id: string, text = "A brief explanation.") =>
  post({
    type: "explainBrieflyResult",
    requestId: id,
    text,
    truncated: false,
    model: { providerID: "test", modelID: "active" },
  })

await settle()
explain()
await settle()
assert.equal(selected, "original", "default model resolves by captured session at click")
assert.ok(latest(), JSON.stringify(messages) + document.body.textContent)
assert.equal(latest().model.modelID, "active")
assert.equal(latest().level, "simple")
assert.match(document.body.textContent ?? "", /Explaining/)
assert.equal(latest().context.length, 2)
assert.ok(
  document.querySelector('[aria-label="Explanation model: Active chat model"]'),
  "reuse model selector with a clear default label",
)
const first = latest().requestId
const opening = requests().length
setActive({ providerID: "test", modelID: "alternate" })
await settle()
assert.ok(messages.some((message) => message.type === "cancelExplainBriefly" && message.requestId === first))
assert.equal(requests().length, opening, "changing the chat model never starts a billed request")
assert.ok(document.querySelector('[data-component="response-lens"]'), "model changes leave Retry available")
answer(first, "STALE_MODEL_A_SENTINEL")
assert.ok(!document.body.textContent?.includes("STALE_MODEL_A_SENTINEL"))
click("Retry explanation")
assert.equal(latest().model.modelID, "alternate", "Retry resolves model B, not the initial model A snapshot")
const second = latest().requestId
answer(first, "STALE_MODEL_A_AFTER_RETRY")
assert.ok(!document.body.textContent?.includes("STALE_MODEL_A_AFTER_RETRY"))
answer(second, "Current model B explanation")
assert.equal(document.querySelector(".response-lens-result")?.textContent, "Current model B explanation")
setActive({ providerID: "test", modelID: "active" })
await settle()
assert.equal(document.querySelector(".response-lens-result"), null, "a completed result is invalidated on model change")
assert.equal(requests().length, opening + 1)
setActive({ providerID: "test", modelID: "alternate" })
click("Close")
await settle()
assert.equal(document.activeElement, prompt)
assert.ok(messages.some((message) => message.type === "cancelExplainBriefly" && message.requestId === first))
answer(first, "STALE_SENTINEL")
assert.equal(document.querySelector('[data-component="response-lens"]'), null)

preferences({ enabled: true, level: "university", model: { providerID: "test", modelID: "active" } })
explain()
await settle()
assert.equal(latest().level, "university")
assert.equal(latest().model.modelID, "active", "saved alternate takes precedence over current chat model")
const override = latest().requestId
const overridden = requests().length
setActive({ providerID: "test", modelID: "active" })
await settle()
assert.ok(!messages.some((message) => message.type === "cancelExplainBriefly" && message.requestId === override))
assert.equal(requests().length, overridden, "an explicit explanation model ignores main-chat model changes")
answer(override, "Explicit alternate remains valid")
assert.equal(document.querySelector(".response-lens-result")?.textContent, "Explicit alternate remains valid")
setActive({ providerID: "test", modelID: "alternate" })
await settle()
assert.equal(document.querySelector(".response-lens-result")?.textContent, "Explicit alternate remains valid")
click("Retry explanation")
assert.equal(latest().model.modelID, "active")
post({ type: "explainBrieflyError", requestId: latest().requestId, error: "Provider unavailable" })
assert.match(document.querySelector('[role="alert"]')?.textContent ?? "", /Provider unavailable/)
const count = requests().length
await settle()
assert.equal(requests().length, count, "errors never auto retry")
click("Reset defaults")
click("Retry explanation")
assert.equal(latest().level, "simple")
assert.equal(latest().model.modelID, "alternate", "reset uses the current model in the captured chat")
assert.ok(messages.some((message) => message.type === "updateSetting" && message.key === "chat.responseLens"))
answer(latest().requestId, "<b>Plain text, not HTML.</b>")
assert.equal(document.querySelector(".response-lens-result")?.textContent, "<b>Plain text, not HTML.</b>")
assert.equal(document.querySelector(".response-lens-result b"), null)
let copied = ""
Object.defineProperty(navigator, "clipboard", {
  configurable: true,
  value: {
    writeText: async (text: string) => {
      copied = text
    },
  },
})
click("Copy")
await settle()
assert.equal(copied, "<b>Plain text, not HTML.</b>")
post({ type: "modelSelectorExpandedLoaded", value: false })
const picker = () => {
  const button = document.querySelector('[aria-label^="Explanation model:"]') as HTMLButtonElement
  assert.ok(button)
  button.click()
}
picker()
await settle()
const search = document.querySelector(".model-selector-search") as HTMLInputElement
assert.ok(search, "the actual shared model picker opens inside the popover")
search.value = "alternate"
search.dispatchEvent(new InputEvent("input", { bubbles: true, data: "alternate" }))
await settle()
search.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }))
await settle()
const saved = () =>
  messages.filter((message) => message.type === "updateSetting" && message.key === "chat.responseLens").at(-1)
assert.deepEqual((saved() as { value: unknown }).value, {
  enabled: true,
  level: "simple",
  model: { providerID: "test", modelID: "alternate" },
})
picker()
await settle()
const clear = document.querySelector(".model-selector-search") as HTMLInputElement
assert.ok(clear)
for (const key of ["ArrowDown", "Home", "Enter"])
  clear.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key }))
await settle()
assert.equal((saved() as { value: { model?: unknown } }).value.model, undefined)
assert.equal(prompt.value, "Untouched prompt draft")
assert.equal(added, 0)
assert.equal(annotation.comment, "Retain this annotation")
window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
await settle()
assert.equal(document.querySelector('[data-component="response-lens"]'), null)
assert.equal(document.activeElement, prompt)

explain()
const before = latest().requestId
const beforeSettings = requests().length
preferences({ enabled: true, level: "school" })
answer(before, "STALE_LEVEL_SENTINEL")
assert.ok(!document.body.textContent?.includes("STALE_LEVEL_SENTINEL"))
assert.equal(requests().length, beforeSettings, "changing settings never silently bills for a new request")
assert.ok(document.querySelector('[data-component="response-lens"]'), "settings changes leave the controls usable")
click("Retry explanation")
const retry = latest().requestId
capture()
assert.ok(
  messages.some((message) => message.type === "cancelExplainBriefly" && message.requestId === retry),
  "a new selection cancels active explanation",
)
click("Explain Briefly")
await settle()
const switched = latest().requestId
setSessionID("other")
await settle()
assert.equal(document.querySelector('[data-component="response-lens"]'), null)
answer(switched, "STALE_SESSION_SENTINEL")
assert.ok(!document.body.textContent?.includes("STALE_SESSION_SENTINEL"))
setSessionID("original")
explain()
await settle()
const disabling = latest().requestId
const toggle = document.querySelector(
  '[data-component="response-lens-settings"] input[type="checkbox"]',
) as HTMLInputElement
assert.ok(toggle, "popover has a real off switch")
toggle.click()
await settle()
assert.equal(document.querySelector('[data-component="response-lens"]'), null)
assert.ok(messages.some((message) => message.type === "cancelExplainBriefly" && message.requestId === disabling))
assert.ok(document.querySelector('[data-component="prompt-annotations"]'), "disabling never hides saved send intent")
assert.equal(annotation.comment, "Retain this annotation")
preferences({ enabled: true, level: "school" })
capture()
click("Annotate")
assert.equal(added, 1)
explain()
const final = latest().requestId
dispose()
assert.ok(
  messages.some((message) => message.type === "cancelExplainBriefly" && message.requestId === final),
  "unmount cancels active work",
)
assert.ok(
  !messages.some((message) =>
    ["sendMessage", "enhancePrompt", "requestTerminalContext", "requestGitChangesContext", "openFile"].includes(
      message.type,
    ),
  ),
)
assert.deepEqual(errors, [], "mounted production components must not throw DOM event errors")
host.remove()
await window.happyDOM.cancelAsync()
await window.happyDOM.close()
