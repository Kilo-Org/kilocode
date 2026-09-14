import assert from "node:assert/strict"
import { Window } from "happy-dom"
import type { Annotation } from "../../webview-ui/src/utils/annotations"

const window = new Window({ url: "http://localhost" })
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
  DOMRect: window.DOMRect,
  MutationObserver: window.MutationObserver,
  getComputedStyle: window.getComputedStyle.bind(window),
})
globalThis.requestAnimationFrame = (callback: FrameRequestCallback) =>
  setTimeout(() => callback(Date.now()), 0) as never
globalThis.cancelAnimationFrame = (id: number) => clearTimeout(id)
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as typeof ResizeObserver

const { createSignal } = await import("solid-js")
const { render } = await import("solid-js/web")
const { Toast } = await import("@kilocode/kilo-ui/toast")
const { AnnotationEditorHost } = await import("../../webview-ui/src/components/chat/AnnotationPopover")
const { AnnotationList } = await import("../../webview-ui/src/components/chat/AnnotationList")
const { SelectionToolbar } = await import("../../webview-ui/src/components/chat/SelectionToolbar")
const { LanguageContext } = await import("../../webview-ui/src/context/language")
const {
  annotationFocusTarget,
  commitAnnotationEditor,
  createAnnotationEditorDraftState,
  openAnnotationEditor,
  updateAnnotationEditor,
} = await import("../../webview-ui/src/utils/annotation-state")
const { newAnnotation } = await import("../../webview-ui/src/utils/annotations")

const translations: Record<string, string> = {
  "annotations.annotate": "Annotate",
  "annotations.commentLabel": "Annotation comment",
  "annotations.commentPlaceholder": "Add a comment",
  "annotations.hint": "Enter to save",
  "annotations.pendingCount": "Annotations (1)",
  "annotations.selectedText": "Selected assistant text",
  "annotations.toggleHint": "Toggle annotations",
  "annotations.toolbarLabel": "Selected text actions",
  "annotations.copyFailed": "Copy failed visibly",
  "responseLens.explain": "Explain Briefly",
  "common.cancel": "Cancel",
  "common.copy": "Copy",
  "common.delete": "Delete",
  "common.edit": "Edit",
  "common.requestFailed": "Request failed",
  "common.save": "Save",
}
const language = {
  language: () => "en",
  setLanguage: () => {},
  t: (key: string) => translations[key] ?? key,
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 10))

