import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { Window } from "happy-dom"
import { AnnotationStore } from "../../src/kilo-provider/annotation-store"
import { createAnnotationHandler } from "../../src/kilo-provider/annotations"
import type { AnnotationReply, AnnotationRequest } from "../../src/shared/annotations"
import type { WebviewMessage } from "../../webview-ui/src/types/messages"
import { post } from "../../webview-ui/src/utils/webview-message"

const window = new Window({ url: "http://localhost" })
Object.defineProperty(window, "origin", { value: window.location.origin })
const storage = await mkdtemp(path.join(tmpdir(), "kilo-prompt-annotations-"))
const store = new AnnotationStore(storage)
const sent: WebviewMessage[] = []
const replies: AnnotationReply[] = []
const errors: unknown[] = []
window.addEventListener("error", (event) => errors.push(event.error))
const handler = createAnnotationHandler({
  storage: () => storage,
  post: (message) => {
    replies.push(message)
    post(message)
  },
})
let hashes = 0
const digest = crypto.subtle.digest.bind(crypto.subtle)
crypto.subtle.digest = (algorithm, data) => {
  hashes++
  return digest(algorithm, data)
}
let gate: ReturnType<typeof Promise.withResolvers<void>> | undefined
Object.assign(globalThis, {
  window,
  document: window.document,
  navigator: window.navigator,
  localStorage: window.localStorage,
  Node: window.Node,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  HTMLHeadElement: window.HTMLHeadElement,
  HTMLInputElement: window.HTMLInputElement,
  HTMLTextAreaElement: window.HTMLTextAreaElement,
  DOMRect: window.DOMRect,
  SVGElement: window.SVGElement,
  MutationObserver: window.MutationObserver,
  ResizeObserver: window.ResizeObserver,
  IntersectionObserver: window.IntersectionObserver,
  CustomEvent: window.CustomEvent,
  Event: window.Event,
  MessageEvent: window.MessageEvent,
  customElements: window.customElements,
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  getComputedStyle: window.getComputedStyle.bind(window),
  acquireVsCodeApi: () => ({
    getState: () => undefined,
    setState: () => {},
    postMessage: (message: WebviewMessage) => {
      sent.push(message)
      if (message.type !== "annotationRequest") return
      if (!gate) {
        handler.handle(message)
        return
      }
      void gate.promise.then(() => handler.handle(message))
    },
  }),
})

