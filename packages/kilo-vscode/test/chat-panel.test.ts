import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import * as vscode from "vscode"
import type { ToHost } from "../src/protocol"
import { sidebarSession } from "../src/browser-tab/sidebar-session"
import { CHAT_PANEL_TYPE, chatPanels, restoredTarget } from "../src/chat-panel"
import type { Manager } from "../src/server"

const ROOT = join(import.meta.dir, "..")

const window = vscode.window as unknown as Record<string, unknown>
const original = { create: window.createWebviewPanel, serializer: window.registerWebviewPanelSerializer }

function fakePanel() {
  const disposers: Array<() => void> = []
  const receivers: Array<(message: ToHost) => void> = []
  const panel = {
    reveals: 0,
    disposed: false,
    title: "",
    visible: true,
    iconPath: undefined as unknown,
    webview: {
      options: {},
      html: "",
      cspSource: "vscode-webview:",
      onDidReceiveMessage: (callback: (message: ToHost) => void) => {
        receivers.push(callback)
        return { dispose: () => undefined }
      },
      postMessage: async () => true,
      asWebviewUri: (uri: unknown) => uri,
    },
    receive: (message: ToHost) => receivers.forEach((callback) => callback(message)),
    reveal: () => {
      panel.reveals++
    },
    onDidChangeViewState: () => ({ dispose: () => undefined }),
    onDidDispose: (callback: () => void) => {
      disposers.push(callback)
      return { dispose: () => undefined }
    },
    dispose: () => {
      panel.disposed = true
      disposers.forEach((callback) => callback())
    },
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

const server = { get: () => Promise.reject(new Error("no server in this test")) } as unknown as Manager

describe("chat panels", () => {
  const state: {
    created: { type: string; title: string; options: unknown; panel: ReturnType<typeof fakePanel> }[]
    restore?: (panel: unknown, value: unknown) => Promise<void>
    unregistered: number
  } = { created: [], unregistered: 0 }

  beforeEach(() => {
    state.created = []
    state.restore = undefined
    state.unregistered = 0
    window.createWebviewPanel = (type: string, title: string, _column: unknown, options: unknown) => {
      const panel = fakePanel()
      state.created.push({ type, title, options, panel })
      return panel
    }
    window.registerWebviewPanelSerializer = (
      _type: string,
      serializer: { deserializeWebviewPanel: (panel: unknown, value: unknown) => Promise<void> },
    ) => {
      state.restore = serializer.deserializeWebviewPanel
      return { dispose: () => state.unregistered++ }
    }
  })

  afterEach(() => {
    window.createWebviewPanel = original.create
    window.registerWebviewPanelSerializer = original.serializer
  })

  const create = () => chatPanels({ context, server, directory: "/tmp/project" })

  it("opens one tab per session and reveals it again", () => {
    const panels = create()
    const first = panels.open("ses_a")
    const second = panels.open("ses_a")

    expect(second).toBe(first)
    expect(state.created).toHaveLength(1)
    expect(state.created[0]?.type).toBe(CHAT_PANEL_TYPE)
    expect(state.created[0]?.options).toMatchObject({ enableScripts: true, retainContextWhenHidden: true })
    expect(state.created[0]?.panel.reveals).toBe(1)
    expect(state.created[0]?.panel.webview.html).toContain('data-view="chat"')
    expect(state.created[0]?.panel.webview.html).toContain('window.KILO_SURFACE = "editor"')
    expect(state.created[0]?.panel.webview.html).toContain('window.KILO_SESSION_ID = "ses_a"')
  })

  it("opens a distinct new-session tab when no session is given", () => {
    const panels = create()
    panels.open()
    panels.open()

    expect(state.created).toHaveLength(2)
    expect(state.created[0]?.panel.webview.html).toContain('window.KILO_SURFACE = "editor"')
    expect(state.created[0]?.panel.webview.html).toContain('window.KILO_SESSION_ID = null')
  })

  it("binds a new-session tab to the session it reports, so opening that session reveals it", () => {
    const panels = create()
    const before = sidebarSession()
    panels.open()
    state.created[0]?.panel.receive({ type: "sidebar.session", sessionId: "ses_a" })

    const revealed = panels.open("ses_a")
    expect(revealed).toBe(state.created[0]?.panel as unknown as vscode.WebviewPanel)
    expect(state.created).toHaveLength(1)
    expect(state.created[0]?.panel.reveals).toBe(1)
    // The sidebar's own global session is not the tab's to set.
    expect(sidebarSession()).toBe(before)
  })

  it("restores a tab from its own webview state and drops a tab without one", async () => {
    const panels = create()
    const restored = fakePanel()
    await state.restore?.(restored, { sessionID: "ses_a", directory: "/repo" })
    panels.open("ses_a")

    expect(state.created).toHaveLength(0)
    expect(restored.reveals).toBe(1)
    expect(restored.webview.html).toContain('window.KILO_SESSION_ID = "ses_a"')

    const stale = fakePanel()
    await state.restore?.(stale, undefined)
    expect(stale.disposed).toBe(true)
  })

  it("does not restore two tabs on the same session", async () => {
    create()
    const first = fakePanel()
    await state.restore?.(first, { sessionID: "ses_a", directory: "/repo" })
    const second = fakePanel()
    await state.restore?.(second, { sessionID: "ses_a", directory: "/repo" })

    expect(first.disposed).toBe(false)
    expect(second.disposed).toBe(true)
  })

  it("forgets a closed tab, so opening its session creates a new one", () => {
    const panels = create()
    panels.open("ses_a")
    state.created[0]?.panel.dispose()
    panels.open("ses_a")

    expect(state.created).toHaveLength(2)
  })

  it("disposes every tab and unregisters the serializer", () => {
    const panels = create()
    panels.open("ses_a")
    panels.open("ses_b")
    panels.dispose()

    expect(state.created.map((entry) => entry.panel.disposed)).toEqual([true, true])
    expect(state.unregistered).toBe(1)
  })
})

describe("restored chat target", () => {
  it("reads only a complete saved target", () => {
    expect(restoredTarget({ sessionID: "ses_a", directory: "/repo" })).toEqual({
      sessionID: "ses_a",
      directory: "/repo",
    })
    expect(restoredTarget({ sessionID: null, directory: "/repo" })).toEqual({
      sessionID: undefined,
      directory: "/repo",
    })
    expect(restoredTarget({ directory: "/repo" })).toEqual({ sessionID: undefined, directory: "/repo" })
    expect(restoredTarget({ sessionID: "ses_a" })).toBeUndefined()
    expect(restoredTarget({ sessionID: 7, directory: "/repo" })).toBeUndefined()
    expect(restoredTarget(null)).toBeUndefined()
  })
})

describe("chat panel manifest", () => {
  it("contributes the command with its icon, the chat title button and the restore activation event", () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      activationEvents: string[]
      contributes: {
        commands: Array<{ command: string; title: string; category: string; icon?: unknown }>
        menus: { "view/title": Array<{ command: string; when: string; group: string }> }
      }
    }
    expect(manifest.activationEvents).toContain(`onWebviewPanel:${CHAT_PANEL_TYPE}`)
    expect(manifest.contributes.commands.find((entry) => entry.command === "kilo-code.v2.openInTab")).toMatchObject({
      title: "Open in Tab",
      category: "Kilo Code",
      icon: { light: "assets/icons/kilo-light.svg", dark: "assets/icons/kilo-dark.svg" },
    })
    expect(manifest.contributes.menus["view/title"]).toContainEqual({
      command: "kilo-code.v2.openInTab",
      when: "view == kilo-code.v2.chat",
      group: "navigation@6",
    })
  })
})
