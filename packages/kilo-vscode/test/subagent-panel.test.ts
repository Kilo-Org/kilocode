import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { Window } from "happy-dom"
import * as vscode from "vscode"
import type { ToHost } from "../src/protocol"
import type { Manager } from "../src/server"
import { restoredTarget, subagentPanels, subagentTitle, SUBAGENT_PANEL_TYPE } from "../src/subagent-panel"
import { attachSubagentEvent } from "../webview-ui/agent-manager/subagent-tabs"
import { openSubagent } from "../webview-ui/src/v2/open-subagent"

const window = vscode.window as unknown as Record<string, unknown>
const original = {
  create: window.createWebviewPanel,
  serializer: window.registerWebviewPanelSerializer,
  window: globalThis.window,
  event: globalThis.CustomEvent,
}

function fakePanel() {
  const disposers: Array<() => void> = []
  const receivers: Array<(message: ToHost) => void> = []
  const panel = {
    reveals: 0,
    disposed: false,
    title: "",
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

const target = { sessionID: "ses_child", title: "Find usages", parentSessionID: "ses_parent", directory: "/repo" }

describe("subagent panels", () => {
  const state: {
    created: { type: string; title: string; panel: ReturnType<typeof fakePanel> }[]
    restore?: (panel: unknown, value: unknown) => Promise<void>
    type?: string
  } = { created: [] }

  beforeEach(() => {
    state.created = []
    state.restore = undefined
    window.createWebviewPanel = (type: string, title: string) => {
      const panel = fakePanel()
      state.created.push({ type, title, panel })
      return panel
    }
    window.registerWebviewPanelSerializer = (
      type: string,
      serializer: { deserializeWebviewPanel: (panel: unknown, value: unknown) => Promise<void> },
    ) => {
      state.type = type
      state.restore = serializer.deserializeWebviewPanel
      return { dispose: () => undefined }
    }
  })

  afterEach(() => {
    window.createWebviewPanel = original.create
    window.registerWebviewPanelSerializer = original.serializer
  })

  const create = (showParent?: (id: string) => void) =>
    subagentPanels({ context, server: {} as Manager, showParent })

  it("opens one titled tab per child session and reveals it again", () => {
    const panels = create()
    const first = panels.open(target)
    const second = panels.open(target)
    panels.open({ ...target, sessionID: "ses_other" })

    expect(second).toBe(first)
    expect(state.created).toHaveLength(2)
    expect(state.created[0]?.type).toBe(SUBAGENT_PANEL_TYPE)
    expect(state.created[0]?.title).toBe("Sub-agent: Find usages")
    expect(state.created[0]?.panel.reveals).toBe(1)
    expect(state.created[0]?.panel.webview.html).toContain('data-view="subagent"')
    expect(state.created[0]?.panel.webview.html).toContain('"sessionID":"ses_child"')
  })

  it("opens a new tab after the old one closes", () => {
    const panels = create()
    panels.open(target)
    state.created[0]?.panel.dispose()
    panels.open(target)
    expect(state.created).toHaveLength(2)
  })

  it("restores a tab from its webview state and drops a tab without one", async () => {
    const panels = create()
    expect(state.type).toBe(SUBAGENT_PANEL_TYPE)
    const restored = fakePanel()
    await state.restore?.(restored, { subagent: target })
    panels.open(target)
    expect(state.created).toHaveLength(0)
    expect(restored.reveals).toBe(1)
    expect(restored.title).toBe("Sub-agent: Find usages")

    const stale = fakePanel()
    await state.restore?.(stale, undefined)
    expect(stale.disposed).toBe(true)
  })

  it("closes the tab and shows the parent when the user goes back", () => {
    const shown: string[] = []
    create((id) => shown.push(id)).open(target)
    state.created[0]?.panel.receive({ type: "subagentBack" })
    expect(state.created[0]?.panel.disposed).toBe(true)
    expect(shown).toEqual(["ses_parent"])
  })
})

describe("subagent target", () => {
  it("titles a tab with the description", () => {
    expect(subagentTitle("  Audit deps ")).toBe("Sub-agent: Audit deps")
    expect(subagentTitle(undefined)).toBe("Sub-agent")
  })

  it("reads only a complete saved target", () => {
    expect(restoredTarget({ subagent: target })).toEqual(target)
    expect(restoredTarget({ subagent: { sessionID: "ses_child" } })).toBeUndefined()
    expect(restoredTarget({ other: true })).toBeUndefined()
    expect(restoredTarget(null)).toBeUndefined()
  })
})

describe("openSubagent", () => {
  afterEach(() => {
    globalThis.window = original.window
    globalThis.CustomEvent = original.event
  })

  it("opens the Agent Manager inspector through its window event", () => {
    const view = new Window()
    globalThis.window = view as unknown as typeof globalThis.window
    globalThis.CustomEvent = view.CustomEvent as unknown as typeof globalThis.CustomEvent
    const opened: unknown[][] = []
    const posted: ToHost[] = []
    const detach = attachSubagentEvent((...args) => opened.push(args))

    openSubagent({ ...target, surface: "inspector", post: (message) => posted.push(message) })
    detach()

    expect(opened).toEqual([["ses_child", "Find usages", "ses_parent"]])
    expect(posted).toEqual([])
  })

  it("asks the host for an editor tab elsewhere", () => {
    const posted: ToHost[] = []
    openSubagent({ sessionID: "ses_child", title: "Find usages", surface: "tab", post: (message) => posted.push(message) })
    expect(posted).toEqual([{ type: "openSubagent", sessionID: "ses_child", title: "Find usages", parentSessionID: undefined }])
  })
})