const { render } = await import("solid-js/web")
const { Show, createSignal } = await import("solid-js")
const { VSCodeProvider } = await import("../../webview-ui/src/context/vscode")
const { ServerProvider } = await import("../../webview-ui/src/context/server")
const { ProviderProvider } = await import("../../webview-ui/src/context/provider")
const { ConfigContext } = await import("../../webview-ui/src/context/config")
const { LanguageContext } = await import("../../webview-ui/src/context/language")
const { NotificationsProvider } = await import("../../webview-ui/src/context/notifications")
const { SessionProvider, useSession } = await import("../../webview-ui/src/context/session")
const { IndexingProvider } = await import("../../webview-ui/src/context/indexing")
const { MemoryProvider } = await import("../../webview-ui/src/context/memory")
const { SpeechToTextModelsProvider } = await import("../../webview-ui/src/context/speech-to-text-models")
const { PromptInput } = await import("../../webview-ui/src/components/chat/PromptInput")
const { AnnotationSourceMarkers } = await import("../../webview-ui/src/components/chat/AnnotationMarkers")
const { ResponseLensBoundary } = await import("../../webview-ui/src/components/chat/ResponseLens")
const { Toast } = await import("@kilocode/kilo-ui/toast")
const { drafts, reviewDrafts, annotationDrafts, annotationEditorDrafts, savePromptDraft } = await import(
  "../../webview-ui/src/utils/draft-store"
)
const { newAnnotation } = await import("../../webview-ui/src/utils/annotations")
const { captureAnnotationAnchor, resolveAnnotationAnchor } = await import(
  "../../webview-ui/src/utils/annotation-anchors"
)
const config = {
  config: () => ({}),
  globalConfig: () => ({}),
  globalDraft: () => ({}),
  projectConfig: () => ({}),
  collections: () => ({}),
  settings: () => ({}),
  features: () => ({ indexing: false, sandboxControls: false, backgroundSubagents: false }),
  loading: () => false,
  isDirty: () => false,
  saving: () => false,
  saveError: () => null,
  updateConfig: () => {},
  updateGlobalConfig: () => {},
  updateProjectConfig: () => {},
  updateSetting: () => {},
  applySetting: () => {},
  saveConfig: () => {},
  discardConfig: () => {},
}
const language = { locale: () => "en", setLocale: () => {}, userOverride: () => "", t: (key: string) => key }
const [mounted, setMounted] = createSignal(true)
const [markers, setMarkers] = createSignal(true)
const [broken, setBroken] = createSignal(false)
let session!: ReturnType<typeof useSession>
const transcript = document.createElement("div")
transcript.dataset.transcriptRoot = ""
document.body.append(transcript)
const Probe = () => {
  session = useSession()
  return (
    <>
      <Toast.Region />
      <Show when={markers()}>
        <ResponseLensBoundary>
          <AnnotationSourceMarkers transcript={() => transcript} sessionID={session.currentSessionID} />
        </ResponseLensBoundary>
      </Show>
      <Show when={mounted()}>
        <IndexingProvider>
          <MemoryProvider>
            <SpeechToTextModelsProvider>
              <PromptInput
                boxId="markers"
                transcript={() => {
                  if (broken()) throw new Error("injected selection view failure")
                  return transcript
                }}
              />
            </SpeechToTextModelsProvider>
          </MemoryProvider>
        </IndexingProvider>
      </Show>
    </>
  )
}
const host = document.createElement("div")
document.body.append(host)
const dispose = render(
  () => (
    <VSCodeProvider>
      <ServerProvider>
        <ProviderProvider>
          <ConfigContext.Provider value={config as never}>
            <LanguageContext.Provider value={language as never}>
              <NotificationsProvider>
                <SessionProvider>
                  <Probe />
                </SessionProvider>
              </NotificationsProvider>
            </LanguageContext.Provider>
          </ConfigContext.Provider>
        </ProviderProvider>
      </ServerProvider>
    </VSCodeProvider>
  ),
  host,
)

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))
const until = async (predicate: () => boolean, label = "condition") => {
  for (let index = 0; index < 200; index++) {
    if (predicate()) return
    await settle()
  }
  assert(
    predicate(),
    `${label} did not settle: ${sent
      .slice(-8)
      .map((message) => message.type)
      .join(", ")} / ${document.body.textContent}`,
  )
}
const key = (id: string) => `markers:session:${id}`
const prompt = () => host.querySelector<HTMLTextAreaElement>("textarea.prompt-input")!
const editor = () => document.querySelector<HTMLTextAreaElement>('[data-component="annotation-popover"] textarea')!
const sends = () => sent.filter((message) => message.type === "sendMessage")
const save = () => {
  const button = Array.from(
    document.querySelectorAll<HTMLButtonElement>('[data-component="annotation-popover"] button'),
  ).find((button) => button.textContent?.trim() === "common.save")
  assert(button)
  button.click()
}
const send = () => host.querySelector<HTMLButtonElement>('[aria-label="prompt.action.send"]')!.click()
const seed = async (id: string, comment: string) => {
  setMounted(false)
  await settle()
  session.setCurrentSessionID(id)
  session.setSessionAgent(id, "code")
  session.setSessionModel(id, "kilo", "test")
  transcript.dataset.session = id
  post({ type: "sessionStatus", sessionID: id, status: "idle" })
  savePromptDraft(key(id), "keep prompt text", [], [])
  const note = newAnnotation({ sessionID: id, messageID: "msg_a", selectedText: "source selection", comment: "" })
  annotationEditorDrafts.set(key(id), { annotation: note, comment })
  setMounted(true)
  await until(() => !!editor(), `editor ${id}`)
  assert.equal(session.selected(id)?.modelID, "test")
  return note
}