async function editorLifecycle() {
  const host = document.createElement("div")
  document.body.append(host)
  const drafts = new Map()
  const initial = newAnnotation({
    sessionID: "session-1",
    messageID: "message-full-019f123456789abcdef0",
    selectedText: "selected assistant text",
    comment: "existing comment",
    now: 1,
  })
  let switchDraft!: (key: string) => void
  let saved!: () => Annotation[]
  let open!: (annotation: Annotation) => void
  let lock!: (value: boolean) => void
  const Harness = () => {
    const [key, setKey] = createSignal("draft-a")
    const [items, setItems] = createSignal([initial])
    const [disabled, setDisabled] = createSignal(false)
    lock = setDisabled
    switchDraft = setKey
    saved = items
    const editor = createAnnotationEditorDraftState({
      key,
      drafts,
      rect: () => new DOMRect(20, 20, 40, 10),
    })
    let primary: HTMLElement | undefined
    let fallback: HTMLElement | undefined
    const restore = () => requestAnimationFrame(() => annotationFocusTarget(primary, fallback)?.focus())
    open = (annotation) => editor.replace(openAnnotationEditor(annotation, new DOMRect(20, 20, 40, 10)))
    return (
      <>
        <AnnotationList
          annotations={items()}
          editingID={editor.editor()?.annotation.id}
          onEdit={(annotation, rect, trigger, count) => {
            primary = trigger
            fallback = count
            editor.replace(openAnnotationEditor(annotation, rect))
          }}
          onDelete={() => {}}
          onClear={() => {}}
        />
        <AnnotationEditorHost
          editor={editor.editor}
          disabled={disabled()}
          onCommentChange={(id, comment) => editor.replace(updateAnnotationEditor(editor.editor(), id, comment))}
          onSave={(focus) => {
            const result = commitAnnotationEditor(editor.editor(), items(), 2)
            if (result.status !== "committed") return false
            setItems(result.annotations)
            editor.replace(undefined)
            if (focus) restore()
            return true
          }}
          onCancel={(focus) => {
            editor.replace(undefined)
            if (focus) restore()
          }}
          onDelete={() => editor.replace(undefined)}
        />
      </>
    )
  }
  const dispose = render(
    () => (
      <LanguageContext.Provider value={language as never}>
        <Harness />
      </LanguageContext.Provider>
    ),
    host,
  )

  await settle()
  const count = host.querySelector("[aria-controls]") as HTMLButtonElement
  const list = host.querySelector(".prompt-annotations-list") as HTMLElement
  count.focus()
  assert.equal(list.hidden, true, "focusing the count must not open the list")
  count.click()
  assert.equal(list.hidden, false)
  const edit = host.querySelector('[aria-label="Edit"]') as HTMLButtonElement
  edit.click()
  await settle()
  assert.equal(list.hidden, true, "opening an existing editor should hide the pending list")
  host.querySelector(".prompt-annotations")!.dispatchEvent(new MouseEvent("mouseenter", { bubbles: false }))
  assert.equal(list.hidden, true, "hovering the count while editing must not reveal the list")
  const textarea = document.querySelector("textarea") as HTMLTextAreaElement
  const trigger = document.querySelector('[data-slot="popover-trigger"]') as HTMLElement
  assert.ok(textarea)
  assert.match(document.querySelector("label")?.textContent ?? "", /Annotation comment/)
  assert.equal(trigger.tabIndex, -1)
  assert.equal(trigger.getAttribute("aria-hidden"), "true")

  textarea.value = "latest controlled comment"
  textarea.setSelectionRange(8, 8)
  textarea.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "t" }))
  await settle()
  assert.equal(document.querySelector("textarea"), textarea, "same-id typing must not remount the textarea")
  assert.equal(textarea.selectionStart, 8, "controlled updates must preserve the caret")

  const composing = new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
  Object.defineProperty(composing, "isComposing", { value: true })
  textarea.dispatchEvent(composing)
  const key229 = new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
  Object.defineProperty(key229, "keyCode", { value: 229 })
  textarea.dispatchEvent(key229)
  await settle()
  assert.ok(document.querySelector("textarea"), "IME Enter must not save")

  lock(true)
  assert.equal(textarea.readOnly, true, "host saves must prevent further changes without discarding the editor")
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
  textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
  await settle()
  assert.equal(document.querySelector("textarea"), textarea, "locked save/cancel must retain the editor")
  assert.equal(saved()[0]?.comment, "existing comment")
  lock(false)

  switchDraft("draft-b")
  await settle()
  assert.equal(document.querySelector("textarea"), null)
  switchDraft("draft-a")
  await settle()
  assert.equal((document.querySelector("textarea") as HTMLTextAreaElement).value, "latest controlled comment")
  assert.equal(list.hidden, true, "restoring an editor must not expand the pending list")

  const save = Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Save")
  save?.click()
  await settle()
  assert.equal(saved()[0]?.comment, "latest controlled comment")
  assert.equal(list.hidden, true, "saving and restoring focus must leave the list collapsed")
  assert.equal(document.activeElement, count, "hidden edit controls must fall back to the visible count button")

  count.focus()
  count.click()
  const editAgain = host.querySelector('[aria-label="Edit"]') as HTMLButtonElement
  editAgain.click()
  await settle()
  const changed = document.querySelector("textarea") as HTMLTextAreaElement
  changed.value = "unsaved edit"
  changed.dispatchEvent(new InputEvent("input", { bubbles: true }))
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
  await settle()
  assert.equal(document.querySelector("textarea"), null)
  assert.equal(document.activeElement, count, "Escape should restore focus to the visible count button")
  assert.equal(list.hidden, true)
  assert.equal(saved()[0]?.comment, "latest controlled comment", "Escape must preserve the previously saved note")

  count.click()
  assert.equal(list.hidden, false)
  open(newAnnotation({ sessionID: "session-1", messageID: "message-2", selectedText: "new selection", comment: "" }))
  await settle()
  assert.equal(list.hidden, true, "starting a NEW annotation must collapse even a previously expanded list")
  const fresh = document.querySelector("textarea") as HTMLTextAreaElement
  fresh.value = "a second saved note"
  fresh.dispatchEvent(new InputEvent("input", { bubbles: true }))
  fresh.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
  await settle()
  assert.equal(saved().length, 2)
  assert.equal(list.hidden, true, "count changes after creation must not open the list")
  open(newAnnotation({ sessionID: "session-1", messageID: "message-3", selectedText: "third selection", comment: "" }))
  await settle()
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
  await settle()
  assert.equal(saved().length, 2, "cancelling a new editor must not remove existing notes")
  assert.equal(list.hidden, true)
  dispose()
  host.remove()
}

