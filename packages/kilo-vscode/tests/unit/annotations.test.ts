import { describe, expect, it } from "bun:test"
import { Window } from "happy-dom"
import { createRoot } from "solid-js"
import {
  type AnnotationEditorState,
  ANNOTATION_COMMENT_LIMIT,
  ANNOTATION_LIMIT,
  ANNOTATION_TEXT_LIMIT,
  formatAnnotationsMarkdown,
  newAnnotation,
  parseAnnotations,
  removeAnnotation,
  upsertAnnotation,
  validAnnotation,
  withAnnotationComment,
} from "../../webview-ui/src/utils/annotations"
import {
  annotationDraftPending,
  annotationAutoSendAllowed,
  annotationCommandBlocked,
  annotationFocusOutside,
  annotationFocusTarget,
  annotationSendOwns,
  clearAcceptedAnnotationDraft,
  commitAnnotationEditor,
  createAnnotationSendLock,
  openAnnotationEditor,
  replaceAnnotationDraft,
  updateAnnotationEditor,
} from "../../webview-ui/src/utils/annotation-state"
import { assistantSelectionRow } from "../../webview-ui/src/utils/assistant-selection"

const base = (messageID = "msg_019f123456789abcdef0") =>
  newAnnotation({
    sessionID: "ses_1",
    messageID,
    selectedText: "PR-AUC 0.105 vs prior 0.025",
    comment: "why is the linear model better here?",
    now: 10,
  })

describe("annotation limits and formatting", () => {
  it("upserts by id and supports multiple messages", () => {
    const first = base()
    const second = base("msg_019f123456789abcdef1")
    const list = upsertAnnotation(upsertAnnotation([], first), second)
    const updated = withAnnotationComment(first, "edited", 20)
    const next = upsertAnnotation(list, updated)

    expect(next).toHaveLength(2)
    expect(next[0]).toMatchObject({ comment: "edited", updatedAt: 20 })
    expect(removeAnnotation(next, second.id)).toEqual([updated])
  })

  it("enforces selected-text, comment, count, and aggregate limits when upserting", () => {
    const oversizedText = newAnnotation({
      sessionID: "session",
      messageID: "message",
      selectedText: "x".repeat(ANNOTATION_TEXT_LIMIT + 1),
      comment: "comment",
    })
    expect(validAnnotation(oversizedText)).toBe(false)
    expect(upsertAnnotation([], oversizedText)).toEqual([])

    const full = Array.from({ length: ANNOTATION_LIMIT }, (_, index) => ({
      ...base(`msg_${index}`),
      id: `annotation-${index}`,
    }))
    expect(upsertAnnotation(full, { ...base("overflow"), id: "overflow" })).toHaveLength(ANNOTATION_LIMIT)

    const large = Array.from({ length: 9 }, (_, index) =>
      newAnnotation({
        sessionID: "session",
        messageID: `message-${index}`,
        selectedText: "selection",
        comment: "y".repeat(ANNOTATION_COMMENT_LIMIT),
      }),
    )
    expect(parseAnnotations(large)).toBeDefined()
    const overflow = newAnnotation({
      sessionID: "session",
      messageID: "message-overflow",
      selectedText: "selection",
      comment: "y".repeat(ANNOTATION_COMMENT_LIMIT),
    })
    expect(upsertAnnotation(large, overflow)).toEqual(large)
  })

  it("rejects malformed timestamps and overlong comments", () => {
    expect(parseAnnotations([{ ...base(), createdAt: -1 }])).toBeUndefined()
    expect(parseAnnotations([{ ...base(), comment: "x".repeat(ANNOTATION_COMMENT_LIMIT + 1) }])).toBeUndefined()
  })

  it("uses full message ids and a safe fence", () => {
    const item = newAnnotation({
      sessionID: "session",
      messageID: "msg_019f123456789abcdef0",
      selectedText: "code with ```triple``` runs",
      comment: "Explain this",
    })
    const text = formatAnnotationsMarkdown([item])
    expect(text).toContain(`message ${item.messageID}`)
    expect(text).toContain("````\ncode with ```triple``` runs\n````")
  })
})

