import { describe, expect, it } from "bun:test"
import { createRoot } from "solid-js"
import { useFileMention } from "../../webview-ui/src/hooks/useFileMention"
import type { ExtensionMessage, WebviewMessage } from "../../webview-ui/src/types/messages"

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

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
        paths: ["sdks/vscode/src/extension.ts"],
        items: [{ path: "sdks/vscode/src/extension.ts", type: "opened-file" }],
      })
    }

    expect(mention.mentionResults()).toEqual([{ type: "opened-file", value: "sdks/vscode/src/extension.ts" }])

    mention.onInput("@ex", 3)

    expect(mention.mentionResults()).toEqual([{ type: "opened-file", value: "sdks/vscode/src/extension.ts" }])

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
})
