import { describe, expect, it } from "bun:test"
import { createRoot } from "solid-js"
import { useFileMention } from "../../webview-ui/src/hooks/useFileMention"
import type { ExtensionMessage, WebviewMessage } from "../../webview-ui/src/types/messages"

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function textarea(value: string, cursor: number, dir: "ltr" | "rtl") {
  const state = { cursor }
  return {
    value,
    get selectionStart() {
      return state.cursor
    },
    get selectionEnd() {
      return state.cursor
    },
    matches: (selector: string) => selector === `:dir(${dir})`,
    setSelectionRange: (start: number) => {
      state.cursor = start
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

    expect(mention.mentionResults()).toEqual([{ type: "opened-file", value: "packages/kilo-vscode/src/extension.ts" }])

    mention.onInput("@ex", 3)

    expect(mention.mentionResults()).toEqual([{ type: "opened-file", value: "packages/kilo-vscode/src/extension.ts" }])

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

    expect(mention.mentionResults()).toEqual([])

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

    expect(mention.mentionResults()).toEqual([{ type: "file", value: "src/git.ts" }])

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
})