describe("annotation editor state", () => {
  const rect = {} as DOMRect

  it("commits the latest controlled comment and rejects invalid saves", () => {
    const item = { ...base(), comment: "" }
    const opened = openAnnotationEditor(item, rect)
    const edited = updateAnnotationEditor(opened, item.id, "latest unsaved comment")
    const committed = commitAnnotationEditor(edited, [], 30)
    expect(committed).toMatchObject({
      status: "committed",
      annotations: [{ id: item.id, comment: "latest unsaved comment", updatedAt: 30 }],
    })
    expect(commitAnnotationEditor(opened, [])).toEqual({ status: "invalid", annotations: [] })
    expect(commitAnnotationEditor({ ...opened, comment: "x".repeat(ANNOTATION_COMMENT_LIMIT + 1) }, [])).toEqual({
      status: "rejected",
      annotations: [],
    })
  })

  it("ignores stale editor callbacks and counts an open editor as pending", () => {
    const first = base("message-1")
    const second = { ...base("message-2"), id: "annotation-2" }
    const opened = openAnnotationEditor(second, rect)
    expect(updateAnnotationEditor(opened, first.id, "stale")).toEqual(opened)
    expect(annotationDraftPending([], opened)).toBe(true)
    expect(annotationDraftPending([first], undefined)).toBe(true)
    expect(annotationDraftPending([], undefined)).toBe(false)
  })

  it("detects focus outside the active popover", () => {
    const window = new Window()
    const root = window.document.createElement("div")
    const textarea = window.document.createElement("textarea")
    const outside = window.document.createElement("button")
    root.append(textarea)
    expect(annotationFocusOutside(root as unknown as Node, textarea as unknown as Node)).toBe(false)
    expect(annotationFocusOutside(root as unknown as Node, outside as unknown as Node)).toBe(true)
  })

  it("restores focus only to visible connected controls", () => {
    const window = new Window()
    const document = window.document
    const list = document.createElement("div")
    const edit = document.createElement("button")
    const fallback = document.createElement("button")
    list.append(edit)
    document.body.append(list, fallback)
    list.hidden = true
    expect(annotationFocusTarget(edit as unknown as HTMLElement, fallback as unknown as HTMLElement)).toBe(fallback)
    list.hidden = false
    expect(annotationFocusTarget(edit as unknown as HTMLElement, fallback as unknown as HTMLElement)).toBe(edit)
  })
})

describe("annotation send safety", () => {
  const lock = () => {
    let dispose = () => {}
    const value = createRoot((cleanup) => {
      dispose = cleanup
      return createAnnotationSendLock()
    })
    return { value, dispose }
  }

  it("locks only the resolving draft and never clears a newer switched draft", async () => {
    const send = lock()
    const first = base("message-a")
    const newer = { ...base("message-b"), id: "annotation-b" }
    const drafts = new Map([["draft-a", [first]]])
    const editors = new Map([["draft-a", { annotation: first, comment: "pending" }]])
    const token = send.value.begin({ key: "draft-a", sessionID: "session-a" })
    if (!token) throw new Error("expected annotation send lock")
    let key = "draft-a"
    let sessionID = "session-a"
    let current = [first]
    const gate = Promise.withResolvers<void>()
    const pending = (async () => {
      try {
        await gate.promise
        const owns = annotationSendOwns(token, key, sessionID)
        clearAcceptedAnnotationDraft(token.key, drafts, editors)
        if (owns) current = []
      } finally {
        send.value.end(token)
      }
    })()

    expect(send.value.run("draft-a", () => (current = []))).toBe(false)
    expect(current).toEqual([first])
    key = "draft-b"
    sessionID = "session-b"
    current = []
    expect(
      send.value.run("draft-b", () => {
        current = [newer]
        drafts.set("draft-b", [newer])
      }),
    ).toBe(true)
    gate.resolve()
    await pending

    expect(current).toEqual([newer])
    expect(drafts.has("draft-a")).toBe(false)
    expect(editors.has("draft-a")).toBe(false)
    expect(drafts.get("draft-b")).toEqual([newer])
    expect(send.value.active()).toBe(false)
    send.dispose()
  })

  it("clears the captured draft after an accepted send that still owns the prompt", () => {
    const send = lock()
    const item = base()
    const drafts = new Map([["draft-a", [item]]])
    const editors = new Map([["draft-a", { annotation: item, comment: "pending" }]])
    const token = send.value.begin({ key: "draft-a", sessionID: "session-a" })
    if (!token) throw new Error("expected annotation send lock")
    const owns = annotationSendOwns(token, "draft-a", "session-a")
    clearAcceptedAnnotationDraft(token.key, drafts, editors)
    const current = owns ? [] : [item]
    send.value.end(token)
    expect(current).toEqual([])
    expect(drafts.has("draft-a")).toBe(false)
    expect(editors.has("draft-a")).toBe(false)
  })

  it("uses the same pending-state guards for commands and auto-send paths", () => {
    const item = base()
    const editor = openAnnotationEditor(item, {} as DOMRect)
    expect(annotationCommandBlocked({ name: "new" }, [item], undefined)).toBe(true)
    expect(annotationCommandBlocked({ name: "new" }, [], editor)).toBe(true)
    expect(annotationCommandBlocked(undefined, [item], undefined)).toBe(false)
    expect(annotationAutoSendAllowed([item], undefined)).toBe(false)
    expect(annotationAutoSendAllowed([], editor)).toBe(false)
    expect(annotationAutoSendAllowed([], undefined)).toBe(true)
  })

  it("clears revert and full-redo annotations only for the replaced draft", () => {
    const target = base("target-message")
    const other = { ...base("other-message"), id: "other-annotation", sessionID: "other-session" }
    const drafts = new Map([
      ["target", [target]],
      ["other", [other]],
    ])
    const editors = new Map([
      ["target", { annotation: target, comment: "target editor" }],
      ["other", { annotation: other, comment: "other editor" }],
    ])
    let current = [target]
    let editor: AnnotationEditorState | undefined = openAnnotationEditor(target, {} as DOMRect)

    expect(
      replaceAnnotationDraft({
        target: "target",
        current: "target",
        drafts,
        editors,
        clearCurrent: () => {
          current = []
          editor = undefined
        },
      }),
    ).toBe(true)
    expect(current).toEqual([])
    expect(editor).toBeUndefined()
    expect(drafts.has("target")).toBe(false)
    expect(editors.has("target")).toBe(false)
    expect(drafts.get("other")).toEqual([other])
    expect(editors.get("other")).toEqual({ annotation: other, comment: "other editor" })

    drafts.set("target", [target])
    editors.set("target", { annotation: target, comment: "redo editor" })
    current = [other]
    editor = openAnnotationEditor(other, {} as DOMRect)
    expect(
      replaceAnnotationDraft({
        target: "target",
        current: "other",
        drafts,
        editors,
        clearCurrent: () => {
          current = []
          editor = undefined
        },
      }),
    ).toBe(false)
    expect(current).toEqual([other])
    expect(editor?.annotation.id).toBe(other.id)
    expect(drafts.get("other")).toEqual([other])
    expect(editors.get("other")).toEqual({ annotation: other, comment: "other editor" })
  })

  it("cancels only an in-flight send for the replaced draft", () => {
    const send = lock()
    const token = send.value.begin({ key: "target", sessionID: "target-session" })
    if (!token) throw new Error("expected annotation send lock")
    send.value.cancel("other")
    expect(send.value.held(token)).toBe(true)
    send.value.cancel("target")
    expect(send.value.held(token)).toBe(false)
    expect(send.value.active()).toBe(false)
    expect(send.value.run("target", () => {})).toBe(true)
    send.dispose()
  })
})

