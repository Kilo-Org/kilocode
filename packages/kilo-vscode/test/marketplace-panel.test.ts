import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import * as vscode from "vscode"
import { marketplace } from "../src/marketplace-panel"
import type { Manager } from "../src/server"

const window = vscode.window as unknown as Record<string, unknown>
const original = { create: window.createWebviewPanel, serializer: window.registerWebviewPanelSerializer }

function fakePanel() {
  const disposers: Array<() => void> = []
  return {
    webview: {
      options: {},
      html: "",
      cspSource: "vscode-webview:",
      onDidReceiveMessage: () => ({ dispose: () => undefined }),
      postMessage: async () => true,
      asWebviewUri: (uri: unknown) => uri,
    },
    reveal: () => undefined,
    onDidDispose: (callback: () => void) => {
      disposers.push(callback)
      return { dispose: () => undefined }
    },
    dispose: () => disposers.forEach((callback) => callback()),
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

describe("marketplace panel", () => {
  let created: Array<{ type: string; title: string; panel: ReturnType<typeof fakePanel> }> = []

  beforeEach(() => {
    created = []
    window.createWebviewPanel = (type: string, title: string) => {
      const panel = fakePanel()
      created.push({ type, title, panel })
      return panel
    }
    window.registerWebviewPanelSerializer = () => ({ dispose: () => undefined })
  })

  afterEach(() => {
    window.createWebviewPanel = original.create
    window.registerWebviewPanelSerializer = original.serializer
  })

  it("opens the Kilo Marketplace tab in the shared settings bundle", () => {
    marketplace({ context, server: {} as Manager, directory: "/tmp/project" }).open()
    expect(created).toHaveLength(1)
    expect(created[0].type).toBe("kilo-code.v2.marketplacePanel")
    expect(created[0].title).toBe("Kilo Marketplace")
    expect(created[0].panel.webview.html).toContain('data-view="marketplace"')
    expect(created[0].panel.webview.html).toContain("window.KILO_HAS_WORKSPACE = true;")
  })
})