async function collapsedList() {
  const host = document.createElement("div")
  document.body.append(host)
  const annotation = newAnnotation({
    sessionID: "session-1",
    messageID: "message-1",
    selectedText: "selection",
    comment: "comment",
  })
  annotation.number = 7
  const dispose = render(
    () => (
      <LanguageContext.Provider value={language as never}>
        <AnnotationList annotations={[annotation]} onEdit={() => {}} onDelete={() => {}} onClear={() => {}} />
      </LanguageContext.Provider>
    ),
    host,
  )
  const root = host.querySelector('[data-component="prompt-annotations"]') as HTMLElement
  const toggle = host.querySelector("[aria-controls]") as HTMLButtonElement
  const list = host.querySelector(".prompt-annotations-list") as HTMLElement
  assert.equal(list.hidden, true)
  assert.equal(toggle.getAttribute("aria-expanded"), "false")
  assert.equal(toggle.getAttribute("aria-controls"), list.id)
  assert.equal(host.querySelector(".prompt-annotation-number")?.textContent, "#7", "display assigned numbers unchanged")
  root.dispatchEvent(new MouseEvent("mouseenter", { bubbles: false }))
  assert.equal(list.hidden, true, "hover must not expand the pending list")
  root.dispatchEvent(new MouseEvent("mouseleave", { bubbles: false }))
  assert.equal(list.hidden, true)
  toggle.focus()
  assert.equal(list.hidden, true)
  toggle.click()
  assert.equal(list.hidden, false, "explicit activation should open the list")
  assert.equal(toggle.getAttribute("aria-expanded"), "true")
  toggle.click()
  assert.equal(list.hidden, true, "a second click should explicitly collapse the list")
  toggle.blur()
  toggle.focus()
  assert.equal(list.hidden, true, "restoring keyboard focus must not silently reopen the list")
  dispose()
  host.remove()
}

