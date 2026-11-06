import { afterEach, describe, expect, test } from "bun:test"
import * as vscode from "vscode"
import { DiffVirtualProvider } from "../src/DiffVirtualProvider"

type Listener<T> = (value: T) => void

function fakePanel() {
  const messages: Record<string, unknown>[] = []
  const state = { created: 0, revealed: 0, title: "" }
  let receive: Listener<Record<string, unknown>> | undefined
  let disposed: (() => void) | undefined
  const value = {
    get title() {
      return state.title
    },
    set title(next: string) {
      state.title = next
    },
    iconPath: undefined as unknown,
    webview: {
      html: "",
      cspSource: "csp",
      asWebviewUri: (uri: vscode.Uri) => uri,
      postMessage: async (message: unknown) => {
        messages.push(message as Record<string, unknown>)
        return true
      },
      onDidReceiveMessage: (listener: Listener<Record<string, unknown>>) => {
        receive = listener
        return { dispose: () => undefined }
      },
    },
    onDidDispose: (listener: () => void) => {
      disposed = listener
      return { dispose: () => undefined }
    },
    reveal: () => {
      state.revealed++
    },
    dispose: () => disposed?.(),
  }
  return { value, messages, state, send: (message: Record<string, unknown>) => receive?.(message) }
}

const windowMock = vscode.window as unknown as { createWebviewPanel?: unknown }
const original = windowMock.createWebviewPanel

afterEach(() => {
  windowMock.createWebviewPanel = original
})

function setup() {
  const panel = fakePanel()
  windowMock.createWebviewPanel = (_type: string, title: string) => {
    panel.state.created++
    panel.state.title = title
    return panel.value
  }
  return { panel, provider: new DiffVirtualProvider(vscode.Uri.file("/extension")) }
}

const diff = (file: string) => ({ file, patch: `@@ -1 +1 @@\n-a\n+${file}\n`, additions: 1, deletions: 1 })

describe("DiffVirtualProvider", () => {
  test("sends one file once the webview is ready", () => {
    const h = setup()
    h.provider.open(diff("src/a.ts"))
    expect(h.panel.messages).toEqual([])

    h.panel.send({ type: "webviewReady" })

    expect(h.panel.state.title).toBe("Changes: a.ts")
    expect(h.panel.messages).toHaveLength(1)
    expect(h.panel.messages[0]).toMatchObject({ type: "diffVirtual.data", diff: { file: "src/a.ts", additions: 1 } })
    h.provider.dispose()
  })

  test("stacks several files in one panel", () => {
    const h = setup()
    h.provider.openMany([diff("a.ts"), diff("b.ts")])
    h.panel.send({ type: "webviewReady" })

    expect(h.panel.state.title).toBe("Changes: 2 files")
    const data = h.panel.messages[0] as { diff: { files: Array<{ file: string }> } }
    expect(data.diff.files.map((item) => item.file)).toEqual(["a.ts", "b.ts"])
    h.provider.dispose()
  })

  test("reuses the open panel for the next tool diff", () => {
    const h = setup()
    h.provider.open(diff("a.ts"))
    h.panel.send({ type: "webviewReady" })
    h.provider.open(diff("b.ts"))

    expect(h.panel.state.created).toBe(1)
    expect(h.panel.state.revealed).toBe(1)
    expect(h.panel.state.title).toBe("Changes: b.ts")
    expect(h.panel.messages.map((item) => (item.diff as { file: string }).file)).toEqual(["a.ts", "b.ts"])
    h.provider.dispose()
  })

  test("opens a new panel after the user closes it", () => {
    const h = setup()
    h.provider.open(diff("a.ts"))
    h.panel.value.dispose()
    h.provider.open(diff("b.ts"))

    expect(h.panel.state.created).toBe(2)
    h.provider.dispose()
  })

  test("ignores an empty list", () => {
    const h = setup()
    h.provider.openMany([])

    expect(h.panel.state.created).toBe(0)
    h.provider.dispose()
  })
})
