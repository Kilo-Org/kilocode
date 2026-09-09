import { describe, expect, it } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { useFileMention } from "../../webview-ui/src/hooks/useFileMention"
import { FILE_PICKER_RESULT, TERMINAL_RESULT } from "../../webview-ui/src/hooks/file-mention-utils"
import type { ExtensionMessage, WebviewMessage } from "../../webview-ui/src/types/messages"

declare global {
  // eslint-disable-next-line no-var
  var document: { execCommand: (commandId: string, showUI?: boolean, value?: string) => boolean }
}

const hadDoc = "document" in globalThis
const originalDoc = hadDoc ? globalThis.document : undefined

function mockDocument(target?: { insert: (text: string) => void }) {
  globalThis.document = {
    execCommand: (_id: string, _show?: boolean, value?: string) => {
      target?.insert(value ?? "")
      return true
    },
  }
}

/** Minimal textarea stub whose selection and execCommand inserts mutate text. */
function editor(initial: string) {
  const state = { start: initial.length, end: initial.length, value: initial }
  return {
    get value() {
      return state.value
    },
    get selectionStart() {
      return state.start
    },
    get selectionEnd() {
      return state.end
    },
    isConnected: true,
    focus: () => {},
    setSelectionRange: (start: number, end = start) => {
      state.start = start
      state.end = end
    },
    insert: (text: string) => {
      state.value = state.value.slice(0, state.start) + text + state.value.slice(state.end)
      state.start += text.length
      state.end = state.start
    },
  } as unknown as HTMLTextAreaElement & { insert: (text: string) => void }
}

function restoreDocument() {
  if (hadDoc && originalDoc) {
    globalThis.document = originalDoc
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).document
  }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function textarea(
  value: string,
  cursor: number,
  dir: "ltr" | "rtl",
  selection?: { end: number; direction: SelectionDirection },
) {
  const state = { start: cursor, end: selection?.end ?? cursor, direction: selection?.direction ?? "none" }
  return {
    value,
    get selectionStart() {
      return state.start
    },
    get selectionEnd() {
      return state.end
    },
    get selectionDirection() {
      return state.direction
    },
    matches: (selector: string) => selector === `:dir(${dir})`,
    setSelectionRange: (start: number, end = start, direction: SelectionDirection = "none") => {
      state.start = start
      state.end = end
      state.direction = direction
    },
  } as unknown as HTMLTextAreaElement
}

function key(key: "ArrowLeft" | "ArrowRight") {
  const state = { prevented: 0 }
  return {
    state,
    event: {
      key,
      preventDefault: () => state.prevented++,
    } as unknown as KeyboardEvent,
  }
}

