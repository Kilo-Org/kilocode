import { afterEach, describe, expect, test } from "bun:test"
import * as vscode from "vscode"
import { wire } from "../src/chat"
import type { ToHost, ToWebview } from "../src/protocol"
import type { Manager } from "../src/server"
// Each webview opens its own event stream. Two wires must not share a bridge, a request map or a stream: otherwise a
// chunk for one tab would reach the other, and both tabs start their request ids at 1.
const encoder = new TextEncoder()

function fakeWebview() {
  const receivers: Array<(message: ToHost) => void> = []
  const sent: ToWebview[] = []
  const ended = Promise.withResolvers<void>()
  return {
    sent,
    webview: {
      options: {},
      html: "",
      cspSource: "vscode-webview:",
      onDidReceiveMessage: (callback: (message: ToHost) => void) => {
        receivers.push(callback)
        return { dispose: () => undefined }
      },
      postMessage: async (message: ToWebview) => {
        sent.push(message)
        if (message.type === "end" || message.type === "error") ended.resolve()
        return true
      },
      asWebviewUri: (uri: unknown) => uri,
    },
    receive: (message: ToHost) => receivers.forEach((callback) => callback(message)),
    ended: ended.promise,
  }
}

const context = {
  extensionUri: vscode.Uri.file("/ext"),
  extensionPath: "/ext",
  globalStorageUri: vscode.Uri.file("/storage"),
  globalState: { get: (_key: string, fallback?: unknown) => fallback, update: async () => undefined },
  workspaceState: { get: () => undefined, update: async () => undefined },
  extension: { packageJSON: { version: "test" } },
} as unknown as vscode.ExtensionContext

const chunks = (sent: ToWebview[]) =>
  sent.flatMap((message) => (message.type === "chunk" ? [new TextDecoder().decode(message.data)] : []))

let upstream: ReturnType<typeof Bun.serve> | undefined
const workspace = vscode.workspace as unknown as { isTrusted?: boolean }
const originalTrusted = workspace.isTrusted

afterEach(() => {
  upstream?.stop(true)
  upstream = undefined
  workspace.isTrusted = originalTrusted
})

describe("chat panel event streams", () => {
  test("two wires stream their own session to their own webview, concurrently", async () => {
    // Both requests must be open at the same time before either response is written, so a shared stream would mix them.
    const open = Promise.withResolvers<void>()
    const streams = { count: 0 }
    upstream = Bun.serve({
      port: 0,
      fetch(request) {
        const session = new URL(request.url).searchParams.get("session") ?? ""
        streams.count++
        if (streams.count === 2) open.resolve()
        return new Response(
          new ReadableStream({
            async start(controller) {
              await open.promise
              controller.enqueue(encoder.encode(`data: ${session}\n\n`))
              controller.close()
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        )
      },
    })
    const server = {
      get: async () => ({ url: `http://127.0.0.1:${upstream?.port}`, authorization: "Basic test" }),
    } as unknown as Manager
    const a = fakeWebview()
    const b = fakeWebview()
    const surfaceA = wire({
      context,
      server,
      directory: "/repo",
      webview: a.webview as never,
      view: "chat",
      surface: "editor",
      sessionID: "ses_a",
    })
    const surfaceB = wire({
      context,
      server,
      directory: "/repo",
      webview: b.webview as never,
      view: "chat",
      surface: "editor",
      sessionID: "ses_b",
    })

    a.receive({ type: "fetch", id: 1, path: "/api/event?session=ses_a", method: "GET", headers: [] })
    b.receive({ type: "fetch", id: 1, path: "/api/event?session=ses_b", method: "GET", headers: [] })
    await Promise.all([a.ended, b.ended])
    surfaceA.dispose()
    surfaceB.dispose()

    expect(chunks(a.sent)).toEqual(["data: ses_a\n\n"])
    expect(chunks(b.sent)).toEqual(["data: ses_b\n\n"])
    expect(a.sent.some((message) => message.type === "error")).toBe(false)
    expect(b.sent.some((message) => message.type === "error")).toBe(false)
  })

  test("a chat tab opens a web link for the session it shows", () => {
    workspace.isTrusted = true
    const opened: Array<[string, string]> = []
    const web = fakeWebview()
    const surface = wire({
      context,
      server: { get: () => Promise.reject(new Error("no server in this test")) } as unknown as Manager,
      directory: "/repo",
      webview: web.webview as never,
      view: "chat",
      surface: "editor",
      sessionID: "ses_a",
      session: () => "ses_tab",
      openBrowser: (session, url) => {
        opened.push([session, url])
        return true
      },
    })

    web.receive({ type: "open", url: "https://kilo.ai/docs" })
    surface.dispose()
    expect(opened).toEqual([["ses_tab", "https://kilo.ai/docs"]])
  })
})
