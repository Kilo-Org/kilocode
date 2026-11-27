import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import * as vscode from "vscode"
import { wire } from "../src/chat"
import { profile } from "../src/profile-panel"
import type { ToHost, ToWebview } from "../src/protocol"
import type { Manager } from "../src/server"

const window = vscode.window as unknown as Record<string, unknown>
const commands = vscode.commands as unknown as Record<string, unknown>
const original = {
  create: window.createWebviewPanel,
  serializer: window.registerWebviewPanelSerializer,
  execute: commands.executeCommand,
}

function fakePanel() {
  const disposers: Array<() => void> = []
  const receivers: Array<(message: ToHost) => void> = []
  const posted: ToWebview[] = []
  const panel = {
    reveals: 0,
    posted,
    receive: (message: ToHost) => receivers.forEach((callback) => callback(message)),
    iconPath: undefined as unknown,
    webview: {
      options: {},
      html: "",
      cspSource: "vscode-webview:",
      onDidReceiveMessage: (callback: (message: ToHost) => void) => {
        receivers.push(callback)
        return { dispose: () => undefined }
      },
      postMessage: async (message: ToWebview) => {
        posted.push(message)
        return true
      },
      asWebviewUri: (uri: unknown) => uri,
    },
    reveal: () => {
      panel.reveals++
    },
    onDidDispose: (callback: () => void) => {
      disposers.push(callback)
      return { dispose: () => undefined }
    },
    dispose: () => disposers.forEach((callback) => callback()),
  }
  return panel
}

const context = {
  extensionUri: vscode.Uri.file("/ext"),
  extensionPath: "/ext",
  globalStorageUri: vscode.Uri.file("/storage"),
  globalState: { get: (_key: string, fallback?: unknown) => fallback, update: async () => undefined },
  workspaceState: { get: () => undefined, update: async () => undefined },
  extension: { packageJSON: { version: "test" } },
} as unknown as vscode.ExtensionContext

describe("profile panel auto-login", () => {
  const state: {
    created: ReturnType<typeof fakePanel>[]
    executed: Array<{ command: string; args: unknown[] }>
  } = { created: [], executed: [] }

  beforeEach(() => {
    state.created = []
    state.executed = []
    window.createWebviewPanel = () => {
      const panel = fakePanel()
      state.created.push(panel)
      return panel
    }
    window.registerWebviewPanelSerializer = () => ({ dispose: () => undefined })
    commands.executeCommand = async (command: string, ...args: unknown[]) => {
      state.executed.push({ command, args })
      return undefined
    }
  })

  afterEach(() => {
    window.createWebviewPanel = original.create
    window.registerWebviewPanelSerializer = original.serializer
    commands.executeCommand = original.execute
  })

  const create = () => profile({ context, server: {} as Manager, directory: "/tmp/project" })

  it("opens fresh panel with login: true and starts login once profileReady arrives", () => {
    const panel = create()
    panel.open({ login: true })
    expect(state.created).toHaveLength(1)
    expect(state.created[0]!.posted.filter((msg) => msg.type === "profileLogin")).toEqual([])

    state.created[0]!.receive({ type: "profileReady" })
    expect(state.created[0]!.posted.filter((msg) => msg.type === "profileLogin")).toEqual([{ type: "profileLogin" }])

    // A subsequent ready handshake does not replay the consumed login request.
    state.created[0]!.receive({ type: "profileReady" })
    expect(state.created[0]!.posted.filter((msg) => msg.type === "profileLogin")).toHaveLength(1)
    panel.dispose()
  })

  it("opens fresh panel without login: true and does not auto-start login", () => {
    const panel = create()
    panel.open()
    state.created[0]!.receive({ type: "profileReady" })
    expect(state.created[0]!.posted.filter((msg) => msg.type === "profileLogin")).toEqual([])
    panel.dispose()
  })

  it("reveals an already-open ready panel with login: true and starts login immediately", () => {
    const panel = create()
    panel.open()
    state.created[0]!.receive({ type: "profileReady" })
    expect(state.created[0]!.posted.filter((msg) => msg.type === "profileLogin")).toEqual([])

    panel.open({ login: true })
    expect(state.created).toHaveLength(1)
    expect(state.created[0]!.reveals).toBe(1)
    expect(state.created[0]!.posted.filter((msg) => msg.type === "profileLogin")).toEqual([{ type: "profileLogin" }])
    panel.dispose()
  })

  it("queues login when an already-open panel is revealed before profileReady", () => {
    const panel = create()
    panel.open()
    panel.open({ login: true })
    expect(state.created[0]!.reveals).toBe(1)
    expect(state.created[0]!.posted.filter((msg) => msg.type === "profileLogin")).toEqual([])

    state.created[0]!.receive({ type: "profileReady" })
    expect(state.created[0]!.posted.filter((msg) => msg.type === "profileLogin")).toEqual([{ type: "profileLogin" }])
    panel.dispose()
  })

  it("routes openProfile with and without login: true from both Sidebar and Agent Manager webviews", () => {
    for (const view of ["chat", "agentManager"] as const) {
      const panel = fakePanel()
      const surface = wire({
        context,
        server: {} as Manager,
        directory: "/tmp/project",
        webview: panel.webview as unknown as vscode.Webview,
        view,
      })
      state.executed = []
      panel.receive({ type: "openProfile" })
      panel.receive({ type: "openProfile", login: true })
      expect(state.executed).toEqual([
        { command: "kilo-code.v2.profile", args: [undefined] },
        { command: "kilo-code.v2.profile", args: [{ login: true }] },
      ])
      surface.dispose()
    }
  })
})