describe("useFileMention", () => {
  it("keeps previous file results visible while the next search is pending", async () => {
    const posted: WebviewMessage[] = []
    const handlers = new Set<(message: ExtensionMessage) => void>()
    const ctx = {
      postMessage: (message: WebviewMessage) => posted.push(message),
      onMessage: (handler: (message: ExtensionMessage) => void) => {
        handlers.add(handler)
        return () => handlers.delete(handler)
      },
    }

    const dispose: { fn?: () => void } = {}
    const mention = createRoot((root) => {
      dispose.fn = root
      return useFileMention(ctx, undefined, () => false)
    })

    mention.onInput("@e", 2)
    await wait(170)

    const first = posted.at(-1)
    expect(first?.type).toBe("requestFileSearch")
    expect(first).toMatchObject({ query: "e", requestId: "file-search-1" })

    for (const handler of handlers) {
      handler({
        type: "fileSearchResult",
        requestId: "file-search-1",
        dir: "/repo",
        paths: ["packages/kilo-vscode/src/extension.ts"],
        items: [{ path: "packages/kilo-vscode/src/extension.ts", type: "opened-file" }],
      })
    }

    expect(mention.mentionResults()).toEqual([
      { type: "opened-file", value: "packages/kilo-vscode/src/extension.ts" },
      FILE_PICKER_RESULT,
    ])

    mention.onInput("@ex", 3)

    expect(mention.mentionResults()).toEqual([
      { type: "opened-file", value: "packages/kilo-vscode/src/extension.ts" },
      FILE_PICKER_RESULT,
    ])

    dispose.fn?.()
  })

  it("does not keep stale file results visible for unrelated queries", async () => {
    const posted: WebviewMessage[] = []
    const handlers = new Set<(message: ExtensionMessage) => void>()
    const ctx = {
      postMessage: (message: WebviewMessage) => posted.push(message),
      onMessage: (handler: (message: ExtensionMessage) => void) => {
        handlers.add(handler)
        return () => handlers.delete(handler)
      },
    }

    const dispose: { fn?: () => void } = {}
    const mention = createRoot((root) => {
      dispose.fn = root
      return useFileMention(ctx, undefined, () => false)
    })

    mention.onInput("@read", 5)
    await wait(170)

    for (const handler of handlers) {
      handler({
        type: "fileSearchResult",
        requestId: "file-search-1",
        dir: "/repo",
        paths: ["README.md"],
        items: [{ path: "README.md", type: "file" }],
      })
    }

    mention.onInput("@zz", 3)

    expect(mention.mentionResults()).toEqual([FILE_PICKER_RESULT])

    dispose.fn?.()
  })

  it("keeps mention search open after typing a space in the query", async () => {
    const posted: WebviewMessage[] = []
    const handlers = new Set<(message: ExtensionMessage) => void>()
    const ctx = {
      postMessage: (message: WebviewMessage) => posted.push(message),
      onMessage: (handler: (message: ExtensionMessage) => void) => {
        handlers.add(handler)
        return () => handlers.delete(handler)
      },
    }

    const dispose: { fn?: () => void } = {}
    const mention = createRoot((root) => {
      dispose.fn = root
      return useFileMention(ctx, undefined, () => false)
    })

    mention.onInput("@my report", 10)
    expect(mention.showMention()).toBe(true)
    await wait(170)

    const request = posted.at(-1)
    expect(request).toMatchObject({ type: "requestFileSearch", query: "my report" })

    for (const handler of handlers) {
      handler({
        type: "fileSearchResult",
        requestId: request?.type === "requestFileSearch" ? request.requestId : "",
        dir: "/repo",
        paths: ["docs/my report.txt"],
        items: [{ path: "docs/my report.txt", type: "file" }],
      })
    }

    expect(mention.showMention()).toBe(true)
    expect(mention.mentionResults()).toEqual([{ type: "file", value: "docs/my report.txt" }, FILE_PICKER_RESULT])

    dispose.fn?.()
  })

  it("keeps the dropdown closed while typing after a selected mention", () => {
    const ctx = {
      postMessage: () => {},
      onMessage: () => () => {},
    }

    const dispose: { fn?: () => void } = {}
    const mention = createRoot((root) => {
      dispose.fn = root
      return useFileMention(ctx, undefined, () => false)
    })

    const path = "packages/sdk/js/src/gen/types.gen.ts"
    const input = editor("@types")
    mockDocument(input)
    try {
      mention.onInput(input.value, input.selectionStart!)
      mention.selectMention({ type: "file", value: path }, input, () => {})
    } finally {
      restoreDocument()
    }
    expect(input.value).toBe(`@${path} `)

    // Typing straight after the inserted mention must not reopen the dropdown,
    // no matter what the pending file search would answer.
    mention.onInput(`@${path} d`, path.length + 3)
    expect(mention.showMention()).toBe(false)
    mention.onInput(`@${path} dsj`, path.length + 5)
    expect(mention.showMention()).toBe(false)

    // Deleting back into the mention itself is an edit of that mention.
    mention.onInput(`@${path}`, path.length + 1)
    expect(mention.showMention()).toBe(true)

    dispose.fn?.()
  })

  it("keeps the dropdown closed while typing after a selected builtin mention", () => {
    const ctx = {
      postMessage: () => {},
      onMessage: () => () => {},
    }

    const dispose: { fn?: () => void } = {}
    const mention = createRoot((root) => {
      dispose.fn = root
      return useFileMention(ctx, undefined, () => false)
    })

    const input = editor("@term")
    mockDocument(input)
    try {
      mention.onInput(input.value, input.selectionStart!)
      mention.selectMention(TERMINAL_RESULT, input, () => {})
    } finally {
      restoreDocument()
    }

    mention.onInput("@terminal what failed", 21)
    expect(mention.showMention()).toBe(false)

    dispose.fn?.()
  })

  it("finds past chats by title in the main list and inserts the picked one", async () => {
    const posted: WebviewMessage[] = []
    const handlers = new Set<(message: ExtensionMessage) => void>()
    const ctx = {
      postMessage: (message: WebviewMessage) => posted.push(message),
      onMessage: (handler: (message: ExtensionMessage) => void) => {
        handlers.add(handler)
        return () => handlers.delete(handler)
      },
    }

    const dispose: { fn?: () => void } = {}
    const mention = createRoot((root) => {
      dispose.fn = root
      return useFileMention(ctx, undefined, () => false)
    })

    mention.onInput("@fix", 4)
    const search = posted.find((message) => message.type === "requestSessionSearch")
    expect(search).toBeDefined()

    for (const handler of handlers) {
      handler({
        type: "sessionSearchResult",
        requestId: search?.type === "requestSessionSearch" ? search.requestId : "",
        sessions: [
          { id: "ses_a", title: "Fix auth bug", updated: 2 },
          { id: "ses_b", title: "Rotate signing keys", updated: 1 },
        ],
      })
    }

    // The chat is offered inline, without opening the dedicated picker first.
    expect(mention.sessionPicker()).toBe(false)
    const inline = mention.mentionResults().find((item) => item.type === "session")
    expect(inline).toMatchObject({ type: "session", value: "Fix auth bug" })

    const input = editor("@fix")
    mockDocument(input)
    try {
      mention.selectMention(inline!, input, () => {})
    } finally {
      restoreDocument()
    }

    expect(input.value).toBe("@Fix auth bug ")
    expect(mention.mentionedSessions().get("Fix auth bug")?.id).toBe("ses_a")

    dispose.fn?.()
  })

  it("waits for past chats before treating a spaced query as prose", async () => {
    const posted: WebviewMessage[] = []
    const handlers = new Set<(message: ExtensionMessage) => void>()
    const ctx = {
      postMessage: (message: WebviewMessage) => posted.push(message),
      onMessage: (handler: (message: ExtensionMessage) => void) => {
        handlers.add(handler)
        return () => handlers.delete(handler)
      },
    }

    const dispose: { fn?: () => void } = {}
    const mention = createRoot((root) => {
      dispose.fn = root
      return useFileMention(ctx, undefined, () => false)
    })

    mention.onInput("@fix auth", 9)
    await wait(170)

    // No file answers a chat title, and the file search is the first to reply.
    const search = posted.findLast((message) => message.type === "requestFileSearch")
    for (const handler of handlers) {
      handler({
        type: "fileSearchResult",
        requestId: search?.type === "requestFileSearch" ? search.requestId : "",
        dir: "/repo",
        paths: [],
        items: [],
      })
    }
    expect(mention.showMention()).toBe(true)

    const sessions = posted.find((message) => message.type === "requestSessionSearch")
    for (const handler of handlers) {
      handler({
        type: "sessionSearchResult",
        requestId: sessions?.type === "requestSessionSearch" ? sessions.requestId : "",
        sessions: [{ id: "ses_a", title: "Fix auth bug", updated: 2 }],
      })
    }

    expect(mention.showMention()).toBe(true)
    expect(mention.mentionResults().find((item) => item.type === "session")).toMatchObject({ value: "Fix auth bug" })

    dispose.fn?.()
  })

  it("closes a spaced query once the past chats fail to match it either", async () => {
    const posted: WebviewMessage[] = []
    const handlers = new Set<(message: ExtensionMessage) => void>()
    const ctx = {
      postMessage: (message: WebviewMessage) => posted.push(message),
      onMessage: (handler: (message: ExtensionMessage) => void) => {
        handlers.add(handler)
        return () => handlers.delete(handler)
      },
    }

    const dispose: { fn?: () => void } = {}
    const mention = createRoot((root) => {
      dispose.fn = root
      return useFileMention(ctx, undefined, () => false)
    })

    mention.onInput("@README.md and", 14)
    await wait(170)

    const search = posted.findLast((message) => message.type === "requestFileSearch")
    for (const handler of handlers) {
      handler({
        type: "fileSearchResult",
        requestId: search?.type === "requestFileSearch" ? search.requestId : "",
        dir: "/repo",
        paths: [],
        items: [],
      })
    }

    const sessions = posted.find((message) => message.type === "requestSessionSearch")
    for (const handler of handlers) {
      handler({
        type: "sessionSearchResult",
        requestId: sessions?.type === "requestSessionSearch" ? sessions.requestId : "",
        sessions: [{ id: "ses_a", title: "Something else entirely", updated: 2 }],
      })
    }

    expect(mention.showMention()).toBe(false)
    // And it stays closed as the sentence continues.
    mention.onInput("@README.md and then", 19)
    expect(mention.showMention()).toBe(false)

    dispose.fn?.()
  })

  it("keeps offering the past chats entry for its spaced label", () => {
    const ctx = {
      postMessage: () => {},
      onMessage: () => () => {},
    }

    const dispose: { fn?: () => void } = {}
    const mention = createRoot((root) => {
      dispose.fn = root
      return useFileMention(ctx, undefined, () => false)
    })

    mention.onInput("@past chats", 11)

    expect(mention.mentionResults().some((item) => item.type === "past-chats")).toBe(true)

    dispose.fn?.()
  })

  it("keeps searching a spaced path that starts like an earlier mention", () => {
    const posted: WebviewMessage[] = []
    const ctx = {
      postMessage: (message: WebviewMessage) => posted.push(message),
      onMessage: () => () => {},
    }

    const dispose: { fn?: () => void } = {}
    const mention = createRoot((root) => {
      dispose.fn = root
      return useFileMention(ctx, undefined, () => false)
    })

    // "my" is a folder mentioned earlier in the session, so it stays in the
    // sticky known set. Typing a longer, distinct path that begins with it must
    // still search instead of being mistaken for prose after a mention.
    mention.addPaths(["my"], "/repo")
    mention.onInput("@my report", 10)

    expect(mention.showMention()).toBe(true)

    dispose.fn?.()
  })

  it("opens a fresh query for a second mention typed after a completed one", () => {
    const ctx = {
      postMessage: () => {},
      onMessage: () => () => {},
    }

    const dispose: { fn?: () => void } = {}
    const mention = createRoot((root) => {
      dispose.fn = root
      return useFileMention(ctx, undefined, () => false)
    })

    mention.addPaths(["src/a.ts"], "/repo")
    mention.onInput("@src/a.ts and @b", 16)

    expect(mention.showMention()).toBe(true)

    dispose.fn?.()
  })

  it("closes the dropdown and stays closed while prose is typed after a mention", async () => {
    const posted: WebviewMessage[] = []
    const handlers = new Set<(message: ExtensionMessage) => void>()
    const ctx = {
      postMessage: (message: WebviewMessage) => posted.push(message),
      onMessage: (handler: (message: ExtensionMessage) => void) => {
        handlers.add(handler)
        return () => handlers.delete(handler)
      },
    }

    const dispose: { fn?: () => void } = {}
    const mention = createRoot((root) => {
      dispose.fn = root
      return useFileMention(ctx, undefined, () => false)
    })

    mention.onInput("@README.md and", 14)
    await wait(170)
    const request = posted.findLast((message) => message.type === "requestFileSearch")
    for (const handler of handlers) {
      handler({
        type: "fileSearchResult",
        requestId: request?.type === "requestFileSearch" ? request.requestId : "",
        dir: "/repo",
        paths: [],
        items: [],
      })
    }

    // The close waits for the past chats, which cannot match this query either.
    const sessions = posted.find((message) => message.type === "requestSessionSearch")
    for (const handler of handlers) {
      handler({
        type: "sessionSearchResult",
        requestId: sessions?.type === "requestSessionSearch" ? sessions.requestId : "",
        sessions: [],
      })
    }

    expect(mention.showMention()).toBe(false)

    // Continuing the sentence must not reopen the dropdown on every keystroke.
    mention.onInput("@README.md and then", 19)
    expect(mention.showMention()).toBe(false)

    // Editing back to a query that can still match reopens it.
    mention.onInput("@READ", 5)
    expect(mention.showMention()).toBe(true)

    dispose.fn?.()
  })

  it("starts the selection below browse files and falls back to it", async () => {
    const posted: WebviewMessage[] = []
    const handlers = new Set<(message: ExtensionMessage) => void>()
    const ctx = {
      postMessage: (message: WebviewMessage) => posted.push(message),
      onMessage: (handler: (message: ExtensionMessage) => void) => {
        handlers.add(handler)
        return () => handlers.delete(handler)
      },
    }

    const dispose: { fn?: () => void } = {}
    const mention = createRoot((root) => {
      dispose.fn = root
      return useFileMention(ctx, undefined, () => false)
    })

    mention.onInput("@chevron", 8)
    await wait(170)

    const search = posted.findLast((message) => message.type === "requestFileSearch")
    const sessions = posted.find((message) => message.type === "requestSessionSearch")
    for (const handler of handlers) {
      handler({
        type: "sessionSearchResult",
        requestId: sessions?.type === "requestSessionSearch" ? sessions.requestId : "",
        sessions: [
          { id: "ses_a", title: "Check prompt navigator implementation", updated: 3 },
          { id: "ses_b", title: "500 character novel generation", updated: 2 },
        ],
      })
      handler({
        type: "fileSearchResult",
        requestId: search?.type === "requestFileSearch" ? search.requestId : "",
        dir: "/repo",
        paths: ["resources/icons/chevron-down.svg"],
        items: [{ path: "resources/icons/chevron-down.svg", type: "file" }],
      })
    }

    // Chats whose titles only scatter the query do not outrank a real filename
    // match, and the focus starts on the best answer.
    expect(mention.mentionResults().at(0)).toEqual({ type: "file", value: "resources/icons/chevron-down.svg" })
    expect(mention.mentionResults().some((item) => item.type === "session")).toBe(false)
    expect(mention.mentionIndex()).toBe(0)
    // Browse files stays on offer, ranked last by a query that ignores it.
    expect(mention.mentionResults().at(-1)).toEqual(FILE_PICKER_RESULT)

    // With nothing else matching, the entry is all that is left and takes focus.
    mention.onInput("@chevronzz", 10)
    for (const handler of handlers) {
      handler({
        type: "fileSearchResult",
        requestId: search?.type === "requestFileSearch" ? search.requestId : "",
        dir: "/repo",
        paths: [],
        items: [],
      })
    }
    expect(mention.mentionResults()).toEqual([FILE_PICKER_RESULT])
    expect(mention.mentionIndex()).toBe(0)

    dispose.fn?.()
  })

  it("keeps the entry on offer when the label is typed in full", async () => {
    const posted: WebviewMessage[] = []
    const handlers = new Set<(message: ExtensionMessage) => void>()
    const ctx = {
      postMessage: (message: WebviewMessage) => posted.push(message),
      onMessage: (handler: (message: ExtensionMessage) => void) => {
        handlers.add(handler)
        return () => handlers.delete(handler)
      },
    }

    const dispose: { fn?: () => void } = {}
    const mention = createRoot((root) => {
      dispose.fn = root
      return useFileMention(ctx, undefined, () => false)
    })

    // The trailing dots belong to the label, so this spaced query is a choice
    // rather than the prose an unanswered spaced query normally means.
    mention.onInput("@browse files...", 16)
    await wait(170)

    const search = posted.findLast((message) => message.type === "requestFileSearch")
    const sessions = posted.find((message) => message.type === "requestSessionSearch")
    for (const handler of handlers) {
      handler({
        type: "fileSearchResult",
        requestId: search?.type === "requestFileSearch" ? search.requestId : "",
        dir: "/repo",
        paths: [],
        items: [],
      })
      handler({
        type: "sessionSearchResult",
        requestId: sessions?.type === "requestSessionSearch" ? sessions.requestId : "",
        sessions: [],
      })
    }

    expect(mention.showMention()).toBe(true)
    expect(mention.mentionResults()).toEqual([FILE_PICKER_RESULT])
    expect(mention.mentionIndex()).toBe(0)

    dispose.fn?.()
  })

  it("ranks a menu entry first when the query names it best", async () => {
    const posted: WebviewMessage[] = []
    const handlers = new Set<(message: ExtensionMessage) => void>()
    const ctx = {
      postMessage: (message: WebviewMessage) => posted.push(message),
      onMessage: (handler: (message: ExtensionMessage) => void) => {
        handlers.add(handler)
        return () => handlers.delete(handler)
      },
    }

    const dispose: { fn?: () => void } = {}
    const mention = createRoot((root) => {
      dispose.fn = root
      return useFileMention(ctx, undefined, () => false)
    })

    mention.onInput("@browse f", 9)
    await wait(170)

    const search = posted.findLast((message) => message.type === "requestFileSearch")
    for (const handler of handlers) {
      handler({
        type: "fileSearchResult",
        requestId: search?.type === "requestFileSearch" ? search.requestId : "",
        dir: "/repo",
        paths: ["src/browser-feedback.ts"],
        items: [{ path: "src/browser-feedback.ts", type: "file" }],
      })
    }

    // "browse f" fits the entry better than the file that merely contains it.
    expect(mention.mentionResults().at(0)).toEqual(FILE_PICKER_RESULT)
    expect(mention.mentionResults().at(1)).toEqual({ type: "file", value: "src/browser-feedback.ts" })
    expect(mention.mentionIndex()).toBe(0)

    dispose.fn?.()
  })

  it("does not move a selection the user made themselves", async () => {
    const posted: WebviewMessage[] = []
    const handlers = new Set<(message: ExtensionMessage) => void>()
    const ctx = {
      postMessage: (message: WebviewMessage) => posted.push(message),
      onMessage: (handler: (message: ExtensionMessage) => void) => {
        handlers.add(handler)
        return () => handlers.delete(handler)
      },
    }

    const dispose: { fn?: () => void } = {}
    const mention = createRoot((root) => {
      dispose.fn = root
      return useFileMention(ctx, undefined, () => false)
    })

    mention.onInput("@browse f", 9)
    await wait(170)

    // The user picks Browse files while the search is still running.
    mention.setMentionIndex(0)

    const search = posted.findLast((message) => message.type === "requestFileSearch")
    for (const handler of handlers) {
      handler({
        type: "fileSearchResult",
        requestId: search?.type === "requestFileSearch" ? search.requestId : "",
        dir: "/repo",
        paths: ["src/browser-feedback.ts"],
        items: [{ path: "src/browser-feedback.ts", type: "file" }],
      })
    }

    expect(mention.mentionResults().at(mention.mentionIndex())).toEqual(FILE_PICKER_RESULT)

    dispose.fn?.()
  })

  it("keeps the selection on a matching chat above the files", async () => {
    const posted: WebviewMessage[] = []
    const handlers = new Set<(message: ExtensionMessage) => void>()
    const ctx = {
      postMessage: (message: WebviewMessage) => posted.push(message),
      onMessage: (handler: (message: ExtensionMessage) => void) => {
        handlers.add(handler)
        return () => handlers.delete(handler)
      },
    }

    const dispose: { fn?: () => void } = {}
    const mention = createRoot((root) => {
      dispose.fn = root
      return useFileMention(ctx, undefined, () => false)
    })

    mention.onInput("@fix auth", 9)
    await wait(170)

    const sessions = posted.find((message) => message.type === "requestSessionSearch")
    const search = posted.findLast((message) => message.type === "requestFileSearch")
    for (const handler of handlers) {
      handler({
        type: "sessionSearchResult",
        requestId: sessions?.type === "requestSessionSearch" ? sessions.requestId : "",
        sessions: [{ id: "ses_a", title: "Fix auth bug", updated: 2 }],
      })
      handler({
        type: "fileSearchResult",
        requestId: search?.type === "requestFileSearch" ? search.requestId : "",
        dir: "/repo",
        paths: ["src/auth.ts"],
        items: [{ path: "src/auth.ts", type: "file" }],
      })
    }

    // The chat title answers this query better than any file does.
    expect(mention.mentionResults().at(mention.mentionIndex())).toMatchObject({
      type: "session",
      value: "Fix auth bug",
    })

    dispose.fn?.()
  })

  it("opens the file picker when Enter confirms a query naming it", async () => {
    const posted: WebviewMessage[] = []
    const handlers = new Set<(message: ExtensionMessage) => void>()
    const ctx = {
      postMessage: (message: WebviewMessage) => posted.push(message),
      onMessage: (handler: (message: ExtensionMessage) => void) => {
        handlers.add(handler)
        return () => handlers.delete(handler)
      },
    }

    const dispose: { fn?: () => void } = {}
    const mention = createRoot((root) => {
      dispose.fn = root
      return useFileMention(ctx, undefined, () => false)
    })

    mention.onInput("@browse files", 13)
    await wait(170)

    // No file is named "browse files", and the chats do not match it either.
    const search = posted.findLast((message) => message.type === "requestFileSearch")
    const sessions = posted.find((message) => message.type === "requestSessionSearch")
    for (const handler of handlers) {
      handler({
        type: "fileSearchResult",
        requestId: search?.type === "requestFileSearch" ? search.requestId : "",
        dir: "/repo",
        paths: [],
        items: [],
      })
      handler({
        type: "sessionSearchResult",
        requestId: sessions?.type === "requestSessionSearch" ? sessions.requestId : "",
        sessions: [],
      })
    }

    // The entry stays on offer instead of being closed away as prose.
    expect(mention.showMention()).toBe(true)
    expect(mention.mentionResults()).toEqual([FILE_PICKER_RESULT])

    const input = editor("@browse files")
    const text = { value: "" }
    mockDocument(input)
    const prevented = { count: 0 }
    const event = { key: "Enter", preventDefault: () => prevented.count++ } as unknown as KeyboardEvent
    try {
      expect(
        mention.onKeyDown(event, input, (value: string) => {
          text.value = value
        }),
      ).toBe(true)

      const picker = posted.findLast((message) => message.type === "requestFilePicker")
      expect(picker).toBeDefined()
      // The picked file replaces the whole typed query, spaces included.
      mention.insertFilePickerResult("/outside/notes.txt", picker?.type === "requestFilePicker" ? picker.requestId : "")
    } finally {
      restoreDocument()
    }

    expect(prevented.count).toBe(1)
    expect(input.value).toBe("@/outside/notes.txt ")
    expect(text.value).toBe("@/outside/notes.txt ")
    expect(mention.mentionedPaths().has("/outside/notes.txt")).toBe(true)

    dispose.fn?.()
  })

  it("lets Enter send the message when a spaced query answers to nothing", async () => {
    const posted: WebviewMessage[] = []
    const ctx = {
      postMessage: (message: WebviewMessage) => posted.push(message),
      onMessage: () => () => {},
    }

    const dispose: { fn?: () => void } = {}
    const mention = createRoot((root) => {
      dispose.fn = root
      return useFileMention(ctx, undefined, () => false)
    })

    // Prose leaves Browse files as the only offer, and it takes the focus for
    // want of anything better — but sending the message still wins over it.
    mention.onInput("@README.md and then", 19)
    expect(mention.mentionResults()).toEqual([FILE_PICKER_RESULT])
    expect(mention.mentionIndex()).toBe(0)

    const prevented = { count: 0 }
    const event = { key: "Enter", preventDefault: () => prevented.count++ } as unknown as KeyboardEvent
    expect(mention.onKeyDown(event, undefined, () => {})).toBe(false)
    expect(prevented.count).toBe(0)

    dispose.fn?.()
  })

  it("seedFromText populates knownPaths so mentions are recognized in pre-filled text", () => {
    const ctx = {
      postMessage: () => {},
      onMessage: () => () => {},
    }

    const dispose: { fn?: () => void } = {}
    const mention = createRoot((root) => {
      dispose.fn = root
      return useFileMention(ctx, undefined, () => false)
    })

    // Before seeding, no paths are known
    expect(mention.mentionedPaths().size).toBe(0)

    // Seed from text containing @mentions (simulates setChatBoxMessage after revert)
    mention.seedFromText("Say hi to @packages/plugin/tsconfig.json !")

    expect(mention.mentionedPaths().has("packages/plugin/tsconfig.json")).toBe(true)

    dispose.fn?.()
  })

  it("seedFromText handles multiple @mentions in one string", () => {
    const ctx = {
      postMessage: () => {},
      onMessage: () => () => {},
    }

    const dispose: { fn?: () => void } = {}
    const mention = createRoot((root) => {
      dispose.fn = root
      return useFileMention(ctx, undefined, () => false)
    })

    mention.seedFromText("check @src/a.ts and @src/b.tsx")

    expect(mention.mentionedPaths().has("src/a.ts")).toBe(true)
    expect(mention.mentionedPaths().has("src/b.tsx")).toBe(true)

    dispose.fn?.()
  })

  it("seedFromText ignores text without @mentions", () => {
    const ctx = {
      postMessage: () => {},
      onMessage: () => () => {},
    }

    const dispose: { fn?: () => void } = {}
    const mention = createRoot((root) => {
      dispose.fn = root
      return useFileMention(ctx, undefined, () => false)
    })

    mention.seedFromText("no mentions here")
    expect(mention.mentionedPaths().size).toBe(0)

    dispose.fn?.()
  })

  it("seedFromText truncates a mention path at the first space (known limitation, see seedFromParts)", () => {
    // Documents why seedFromParts exists: seedFromText re-derives candidate
    // paths from raw text via a regex that stops at whitespace. For a path
    // containing a space, it discovers only the prefix before the space, and
    // that truncated candidate then incorrectly passes syncMentionedPaths'
    // boundary check too, since a real space genuinely follows it in the text.
    const ctx = {
      postMessage: () => {},
      onMessage: () => () => {},
    }

    const dispose: { fn?: () => void } = {}
    const mention = createRoot((root) => {
      dispose.fn = root
      return useFileMention(ctx, undefined, () => false)
    })

    mention.seedFromText("Say hi to @mention-test/my quarterly report.txt !")

    expect(mention.mentionedPaths().has("mention-test/my")).toBe(true)
    expect(mention.mentionedPaths().has("mention-test/my quarterly report.txt")).toBe(false)

    dispose.fn?.()
  })

  it("seedFromParts seeds an exact path correctly even when it contains a space", () => {
    const ctx = {
      postMessage: () => {},
      onMessage: () => () => {},
    }

    const dispose: { fn?: () => void } = {}
    const mention = createRoot((root) => {
      dispose.fn = root
      return useFileMention(ctx, undefined, () => false)
    })

    const text = "Say hi to @mention-test/my quarterly report.txt !"
    mention.seedFromParts(["mention-test/my quarterly report.txt"], text)

    expect(mention.mentionedPaths().has("mention-test/my quarterly report.txt")).toBe(true)
    expect(mention.mentionedPaths().has("mention-test/my")).toBe(false)

    dispose.fn?.()
  })

  it("seedFromParts prunes paths no longer present in the text", () => {
    const ctx = {
      postMessage: () => {},
      onMessage: () => () => {},
    }

    const dispose: { fn?: () => void } = {}
    const mention = createRoot((root) => {
      dispose.fn = root
      return useFileMention(ctx, undefined, () => false)
    })

    mention.seedFromParts(["mention-test/gone.ts"], "no mentions here anymore")

    expect(mention.mentionedPaths().size).toBe(0)

    dispose.fn?.()
  })

  it("seedFromParts seeds multiple exact paths from a single message", () => {
    const ctx = {
      postMessage: () => {},
      onMessage: () => () => {},
    }

    const dispose: { fn?: () => void } = {}
    const mention = createRoot((root) => {
      dispose.fn = root
      return useFileMention(ctx, undefined, () => false)
    })

    const text = "Compare @a data.ts and @b data.ts please"
    mention.seedFromParts(["a data.ts", "b data.ts"], text)

    expect(mention.mentionedPaths().has("a data.ts")).toBe(true)
    expect(mention.mentionedPaths().has("b data.ts")).toBe(true)

    dispose.fn?.()
  })

  it("filters visible results synchronously while a new search is pending", async () => {
    const posted: WebviewMessage[] = []
    const handlers = new Set<(message: ExtensionMessage) => void>()
    const ctx = {
      postMessage: (message: WebviewMessage) => posted.push(message),
      onMessage: (handler: (message: ExtensionMessage) => void) => {
        handlers.add(handler)
        return () => handlers.delete(handler)
      },
    }

    const dispose: { fn?: () => void } = {}
    const mention = createRoot((root) => {
      dispose.fn = root
      return useFileMention(ctx, undefined, () => false)
    })

    mention.onInput("@g", 2)
    await wait(170)

    for (const handler of handlers) {
      handler({
        type: "fileSearchResult",
        requestId: "file-search-1",
        dir: "/repo",
        paths: ["README.md", "src/git.ts"],
        items: [
          { path: "README.md", type: "file" },
          { path: "src/git.ts", type: "file" },
        ],
      })
    }

    mention.onInput("@gi", 3)

    expect(mention.mentionResults()).toEqual([{ type: "file", value: "src/git.ts" }, FILE_PICKER_RESULT])

    dispose.fn?.()
  })

  it("snaps a native forward caret move over a mention", async () => {
    const ctx = {
      postMessage: () => {},
      onMessage: () => () => {},
    }

    const dispose: { fn?: () => void } = {}
    const mention = createRoot((root) => {
      dispose.fn = root
      return useFileMention(ctx, undefined, () => false)
    })

    const text = "See @src/main.ts now"
    mention.addPaths(["src/main.ts"], "/repo")

    const right = key("ArrowRight")
    const input = textarea(text, "See ".length, "ltr")
    expect(mention.handleArrowKey(right.event, input)).toBe(false)
    expect(right.state.prevented).toBe(0)

    const positionAfterArrowRight = "See @".length
    input.setSelectionRange(positionAfterArrowRight, positionAfterArrowRight)
    await wait(0)
    expect(input.selectionStart).toBe("See @src/main.ts".length)

    const left = key("ArrowLeft")
    expect(mention.handleArrowKey(left.event, input)).toBe(false)
    expect(left.state.prevented).toBe(0)

    const positionAfterArrowLeft = "See @src/main.t".length
    input.setSelectionRange(positionAfterArrowLeft, positionAfterArrowLeft)
    await wait(0)
    expect(input.selectionStart).toBe("See ".length)

    dispose.fn?.()
  })

  it("snaps a native right-to-left caret move over a mention", async () => {
    const ctx = {
      postMessage: () => {},
      onMessage: () => () => {},
    }

    const dispose: { fn?: () => void } = {}
    const mention = createRoot((root) => {
      dispose.fn = root
      return useFileMention(ctx, undefined, () => false)
    })

    const text = "فایل @src/main.ts را ببین"
    mention.addPaths(["src/main.ts"], "/repo")

    const left = key("ArrowLeft")
    const input = textarea(text, "فایل ".length, "rtl")
    expect(mention.handleArrowKey(left.event, input)).toBe(false)
    expect(left.state.prevented).toBe(0)

    const positionAfterArrowLeft = "فایل @".length
    input.setSelectionRange(positionAfterArrowLeft, positionAfterArrowLeft)
    await wait(0)
    expect(input.selectionStart).toBe("فایل @src/main.ts".length)

    const right = key("ArrowRight")
    expect(mention.handleArrowKey(right.event, input)).toBe(false)
    expect(right.state.prevented).toBe(0)

    const positionAfterArrowRight = "فایل @src/main.t".length
    input.setSelectionRange(positionAfterArrowRight, positionAfterArrowRight)
    await wait(0)
    expect(input.selectionStart).toBe("فایل ".length)

    dispose.fn?.()
  })

  it("resolves a pending arrow snap before the next native arrow move", async () => {
    const ctx = {
      postMessage: () => {},
      onMessage: () => () => {},
    }

    const dispose: { fn?: () => void } = {}
    const mention = createRoot((root) => {
      dispose.fn = root
      return useFileMention(ctx, undefined, () => false)
    })

    const text = "See @src/main.ts now"
    mention.addPaths(["src/main.ts"], "/repo")

    const right = key("ArrowRight")
    const input = textarea(text, "See ".length, "ltr")
    expect(mention.handleArrowKey(right.event, input)).toBe(false)

    const pos = "See @".length
    input.setSelectionRange(pos, pos)
    expect(mention.handleArrowKey(right.event, input)).toBe(false)

    const end = "See @src/main.ts".length
    expect(input.selectionStart).toBe(end)

    input.setSelectionRange(end + 1, end + 1)
    await wait(0)
    expect(input.selectionStart).toBe(end + 1)

    dispose.fn?.()
  })

  it("shrinks a left-to-right shift selection across a mention", async () => {
    const ctx = {
      postMessage: () => {},
      onMessage: () => () => {},
    }

    const dispose: { fn?: () => void } = {}
    const mention = createRoot((root) => {
      dispose.fn = root
      return useFileMention(ctx, undefined, () => false)
    })

    const path = "README.md"
    const text = `A @${path} B`
    const start = text.indexOf("@")
    const end = start + path.length + 1
    mention.addPaths([path], "/repo")

    const input = textarea(text, end - 1, "ltr", { end: text.length, direction: "backward" })
    mention.snapSelection(input)
    expect(input.selectionStart).toBe(start)
    expect(input.selectionEnd).toBe(text.length)

    input.setSelectionRange(start + 1, text.length, "backward")
    mention.snapSelection(input)
    expect(input.selectionStart).toBe(end)
    expect(input.selectionEnd).toBe(text.length)
    expect(input.selectionDirection).toBe("backward")

    dispose.fn?.()
  })

  it("shrinks a right-to-left shift selection across a mention", async () => {
    const ctx = {
      postMessage: () => {},
      onMessage: () => () => {},
    }

    const dispose: { fn?: () => void } = {}
    const mention = createRoot((root) => {
      dispose.fn = root
      return useFileMention(ctx, undefined, () => false)
    })

    const path = "README.md"
    const text = `ی @${path} س`
    const start = text.indexOf("@")
    const end = start + path.length + 1
    mention.addPaths([path], "/repo")

    const input = textarea(text, end - 1, "rtl", { end: text.length, direction: "backward" })
    mention.snapSelection(input)
    expect(input.selectionStart).toBe(start)
    expect(input.selectionEnd).toBe(text.length)

    input.setSelectionRange(start + 1, text.length, "backward")
    mention.snapSelection(input)
    expect(input.selectionStart).toBe(end)
    expect(input.selectionEnd).toBe(text.length)
    expect(input.selectionDirection).toBe("backward")

    dispose.fn?.()
  })

  it("selecting file picker sends requestFilePicker and stores state", async () => {
    const posted: WebviewMessage[] = []
    const ctx = {
      postMessage: (message: WebviewMessage) => posted.push(message),
      onMessage: () => () => {},
    }

    const dispose: { fn?: () => void } = {}
    const mention = createRoot((root) => {
      dispose.fn = root
      return useFileMention(ctx, undefined, () => false)
    })

    const state = { value: "hello @b", cursor: 8 }
    const input = {
      value: state.value,
      get selectionStart() {
        return state.cursor
      },
      get selectionEnd() {
        return state.cursor
      },
      isConnected: true,
      setSelectionRange: (start: number, end: number) => {
        state.cursor = end
      },
      focus: () => {},
    } as unknown as HTMLTextAreaElement

    let execCalled = false
    mockDocument()
    globalThis.document.execCommand = () => {
      execCalled = true
      return true
    }

    try {
      mention.selectMention(
        { type: "file-picker", value: "file-picker", label: "Browse", description: "" },
        input,
        () => {},
      )
    } finally {
      restoreDocument()
    }

    expect(posted).toEqual([{ type: "requestFilePicker", requestId: expect.any(String) }])
    expect(execCalled).toBe(false)

    dispose.fn?.()
  })

  it("insertFilePickerResult inserts the path at the stored position", () => {
    const posted: WebviewMessage[] = []
    const ctx = {
      postMessage: (message: WebviewMessage) => posted.push(message),
      onMessage: () => () => {},
    }

    const dispose: { fn?: () => void } = {}
    const mention = createRoot((root) => {
      dispose.fn = root
      return useFileMention(ctx, undefined, () => false)
    })

    const state = { value: "hello @b", cursor: 8, textSet: "" }
    const input = {
      get value() {
        return state.value
      },
      get selectionStart() {
        return state.cursor
      },
      get selectionEnd() {
        return state.cursor
      },
      isConnected: true,
      setSelectionRange: (start: number, end: number) => {
        state.value = state.value.slice(0, start) + state.value.slice(end)
        state.cursor = start
      },
      focus: () => {},
    } as unknown as HTMLTextAreaElement

    mockDocument()
    globalThis.document.execCommand = (_cmd: string, _show: boolean, val: string) => {
      state.value = state.value.slice(0, state.cursor) + val + state.value.slice(state.cursor)
      state.cursor = state.cursor + val.length
      return true
    }

    try {
      mention.selectMention(
        { type: "file-picker", value: "file-picker", label: "Browse", description: "" },
        input,
        (text: string) => {
          state.textSet = text
        },
      )
      const requestId = (posted.at(-1) as { requestId: string }).requestId
      mention.insertFilePickerResult("/outside/file.ts", requestId)
    } finally {
      restoreDocument()
    }

    expect(state.value).toBe("hello @/outside/file.ts ")
    expect(mention.mentionedPaths().has("/outside/file.ts")).toBe(true)
    expect(state.textSet).toBe("hello @/outside/file.ts ")

    dispose.fn?.()
  })

  it("insertFilePickerResult normalizes Windows backslashes to forward slashes", () => {
    const posted: WebviewMessage[] = []
    const ctx = {
      postMessage: (message: WebviewMessage) => posted.push(message),
      onMessage: () => () => {},
    }

    const dispose: { fn?: () => void } = {}
    const mention = createRoot((root) => {
      dispose.fn = root
      return useFileMention(ctx, undefined, () => false)
    })

    const state = { value: "hello @b", cursor: 8, textSet: "" }
    const input = {
      get value() {
        return state.value
      },
      get selectionStart() {
        return state.cursor
      },
      get selectionEnd() {
        return state.cursor
      },
      isConnected: true,
      setSelectionRange: (start: number, end: number) => {
        state.value = state.value.slice(0, start) + state.value.slice(end)
        state.cursor = start
      },
      focus: () => {},
    } as unknown as HTMLTextAreaElement

    mockDocument()
    globalThis.document.execCommand = (_cmd: string, _show: boolean, val: string) => {
      state.value = state.value.slice(0, state.cursor) + val + state.value.slice(state.cursor)
      state.cursor = state.cursor + val.length
      return true
    }

    try {
      mention.selectMention(
        { type: "file-picker", value: "file-picker", label: "Browse", description: "" },
        input,
        (text: string) => {
          state.textSet = text
        },
      )
      const requestId = (posted.at(-1) as { requestId: string }).requestId
      mention.insertFilePickerResult("C:\\Users\\file.ts", requestId)
    } finally {
      restoreDocument()
    }

    expect(state.value).toBe("hello @C:/Users/file.ts ")
    expect(mention.mentionedPaths().has("C:/Users/file.ts")).toBe(true)

    dispose.fn?.()
  })

  it("insertFilePickerResult with empty path cleans up state", () => {
    const posted: WebviewMessage[] = []
    const ctx = {
      postMessage: (message: WebviewMessage) => posted.push(message),
      onMessage: () => () => {},
    }

    const dispose: { fn?: () => void } = {}
    const mention = createRoot((root) => {
      dispose.fn = root
      return useFileMention(ctx, undefined, () => false)
    })

    const input = {
      value: "hello @b",
      selectionStart: 8,
      selectionEnd: 8,
      isConnected: true,
      setSelectionRange: () => {},
      focus: () => {},
    } as unknown as HTMLTextAreaElement

    mention.selectMention(
      { type: "file-picker", value: "file-picker", label: "Browse", description: "" },
      input,
      () => {},
    )
    const requestId = (posted.at(-1) as { requestId: string }).requestId
    mention.insertFilePickerResult("", requestId)

    expect(input.value).toBe("hello @b")

    dispose.fn?.()
  })

  it("insertFilePickerResult ignores a result whose requestId doesn't match the pending request", () => {
    const posted: WebviewMessage[] = []
    const ctx = {
      postMessage: (message: WebviewMessage) => posted.push(message),
      onMessage: () => () => {},
    }

    const dispose: { fn?: () => void } = {}
    const mention = createRoot((root) => {
      dispose.fn = root
      return useFileMention(ctx, undefined, () => false)
    })

    const input = {
      value: "hello @b",
      selectionStart: 8,
      selectionEnd: 8,
      isConnected: true,
      setSelectionRange: () => {},
      focus: () => {},
    } as unknown as HTMLTextAreaElement

    mention.selectMention(
      { type: "file-picker", value: "file-picker", label: "Browse", description: "" },
      input,
      () => {},
    )
    mention.insertFilePickerResult("/outside/file.ts", "stale-request-id")

    expect(input.value).toBe("hello @b")
    expect(mention.mentionedPaths().has("/outside/file.ts")).toBe(false)

    dispose.fn?.()
  })

  it("renders cached files instantly when opening @ with empty query", () => {
    const posted: WebviewMessage[] = []
    const handlers = new Set<(message: ExtensionMessage) => void>()
    const ctx = {
      postMessage: (message: WebviewMessage) => posted.push(message),
      onMessage: (handler: (message: ExtensionMessage) => void) => {
        handlers.add(handler)
        return () => handlers.delete(handler)
      },
    }

    const dispose: { fn?: () => void } = {}
    const mention = createRoot((root) => {
      dispose.fn = root
      return useFileMention(ctx, undefined, () => false)
    })
    mention.onInput("@", 1)
    const refresh = posted.at(-1)
    expect(refresh?.type).toBe("requestFileSearch")
    for (const handler of handlers) {
      handler({
        type: "fileSearchResult",
        requestId: refresh?.type === "requestFileSearch" ? refresh.requestId : "",
        dir: "/repo",
        paths: ["src/index.ts", "package.json"],
        items: [
          { path: "src/index.ts", type: "opened-file" },
          { path: "package.json", type: "file" },
        ],
      })
    }

    expect(mention.mentionResults()).toEqual([
      { type: "terminal", value: "terminal", label: "Terminal", description: "Active terminal output" },
      { type: "past-chats", value: "past-chats", label: "Past chats", description: "Search previous sessions" },
      FILE_PICKER_RESULT,
      { type: "opened-file", value: "src/index.ts" },
      { type: "file", value: "package.json" },
    ])

    // Close mention and reopen @ - should still be instant
    mention.closeMention()
    expect(mention.mentionResults().length).toBe(0)

    mention.onInput("@", 1)
    expect(mention.mentionResults()).toEqual([
      { type: "terminal", value: "terminal", label: "Terminal", description: "Active terminal output" },
      { type: "past-chats", value: "past-chats", label: "Past chats", description: "Search previous sessions" },
      FILE_PICKER_RESULT,
      { type: "opened-file", value: "src/index.ts" },
      { type: "file", value: "package.json" },
    ])

    dispose.fn?.()
  })

  it("replaces deleted cached files when an empty refresh completes", () => {
    const posted: WebviewMessage[] = []
    const handlers = new Set<(message: ExtensionMessage) => void>()
    const ctx = {
      postMessage: (message: WebviewMessage) => posted.push(message),
      onMessage: (handler: (message: ExtensionMessage) => void) => {
        handlers.add(handler)
        return () => handlers.delete(handler)
      },
    }

    const dispose: { fn?: () => void } = {}
    const mention = createRoot((root) => {
      dispose.fn = root
      return useFileMention(ctx, undefined, () => false)
    })
    mention.onInput("@", 1)
    const prewarm = posted.at(-1)
    expect(prewarm?.type).toBe("requestFileSearch")
    for (const handler of handlers) {
      handler({
        type: "fileSearchResult",
        requestId: prewarm?.type === "requestFileSearch" ? prewarm.requestId : "",
        dir: "/repo",
        paths: ["deleted.ts"],
        items: [{ path: "deleted.ts", type: "file" }],
      })
    }

    expect(mention.mentionResults()).toContainEqual({ type: "file", value: "deleted.ts" })
    mention.closeMention()
    mention.onInput("@", 1)
    expect(mention.mentionResults()).toContainEqual({ type: "file", value: "deleted.ts" })
    const refresh = posted.at(-1)
    expect(refresh?.type).toBe("requestFileSearch")
    for (const handler of handlers) {
      handler({
        type: "fileSearchResult",
        requestId: refresh?.type === "requestFileSearch" ? refresh.requestId : "",
        dir: "/repo",
        paths: [],
        items: [],
      })
    }

    expect(mention.mentionResults()).not.toContainEqual({ type: "file", value: "deleted.ts" })
    mention.closeMention()
    mention.onInput("@", 1)
    expect(mention.mentionResults()).not.toContainEqual({ type: "file", value: "deleted.ts" })

    dispose.fn?.()
  })

  it("does not reuse cached files after switching sessions", () => {
    const posted: WebviewMessage[] = []
    const handlers = new Set<(message: ExtensionMessage) => void>()
    const ctx = {
      postMessage: (message: WebviewMessage) => posted.push(message),
      onMessage: (handler: (message: ExtensionMessage) => void) => {
        handlers.add(handler)
        return () => handlers.delete(handler)
      },
    }

    const dispose: { fn?: () => void } = {}
    const state = createRoot((root) => {
      dispose.fn = root
      const [session, setSession] = createSignal("session-a")
      return { mention: useFileMention(ctx, session, () => false), setSession }
    })
    state.mention.onInput("@", 1)
    const first = posted.at(-1)
    expect(first).toMatchObject({ type: "requestFileSearch", sessionID: "session-a" })
    for (const handler of handlers) {
      handler({
        type: "fileSearchResult",
        requestId: first?.type === "requestFileSearch" ? first.requestId : "",
        dir: "/repo-a",
        paths: ["only-a.ts"],
        items: [{ path: "only-a.ts", type: "file" }],
      })
    }

    state.mention.closeMention()
    state.setSession("session-b")
    state.mention.onInput("@", 1)

    expect(state.mention.mentionResults()).not.toContainEqual({ type: "file", value: "only-a.ts" })
    expect(posted.at(-1)).toMatchObject({ type: "requestFileSearch", sessionID: "session-b", query: "" })

    dispose.fn?.()
  })

  it("bounds remembered session directories", () => {
    const posted: WebviewMessage[] = []
    const handlers = new Set<(message: ExtensionMessage) => void>()
    const ctx = {
      postMessage: (message: WebviewMessage) => posted.push(message),
      onMessage: (handler: (message: ExtensionMessage) => void) => {
        handlers.add(handler)
        return () => handlers.delete(handler)
      },
    }

    const dispose: { fn?: () => void } = {}
    const state = createRoot((root) => {
      dispose.fn = root
      const [session, setSession] = createSignal("session-0")
      return { mention: useFileMention(ctx, session, () => false), setSession }
    })

    const reply = (request: WebviewMessage | undefined, dir: string) => {
      for (const handler of handlers) {
        handler({
          type: "fileSearchResult",
          requestId: request?.type === "requestFileSearch" ? request.requestId : "",
          dir,
          paths: [],
          items: [],
        })
      }
    }

    state.mention.onInput("@", 1)
    reply(posted.at(-1), "/repo/0")
    for (let index = 1; index <= 8; index++) {
      state.mention.closeMention()
      state.setSession(`session-${index}`)
      state.mention.onInput("@", 1)
      reply(posted.at(-1), `/repo/${index}`)
    }

    state.mention.closeMention()
    state.setSession("session-0")
    state.mention.onInput("@", 1)

    expect(state.mention.mentionResults()).toEqual([
      { type: "terminal", value: "terminal", label: "Terminal", description: "Active terminal output" },
      { type: "past-chats", value: "past-chats", label: "Past chats", description: "Search previous sessions" },
      FILE_PICKER_RESULT,
    ])

    dispose.fn?.()
  })

  it("preserves the highlighted file when fresh results replace cached results", () => {
    const posted: WebviewMessage[] = []
    const handlers = new Set<(message: ExtensionMessage) => void>()
    const ctx = {
      postMessage: (message: WebviewMessage) => posted.push(message),
      onMessage: (handler: (message: ExtensionMessage) => void) => {
        handlers.add(handler)
        return () => handlers.delete(handler)
      },
    }

    const dispose: { fn?: () => void } = {}
    const mention = createRoot((root) => {
      dispose.fn = root
      return useFileMention(ctx, undefined, () => false)
    })
    mention.onInput("@", 1)
    const prewarm = posted.at(-1)
    for (const handler of handlers) {
      handler({
        type: "fileSearchResult",
        requestId: prewarm?.type === "requestFileSearch" ? prewarm.requestId : "",
        dir: "/repo",
        paths: ["a.ts", "b.ts"],
        items: [
          { path: "a.ts", type: "file" },
          { path: "b.ts", type: "file" },
        ],
      })
    }
    mention.closeMention()
    mention.onInput("@", 1)
    const selected = mention.mentionResults().findIndex((item) => item.type === "file" && item.value === "b.ts")
    mention.setMentionIndex(selected)

    const refresh = posted.at(-1)
    for (const handler of handlers) {
      handler({
        type: "fileSearchResult",
        requestId: refresh?.type === "requestFileSearch" ? refresh.requestId : "",
        dir: "/repo",
        paths: ["new.ts", "b.ts"],
        items: [
          { path: "new.ts", type: "file" },
          { path: "b.ts", type: "file" },
        ],
      })
    }

    expect(mention.mentionResults()[mention.mentionIndex()]).toEqual({ type: "file", value: "b.ts" })

    dispose.fn?.()
  })

  it("ignores a response after the query changes", async () => {
    const posted: WebviewMessage[] = []
    const handlers = new Set<(message: ExtensionMessage) => void>()
    const ctx = {
      postMessage: (message: WebviewMessage) => posted.push(message),
      onMessage: (handler: (message: ExtensionMessage) => void) => {
        handlers.add(handler)
        return () => handlers.delete(handler)
      },
    }

    const dispose: { fn?: () => void } = {}
    const mention = createRoot((root) => {
      dispose.fn = root
      return useFileMention(ctx, undefined, () => false)
    })

    mention.onInput("@old", 4)
    await wait(170)
    const old = posted.at(-1)
    expect(old).toMatchObject({ type: "requestFileSearch", query: "old" })
    mention.onInput("@new", 4)

    for (const handler of handlers) {
      handler({
        type: "fileSearchResult",
        requestId: old?.type === "requestFileSearch" ? old.requestId : "",
        dir: "/repo",
        paths: ["old.ts"],
        items: [{ path: "old.ts", type: "file" }],
      })
    }

    expect(mention.mentionResults()).not.toContainEqual({ type: "file", value: "old.ts" })

    dispose.fn?.()
  })

  it("ignores a response after closing the mention menu", () => {
    const posted: WebviewMessage[] = []
    const handlers = new Set<(message: ExtensionMessage) => void>()
    const ctx = {
      postMessage: (message: WebviewMessage) => posted.push(message),
      onMessage: (handler: (message: ExtensionMessage) => void) => {
        handlers.add(handler)
        return () => handlers.delete(handler)
      },
    }

    const dispose: { fn?: () => void } = {}
    const mention = createRoot((root) => {
      dispose.fn = root
      return useFileMention(ctx, undefined, () => false)
    })

    mention.onInput("@", 1)
    const request = posted.at(-1)
    mention.closeMention()
    for (const handler of handlers) {
      handler({
        type: "fileSearchResult",
        requestId: request?.type === "requestFileSearch" ? request.requestId : "",
        dir: "/repo",
        paths: ["late.ts"],
        items: [{ path: "late.ts", type: "file" }],
      })
    }
    mention.onInput("@", 1)

    expect(mention.mentionResults()).not.toContainEqual({ type: "file", value: "late.ts" })

    dispose.fn?.()
  })
})
