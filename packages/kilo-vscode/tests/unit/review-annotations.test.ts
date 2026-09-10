import { afterEach, describe, expect, it } from "bun:test"
import { Window } from "happy-dom"
import {
  buildReviewAnnotation,
  type AnnotationLabels,
  type AnnotationMeta,
  type CommentFormActions,
  type CommentFormMount,
} from "../../webview-ui/diff-viewer/review-annotations"

const labels: AnnotationLabels = {
  commentOnLine: (line) => `Comment on line ${line}`,
  editCommentOnLine: (line) => `Edit comment on line ${line}`,
  placeholder: "Comment",
  cancel: "Cancel",
  comment: "Comment",
  send: "Send",
  save: "Save",
  sendToChat: "Send to chat",
  edit: "Edit",
  delete: "Delete",
}

const original = {
  document: globalThis.document,
  window: globalThis.window,
  raf: globalThis.requestAnimationFrame,
  cancel: globalThis.cancelAnimationFrame,
}

let frames: FrameRequestCallback[] = []

afterEach(() => {
  globalThis.document = original.document
  globalThis.window = original.window
  globalThis.requestAnimationFrame = original.raf
  globalThis.cancelAnimationFrame = original.cancel
  frames = []
})

function setup() {
  const view = new Window()
  globalThis.document = view.document
  globalThis.window = view as unknown as Window & typeof globalThis
  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    frames.push(callback)
    return frames.length
  }) as typeof requestAnimationFrame
  globalThis.cancelAnimationFrame = () => {}
  return view
}

function flushFrames() {
  for (let i = 0; i < 40 && frames.length; i += 1) frames.shift()?.(0)
}

function annotation(): AnnotationMeta {
  return { type: "draft", comment: null, file: "src/file.ts", side: "additions", line: 2, endLine: 2 }
}

const diffs = [
  {
    file: "src/file.ts",
    before: "old\n",
    after: "new\n",
    additions: 1,
    deletions: 1,
    patch: "@@ -1 +1 @@\n-old\n+new\n",
  },
]

function build(opts: { mount?: CommentFormMount; destination?: "local" | "github" } = {}) {
  const meta = annotation()
  if (opts.destination) meta.destination = opts.destination
  const added: string[] = []
  const sent: string[] = []
  const destinations: string[] = []
  const disposals: Array<() => void> = []
  let success = 0
  let cancelled = 0
  const root = buildReviewAnnotation(
    { side: "additions", lineNumber: 2, metadata: meta },
    {
      diffs,
      editing: null,
      setEditing: () => {},
      addComment: (_file, _side, _line, text) => added.push(text),
      sendComment: (_file, _side, _line, text) => sent.push(text),
      updateComment: () => {},
      deleteComment: () => {},
      cancelDraft: () => cancelled++,
      completeRemoteDraft: () => success++,
      onDestination: (value) => destinations.push(value),
      labels,
      activeTerminalId: () => undefined,
      mount: opts.mount,
      track: (_meta, _host, dispose) => disposals.push(dispose),
    },
  )
  return { root, meta, added, sent, destinations, disposals, success: () => success, cancelled: () => cancelled }
}

function mountField() {
  const field = document.createElement("textarea")
  field.className = "mounted-field"
  const actions = document.createElement("div")
  actions.className = "am-pr-comment-actions"
  const submit = document.createElement("button")
  submit.setAttribute("data-action", "submit")
  actions.appendChild(submit)
  return { field, actions }
}

describe("review annotation draft", () => {
  it("mounts one form and forwards save, send, destination, success, and cancel", () => {
    setup()
    let actions: CommentFormActions | undefined
    let mountedHost: HTMLElement | undefined
    const mount: CommentFormMount = (host, _meta, value) => {
      actions = value
      mountedHost = host
      const parts = mountField()
      host.appendChild(parts.field)
      host.appendChild(parts.actions)
      return () => host.replaceChildren()
    }
    const result = build({ mount })
    if (!result.root) throw new Error("Missing annotation")
    expect(result.root.dataset.mounted).toBe("true")
    expect(result.root.querySelector(".am-annotation-destination")).toBeNull()
    expect(mountedHost).not.toBeUndefined()
    if (!actions) throw new Error("Missing actions")

    actions.onBodyChange("Draft text")
    expect(result.meta.text).toBe("Draft text")
    actions.onSave("Saved body", "selected")
    expect(result.added).toEqual(["Saved body"])
    actions.onSend("Sent body", "selected")
    expect(result.sent).toEqual(["Sent body"])
    actions.onDestination("github")
    expect(result.meta.destination).toBe("github")
    expect(result.destinations).toEqual(["github"])
    actions.onGithubSuccess()
    expect(result.success()).toBe(1)
    actions.onCancel()
    expect(result.cancelled()).toBe(1)
  })

  it("focuses the mounted form editor", () => {
    setup()
    const mount: CommentFormMount = (host) => {
      const parts = mountField()
      host.appendChild(parts.field)
      host.appendChild(parts.actions)
      return () => host.replaceChildren()
    }
    const result = build({ mount })
    if (!result.root) throw new Error("Missing annotation")
    document.body.appendChild(result.root)
    flushFrames()
    expect(document.activeElement).toBe(result.root.querySelector(".am-annotation-form textarea"))
  })

  it("falls back to a native composer without a mount", async () => {
    setup()
    const result = build()
    if (!result.root) throw new Error("Missing annotation")
    document.body.appendChild(result.root)
    flushFrames()
    const textarea = result.root.querySelector("textarea")
    if (!textarea) throw new Error("Missing textarea")
    expect(document.activeElement).toBe(textarea)
    textarea.value = "Native comment"
    textarea.dispatchEvent(new window.Event("input", { bubbles: true }))
    textarea.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
    expect(result.added).toEqual(["Native comment"])
    const send = [...result.root.querySelectorAll("button")].find((button) => button.textContent === "Send")
    if (!send) throw new Error("Missing send button")
    textarea.value = "To chat"
    textarea.dispatchEvent(new window.Event("input", { bubbles: true }))
    send.click()
    expect(result.sent).toEqual(["To chat"])
  })

  it("disposes the mounted form when the lifecycle releases it", () => {
    setup()
    let released = 0
    const mount: CommentFormMount = (host) => {
      const parts = mountField()
      host.appendChild(parts.field)
      host.appendChild(parts.actions)
      return () => {
        released++
        host.replaceChildren()
      }
    }
    const result = build({ mount })
    if (!result.root) throw new Error("Missing annotation")
    result.disposals[0]?.()
    expect(released).toBe(1)
  })
})
