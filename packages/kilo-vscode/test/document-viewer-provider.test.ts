import { afterEach, describe, expect, test } from "bun:test"
import * as vscode from "vscode"
import { DocumentViewerProvider } from "../src/DocumentViewerProvider"

interface FakePanel {
  viewColumn: number
  iconPath?: unknown
  webview: {
    html: string
    cspSource: string
    asWebviewUri: (uri: { toString(): string }) => { toString(): string }
    postMessage: (message: unknown) => Promise<boolean>
    onDidReceiveMessage: (listener: (message: Record<string, unknown>) => void) => { dispose: () => void }
  }
  onDidDispose: (listener: () => void) => { dispose: () => void }
  reveal: () => void
  dispose: () => void
}

function panel() {
  const messages: Record<string, unknown>[] = []
  let receive: ((message: Record<string, unknown>) => void) | undefined
  let disposed: (() => void) | undefined
  const value: FakePanel = {
    viewColumn: 1,
    webview: {
      html: "",
      cspSource: "csp",
      asWebviewUri: (uri) => uri,
      postMessage: async (message) => {
        messages.push(message as Record<string, unknown>)
        return true
      },
      onDidReceiveMessage: (listener) => {
        receive = listener
        return { dispose: () => undefined }
      },
    },
    onDidDispose: (listener) => {
      disposed = listener
      return { dispose: () => undefined }
    },
    reveal: () => undefined,
    dispose: () => disposed?.(),
  }
  return { value, messages, receive: () => receive, dispose: () => disposed?.() }
}

function extension() {
  return {
    extensionUri: vscode.Uri.file("/extension"),
    extension: { packageJSON: { version: "test" } },
  } as unknown as vscode.ExtensionContext
}

const original = (vscode.window as unknown as { createWebviewPanel?: unknown }).createWebviewPanel
const windowMock = vscode.window as unknown as { createWebviewPanel: () => FakePanel }

afterEach(() => {
  ;(vscode.window as unknown as { createWebviewPanel?: unknown }).createWebviewPanel = original
})

describe("DocumentViewerProvider", () => {
  test("keeps only the newest open before the webview is ready and flushes it once", () => {
    const fake = panel()
    windowMock.createWebviewPanel = () => fake.value
    const provider = new DocumentViewerProvider({ extension: extension(), directory: "/repo", onComments: () => {} })

    provider.open({ file: "a.md", sessionId: "s1", directory: "/repo" })
    provider.open({ file: "b.md", sessionId: "s2", directory: "/repo" })
    expect(fake.messages).toEqual([])

    fake.receive()?.({ type: "webviewReady" })
    expect(fake.messages).toEqual([
      { type: "document.open", file: "b.md", sessionId: "s2", directory: "/repo", contextKey: "s2:/repo" },
    ])

    fake.receive()?.({ type: "webviewReady" })
    expect(fake.messages).toHaveLength(1)
    provider.dispose()
  })

  test("posts directly once the webview is ready", () => {
    const fake = panel()
    windowMock.createWebviewPanel = () => fake.value
    const provider = new DocumentViewerProvider({ extension: extension(), directory: "/repo", onComments: () => {} })

    provider.open({ file: "a.md", sessionId: "s1", directory: "/repo" })
    fake.receive()?.({ type: "webviewReady" })
    provider.open({ file: "b.md", sessionId: "s1", directory: "/repo" })

    expect(fake.messages.map((message) => message.file)).toEqual(["a.md", "b.md"])
    provider.dispose()
  })
})