describe("assistant selection ownership", () => {
  const setup = () => {
    const window = new Window()
    const document = window.document
    const transcript = document.createElement("div")
    transcript.dataset.transcriptRoot = ""
    transcript.dataset.session = "session-1"
    const first = document.createElement("div")
    const second = document.createElement("div")
    first.dataset.row = "assistant"
    first.dataset.message = "message-1"
    first.dataset.session = "session-1"
    second.dataset.row = "assistant"
    second.dataset.message = "message-2"
    second.dataset.session = "session-1"
    const firstText = document.createTextNode("first")
    const secondText = document.createTextNode("second")
    first.append(firstText)
    second.append(secondText)
    transcript.append(first, second)
    document.body.append(transcript)
    return {
      document,
      transcript,
      first,
      second,
      firstText,
      secondText,
      scope: {
        transcript: transcript as unknown as HTMLElement,
        sessionID: "session-1",
        streaming: new Set<string>(),
      },
    }
  }

  it("accepts only endpoints and common ancestor in the same completed owned row", () => {
    const { document, first, firstText, secondText, scope } = setup()
    expect(
      assistantSelectionRow(
        firstText as unknown as Node,
        firstText as unknown as Node,
        first as unknown as Node,
        scope,
      ),
    ).toBe(first)
    expect(
      assistantSelectionRow(
        firstText as unknown as Node,
        secondText as unknown as Node,
        document.body as unknown as Node,
        scope,
      ),
    ).toBeUndefined()
    expect(
      assistantSelectionRow(
        firstText as unknown as Node,
        firstText as unknown as Node,
        document.body as unknown as Node,
        scope,
      ),
    ).toBeUndefined()
  })

  it("rejects live, streaming, foreign-session, nested-transcript, and outside rows", () => {
    const { document, transcript, first, firstText, scope } = setup()
    first.setAttribute("data-live", "")
    expect(
      assistantSelectionRow(
        firstText as unknown as Node,
        firstText as unknown as Node,
        first as unknown as Node,
        scope,
      ),
    ).toBeUndefined()
    first.removeAttribute("data-live")
    expect(
      assistantSelectionRow(firstText as unknown as Node, firstText as unknown as Node, first as unknown as Node, {
        ...scope,
        streaming: new Set(["message-1"]),
      }),
    ).toBeUndefined()
    first.dataset.session = "session-2"
    expect(
      assistantSelectionRow(
        firstText as unknown as Node,
        firstText as unknown as Node,
        first as unknown as Node,
        scope,
      ),
    ).toBeUndefined()

    first.dataset.session = "session-1"
    const nested = document.createElement("div")
    nested.dataset.transcriptRoot = ""
    nested.append(first)
    transcript.append(nested)
    expect(
      assistantSelectionRow(
        firstText as unknown as Node,
        firstText as unknown as Node,
        first as unknown as Node,
        scope,
      ),
    ).toBeUndefined()

    document.body.append(first)
    expect(
      assistantSelectionRow(
        firstText as unknown as Node,
        firstText as unknown as Node,
        first as unknown as Node,
        scope,
      ),
    ).toBeUndefined()
  })
})
