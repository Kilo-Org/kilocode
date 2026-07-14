import { describe, expect, it } from "bun:test"
import { createRoot } from "solid-js"
import { useFileMention } from "../../webview-ui/src/hooks/useFileMention"
import { FILE_PICKER_RESULT } from "../../webview-ui/src/hooks/file-mention-utils"
import type { ExtensionMessage, WebviewMessage } from "../../webview-ui/src/types/messages"

declare global {
  // eslint-disable-next-line no-var
  var document: { execCommand: (commandId: string, showUI?: boolean, value?: string) => boolean }
}

const hadDoc = "document" in globalThis
const originalDoc = hadDoc ? globalThis.document : undefined

function mockDocument() {
  globalThis.document = { execCommand: () => true }
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
})
