import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import * as vscode from "vscode"
import { editorPanel } from "../src/editor-panel"
import type { Manager } from "../src/server"

const window = vscode.window as unknown as Record<string, unknown>
const original = { create: window.createWebviewPanel, serializer: window.registerWebviewPanelSerializer }

function fakePanel() {
  const disposers: Array<() => void> = []
  const panel = {
    reveals: 0,
    iconPath: undefined as unknown,
    webview: {
      options: {},
      html: "",
      cspSource: "vscode-webview:",
      onDidReceiveMessage: () => ({ dispose: () => undefined }),
      postMessage: async () => true,
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

describe("editor panel", () => {
  const state: {
    created: ReturnType<typeof fakePanel>[]
    restore?: (panel: unknown) => Promise<void>
    unregistered: number
  } = { created: [], unregistered: 0 }

  beforeEach(() => {
    state.created = []
    state.restore = undefined
    state.unregistered = 0
    window.createWebviewPanel = () => {
      const panel = fakePanel()
      state.created.push(panel)
      return panel
    }
    window.registerWebviewPanelSerializer = (
      _type: string,
      serializer: { deserializeWebviewPanel: (panel: unknown) => Promise<void> },
    ) => {
      state.restore = serializer.deserializeWebviewPanel
      return { dispose: () => state.unregistered++ }
    }
  })

  afterEach(() => {
    window.createWebviewPanel = original.create
    window.registerWebviewPanelSerializer = original.serializer
  })

  const create = () =>
    editorPanel({
      context,
      server: {} as Manager,
      directory: "/tmp/project",
      type: "kilo-code.v2.profilePanel",
      title: "Kilo Profile",
      view: "profile",
    })

  it("creates one tab and reveals it on the next open", () => {
    const panel = create()
    const first = panel.open()
    const second = panel.open()
    expect(state.created).toHaveLength(1)
    expect(second).toBe(first)
    expect(state.created[0].reveals).toBe(1)
    expect(state.created[0].iconPath).toBeDefined()
  })

  it("creates a new tab after the user closes the old one", () => {
    const panel = create()
    panel.open()
    state.created[0].dispose()
    expect(panel.panel()).toBeUndefined()
    expect(panel.post()).toBeUndefined()
    panel.open()
    expect(state.created).toHaveLength(2)
  })

  it("adopts a restored tab, so open reveals it instead of creating one", async () => {
    const panel = create()
    const restored = fakePanel()
    await state.restore?.(restored)
    expect(panel.panel()).toBe(restored as unknown as vscode.WebviewPanel)
    panel.open()
    expect(state.created).toHaveLength(0)
    expect(restored.reveals).toBe(1)
  })

  it("unregisters the serializer on dispose", () => {
    create().dispose()
    expect(state.unregistered).toBe(1)
  })
})