async function selectionOwnershipAndCopyFailure() {
  const host = document.createElement("div")
  const transcript = document.createElement("div")
  transcript.dataset.transcriptRoot = ""
  transcript.dataset.session = "session-1"
  const row = document.createElement("div")
  row.dataset.row = "assistant"
  row.dataset.message = "message-1"
  row.dataset.session = "session-1"
  const textNode = document.createTextNode("assistant selection")
  const part = document.createElement("div")
  part.dataset.component = "text-part"
  part.append(textNode)
  row.append(part)
  transcript.append(row)
  document.body.append(transcript, host)
  Object.defineProperty(document.documentElement, "clientWidth", { configurable: true, value: 300 })
  Object.defineProperty(document.documentElement, "clientHeight", { configurable: true, value: 200 })
  const [sessionID, setSessionID] = createSignal<string | undefined>("session-1")
  let added = 0
  let explained = 0
  const [enabled, setEnabled] = createSignal(true)
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: async () => Promise.reject(new Error("denied")) },
  })
  const dispose = render(
    () => (
      <LanguageContext.Provider value={language as never}>
        <>
          <Toast.Region />
          <SelectionToolbar
            streamingMessageIDs={() => new Set()}
            transcript={() => transcript}
            sessionID={sessionID}
            onAdd={() => added++}
            onExplain={() => explained++}
            enabled={enabled}
          />
        </>
      </LanguageContext.Provider>
    ),
    host,
  )
  const range = document.createRange()
  range.selectNodeContents(part)
  let rect = new DOMRect(1, 1, 10, 10)
  Object.defineProperty(range, "getBoundingClientRect", { value: () => rect })
  const selection = window.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
  document.dispatchEvent(new Event("selectionchange"))
  const toolbar = host.querySelector(".selection-toolbar") as HTMLElement
  Object.defineProperty(toolbar, "offsetWidth", { value: 120 })
  Object.defineProperty(toolbar, "offsetHeight", { value: 30 })
  await settle()
  assert.equal(parseFloat(toolbar.style.left), 8, "left-edge selections must stay inside viewport padding")
  assert.ok(parseFloat(toolbar.style.top) >= 19, "top-edge selections must place the toolbar below the selection")

  rect = new DOMRect(290, 80, 8, 10)
  document.dispatchEvent(new Event("selectionchange"))
  await settle()
  assert.ok(parseFloat(toolbar.style.left) <= 172, "right-edge selections must stay inside viewport padding")
  const copy = Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Copy")
  assert.ok(copy)
  copy.click()
  await settle()
  assert.ok(host.querySelector(".selection-toolbar"), "clipboard failure must keep the toolbar available")
  assert.match(document.body.textContent ?? "", /Copy failed visibly/, "clipboard failure must show a visible toast")
  window.dispatchEvent(new Event("resize"))
  assert.equal(host.querySelector(".selection-toolbar"), null, "viewport resize must dismiss stale toolbar geometry")
  document.dispatchEvent(new Event("selectionchange"))
  await settle()

  row.dataset.session = "session-2"
  const annotate = Array.from(host.querySelectorAll("button")).find(
    (button) => button.textContent?.trim() === "Annotate",
  )
  annotate?.click()
  assert.equal(added, 0, "actions must revalidate a stale selection capture")
  assert.equal(host.querySelector(".selection-toolbar"), null)

  row.dataset.session = "session-1"
  selection.removeAllRanges()
  selection.addRange(range)
  document.dispatchEvent(new Event("selectionchange"))
  const explain = () =>
    Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Explain Briefly")
  assert.ok(explain(), "the third action is enabled by default")
  setEnabled(false)
  assert.equal(explain(), undefined, "the off switch hides Response Lens actions, not Copy")
  assert.match(host.textContent ?? "", /Copy/)
  setEnabled(true)
  explain()?.click()
  assert.equal(explained, 1)
  selection.addRange(range)
  document.dispatchEvent(new Event("selectionchange"))
  row.dataset.session = "session-2"
  explain()?.click()
  assert.equal(explained, 1, "Explain uses the same stale capture validation as Annotate")

  row.dataset.session = "session-1"
  selection.removeAllRanges()
  selection.addRange(range)
  document.dispatchEvent(new Event("selectionchange"))
  Array.from(host.querySelectorAll("button"))
    .find((button) => button.textContent?.trim() === "Annotate")
    ?.click()
  assert.equal(added, 1, "Annotate still works alongside Explain")

  row.dataset.session = "session-1"
  selection.removeAllRanges()
  selection.addRange(range)
  document.dispatchEvent(new Event("selectionchange"))
  await settle()
  assert.ok(host.querySelector(".selection-toolbar"))
  setSessionID("session-2")
  await settle()
  assert.equal(host.querySelector(".selection-toolbar"), null, "session switches must dismiss stale selection UI")
  dispose()
  transcript.remove()
  host.remove()
}

await editorLifecycle()
await collapsedList()
await selectionOwnershipAndCopyFailure()
await window.happyDOM.cancelAsync()
await window.happyDOM.close()