try {
  await settle()
  post({ type: "ready", serverInfo: { port: 1 } })
  post({ type: "agentsLoaded", agents: [{ name: "code" }], defaultAgent: "code" })
  post({
    type: "providersLoaded",
    ready: true,
    providers: { kilo: { id: "kilo", name: "Kilo", models: { test: { id: "test", name: "Test" } } } },
    connected: ["kilo"],
    defaults: { kilo: "test" },
    defaultSelection: { providerID: "kilo", modelID: "test" },
    authMethods: {},
    authStates: {},
  })
  await settle()

  {
    // The production wrapper must survive the undefined-session/undefined-records startup state.
    assert.equal(session.currentSessionID(), undefined)
    assert.equal(replies.length, 0)
    assert.equal(
      sent.some((message) => message.type === "annotationRequest"),
      false,
    )
    assert.equal(hashes, 0)
    const input = prompt()
    assert(input)
    input.value = "startup draft remains intact"
    input.dispatchEvent(new window.Event("input", { bubbles: true }))
    session.selectAgent("code")
    session.selectModel("kilo", "test")
    const model = session.selected()
    assert.equal(model?.modelID, "test")
    const intact = () => {
      assert.deepEqual(errors, [])
      assert.equal(document.body.textContent?.includes("responseLens.unavailable"), false)
      assert.equal(document.body.textContent?.includes("annotations.storageFailed"), false)
      assert.equal(prompt(), input)
      assert.equal(prompt().value, "startup draft remains intact")
      assert.deepEqual(session.selected(session.currentSessionID()), model)
      assert(host.querySelector(".prompt-input-hint-selectors")?.textContent?.includes("Test"))
      assert.equal(sends().length, 0)
    }
    intact()
    gate = Promise.withResolvers<void>()
    savePromptDraft(key("ses_startup"), input.value, [], [])
    transcript.dataset.session = "ses_startup"
    session.setCurrentSessionID("ses_startup")
    await until(
      () => sent.some((message) => message.type === "annotationRequest" && message.sessionID === "ses_startup"),
      "wrapper record load",
    )
    assert.equal(replies.length, 0)
    assert.equal(hashes, 0)
    intact()
    const startup = gate
    gate = undefined
    startup.resolve()
    await until(
      () =>
        replies.some(
          (message) =>
            message.type === "annotationRecords" && message.sessionID === "ses_startup" && message.items.length === 0,
        ),
      "empty source records",
    )
    await settle()
    assert.equal(hashes, 0)
    intact()

    const startupRow = document.createElement("div")
    startupRow.dataset.row = "assistant"
    startupRow.dataset.session = "ses_startup"
    startupRow.dataset.message = "msg_startup"
    const part = document.createElement("div")
    part.dataset.component = "text-part"
    part.textContent = "A persisted source marker after startup"
    startupRow.append(part)
    transcript.append(startupRow)
    const range = document.createRange()
    range.selectNodeContents(part)
    const anchor = await captureAnnotationAnchor(startupRow, range)
    assert(anchor)
    const checkpoint = hashes
    const rects = Object.getOwnPropertyDescriptor(window.Range.prototype, "getClientRects")
    // Happy DOM supplies DOM and Range behavior but no layout; supply geometry only.
    Object.defineProperty(window.Range.prototype, "getClientRects", {
      configurable: true,
      value: () => [new DOMRect(20, 20, 180, 20)],
    })
    transcript.getBoundingClientRect = () => new DOMRect(0, 0, 400, 300)
    try {
      const request: AnnotationRequest = {
        type: "annotationRequest",
        action: "save",
        requestID: "startup-source-save",
        sessionID: "ses_startup",
        annotation: newAnnotation({
          sessionID: "ses_startup",
          messageID: "msg_startup",
          selectedText: part.textContent,
          comment: "saved after startup",
          anchor,
        }),
      }
      handler.handle(request)
      await until(
        () => document.querySelector(".annotation-marker-badge")?.textContent === "#1",
        "wrapper persisted source marker",
      )
      assert(hashes > checkpoint, "loaded records must reach the actual inner marker renderer")
      intact()
      assert.equal((await store.load("ses_startup")).items[0]?.number, 1)
      session.setCurrentSessionID(undefined)
      await until(() => !document.querySelector(".annotation-marker-badge"), "cleared source session")
      intact()
    } finally {
      if (rects) Object.defineProperty(window.Range.prototype, "getClientRects", rects)
      else Reflect.deleteProperty(window.Range.prototype, "getClientRects")
      Reflect.deleteProperty(transcript, "getBoundingClientRect")
      startupRow.remove()
      setMarkers(false)
      crypto.subtle.digest = digest
    }
  }

  // Save followed immediately by Send waits for the real host write and retains all text.
  const first = await seed("ses_a", "latest unsaved comment")
  gate = Promise.withResolvers<void>()
  const count = sends().length
  save()
  send()
  await settle()
  assert.equal(sends().length, count)
  assert.equal(editor().value, "latest unsaved comment")
  assert.equal(editor().readOnly, true)
  const release = gate
  gate = undefined
  release.resolve()
  await until(() => sends().length > count, "send after save")
  const sentNote = sends().at(-1)!
  assert(sentNote.text.includes("Comment #1 on selected text"))
  assert(sentNote.text.includes("latest unsaved comment"))
  assert(sentNote.text.includes("keep prompt text"))
  assert.equal(prompt().value, "")
  assert.equal(annotationDrafts.has(key("ses_a")), false)
  assert.equal((await store.load("ses_a")).items[0]?.id, first.id)

  // Scope changes while a save is pending preserve the captured draft, never send the newer pane.
  const second = await seed("ses_switch", "captured comment")
  gate = Promise.withResolvers<void>()
  save()
  send()
  const before = sends().length
  savePromptDraft(key("ses_other"), "other pane draft", [], [])
  session.setCurrentSessionID("ses_other")
  session.setSessionAgent("ses_other", "code")
  session.setSessionModel("ses_other", "kilo", "test")
  transcript.dataset.session = "ses_other"
  const row = document.createElement("div")
  row.dataset.row = "assistant"
  row.dataset.session = "ses_other"
  row.dataset.message = "msg_other"
  const part = document.createElement("div")
  part.dataset.component = "text-part"
  const paragraph = document.createElement("p")
  paragraph.textContent = "B source selection"
  part.append(paragraph)
  row.append(part)
  transcript.append(row)
  const select = () => {
    const range = document.createRange()
    range.selectNodeContents(paragraph)
    // Happy DOM has no layout; only the rectangle is supplied, not capture/anchor behavior.
    range.getBoundingClientRect = () => new DOMRect(40, 40, 120, 20)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    document.dispatchEvent(new window.Event("selectionchange"))
  }
  const annotate = () =>
    Array.from(document.querySelectorAll<HTMLButtonElement>(".selection-toolbar button")).find(
      (button) => button.textContent?.trim() === "annotations.annotate",
    )
  await settle()
  select()
  await settle()
  annotate()?.click()
  await settle()
  assert.equal(editor(), null)
  assert.equal(annotationEditorDrafts.has(key("ses_other")), false)
  assert.equal(annotationDrafts.has(key("ses_other")), false)
  assert.equal(prompt().value, "other pane draft")
  assert.equal(sends().length, before)
  const resume = gate
  gate = undefined
  resume.resolve()
  await until(() => !!annotationDrafts.get(key("ses_switch"))?.[0]?.number, "switched saved number")
  await settle()
  assert.equal(sends().length, before)
  assert.equal(prompt().value, "other pane draft")
  assert.equal(drafts.get(key("ses_other")), "other pane draft")
  assert.equal(annotationDrafts.get(key("ses_switch"))?.[0]?.id, second.id)
  assert.equal(annotationDrafts.get(key("ses_switch"))?.[0]?.comment, "captured comment")

  select()
  await until(() => !!annotate(), "B annotate enabled after A save")
  annotate()!.click()
  await until(() => !!annotationEditorDrafts.get(key("ses_other"))?.annotation.anchor, "B captured source anchor")
  const captured = annotationEditorDrafts.get(key("ses_other"))!.annotation
  assert.equal(captured.sessionID, "ses_other")
  assert.equal(captured.messageID, "msg_other")
  assert.equal((await resolveAnnotationAnchor(row, captured.anchor!))?.toString(), "B source selection")
  editor().value = "B comment"
  editor().dispatchEvent(new window.Event("input", { bubbles: true }))
  save()
  await until(() => !editor(), "B anchored save")
  const saved = (await store.load("ses_other")).items[0]!
  assert.equal(saved.number, 1)
  assert.deepEqual(saved.anchor, captured.anchor)
  assert.equal(prompt().value, "other pane draft")
  assert.equal(drafts.get(key("ses_other")), "other pane draft")
  assert.equal(sends().length, before)
  row.remove()

  // Preserve 7.5.16 destination drafts and late-review routing while promoting annotation/editor state.
  setMounted(false)
  await settle()
  const source = "markers:pending:promote"
  const target = key("ses_promoted")
  const review = (id: string) => ({ id, file: "example.ts", line: 1, side: "additions" as const, comment: id })
  session.setCurrentSessionID(undefined)
  session.setDraftSessionID("pending:promote")
  session.setSessionAgent("pending:promote", "code")
  session.setSessionModel("pending:promote", "kilo", "test")
  savePromptDraft(source, "older pending draft", [review("pending-review")], [])
  savePromptDraft(target, "newer destination draft", [review("destination-review")], [])
  annotationDrafts.set(source, [saved])
  annotationEditorDrafts.set(source, { annotation: saved, comment: "promoted unfinished edit" })
  setMounted(true)
  await until(() => !!editor(), "pending annotation editor")
  const queued = sends().length
  post({
    type: "sessionCreated",
    draftID: "pending:promote",
    session: { id: "ses_promoted", title: "Promoted", createdAt: "2026-01-01", updatedAt: "2026-01-01" },
  })
  await settle()
  assert.equal(session.currentSessionID(), "ses_promoted")
  assert.equal(prompt().value, "newer destination draft")
  assert.equal(session.selected("ses_promoted")?.modelID, "test")
  assert.equal(annotationDrafts.get(target)?.[0]?.number, saved.number)
  assert.equal(editor().value, "promoted unfinished edit")
  post({
    type: "appendReviewComments",
    sessionID: "pending:promote",
    comments: [review("late-review")],
    autoSend: true,
  })
  await settle()
  assert.deepEqual(
    reviewDrafts.get(target)?.map((item) => item.id),
    ["pending-review", "destination-review", "late-review"],
  )
  assert.equal(reviewDrafts.has(source), false)
  assert.equal(annotationDrafts.has(source), false)
  assert.equal(sends().length, queued)
  assert.equal(prompt().value, "newer destination draft")
  session.setCurrentSessionID("ses_other")
  await settle()
  post({
    type: "appendReviewComments",
    sessionID: "pending:promote",
    comments: [review("offscreen-review")],
    autoSend: true,
  })
  await settle()
  assert.equal(reviewDrafts.get(target)?.at(-1)?.id, "offscreen-review")
  assert.equal(prompt().value, "other pane draft")
  assert.equal(sends().length, queued)

  // A real corrupt-file failure leaves the editor and pending draft recoverable and blocks Send.
  const failure = await seed("ses_failure", "must survive storage failure")
  const original = await Bun.file(store.file).text()
  await writeFile(store.file, "corrupt storage")
  const failures = sends().length
  save()
  send()
  await until(() => !!editor() && !editor().readOnly, "recoverable editor")
  assert.equal(sends().length, failures)
  assert.equal(editor().value, "must survive storage failure")
  assert.equal(annotationDrafts.get(key("ses_failure"))?.[0]?.id, failure.id)
  assert(document.body.textContent?.includes("annotations.storageFailed"))
  await writeFile(store.file, original)
  save()
  await until(() => !editor(), "retry closes editor")
  assert.equal(annotationDrafts.get(key("ses_failure"))?.[0]?.number, 1)
  assert.equal(
    (await new AnnotationStore(storage).load("ses_failure")).items[0]?.comment,
    "must survive storage failure",
  )

  // A feature-only reactive failure must not unmount the real composer or its model selection.
  const input = prompt()
  const selection = session.selected("ses_failure")
  setBroken(true)
  await settle()
  assert(document.body.textContent?.includes("responseLens.unavailable"))
  assert.equal(prompt(), input)
  assert.equal(prompt().value, "keep prompt text")
  assert.deepEqual(session.selected("ses_failure"), selection)
  assert.equal(annotationDrafts.get(key("ses_failure"))?.[0]?.number, 1)
  send()
  await until(() => sends().length > failures, "ordinary send after feature failure")
  assert(sends().at(-1)!.text.includes("keep prompt text"))
  assert(sends().at(-1)!.text.includes("must survive storage failure"))
  assert.equal(sends().at(-1)!.modelID, "test")
} finally {
  crypto.subtle.digest = digest
  gate?.resolve()
  dispose()
  handler.dispose()
  await window.happyDOM.abort()
  await rm(storage, { recursive: true, force: true })
}
