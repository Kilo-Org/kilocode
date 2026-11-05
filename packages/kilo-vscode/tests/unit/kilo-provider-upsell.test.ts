import { afterEach, describe, expect, it, spyOn } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import * as vscode from "vscode"
import { createKiloClient, type KiloClient, type Session } from "@kilocode/sdk/v2/client"
import { KiloProvider } from "../../src/KiloProvider"
import type { SidebarUpsell } from "../../src/kilo-provider/upsell"
import { KiloConnectionService } from "../../src/services/cli-backend/connection-service"
import { TelemetryProxy } from "../../src/services/telemetry/telemetry-proxy"
import { TelemetryEventName } from "../../src/services/telemetry/types"

const resources: { dispose(): void | Promise<void> }[] = []

afterEach(async () => {
  for (const resource of resources.splice(0).reverse()) await resource.dispose()
})

function storage() {
  const values = new Map<string, unknown>()
  return {
    get: <T>(key: string, fallback?: T): T => (values.has(key) ? values.get(key) : fallback) as T,
    update: async (key: string, value: unknown) => {
      values.set(key, value)
    },
  }
}

function session(id: string): Session {
  return {
    id,
    slug: id,
    projectID: "project",
    directory: "/repo",
    title: id,
    version: "1",
    time: { created: 1, updated: 1 },
  }
}

async function attach(kind: "sidebar" | "panel" | "embedded" = "sidebar") {
  if (typeof vscode.workspace.createFileSystemWatcher !== "function") {
    const descriptor = Object.getOwnPropertyDescriptor(vscode.workspace, "createFileSystemWatcher")
    const disposable = () => ({ dispose() {} })
    Object.defineProperty(vscode.workspace, "createFileSystemWatcher", {
      configurable: true,
      value: () => ({ onDidCreate: disposable, onDidChange: disposable, onDidDelete: disposable, dispose() {} }),
    })
    resources.push({
      dispose: () => {
        if (!descriptor) {
          Reflect.deleteProperty(vscode.workspace, "createFileSystemWatcher")
          return
        }
        Object.defineProperty(vscode.workspace, "createFileSystemWatcher", descriptor)
      },
    })
  }
  const dir = await mkdtemp(join(tmpdir(), "kilo-upsell-host-"))
  resources.push({ dispose: () => rm(dir, { recursive: true, force: true }) })
  const global = storage()
  const workspace = storage()
  const connection = new KiloConnectionService({} as never)
  resources.push(connection)
  const provider = new KiloProvider({} as never, connection, {
    globalState: global,
    workspaceState: workspace,
    globalStorageUri: { fsPath: dir },
  } as never)
  resources.push(provider)
  const internal = provider as unknown as {
    initConnectionPromise: Promise<void>
    view: { visible: boolean } | undefined
    panel: { visible: boolean; active: boolean } | undefined
    upsell: SidebarUpsell
    trackedSessionIds: Set<string>
    handleEvent(event: { type: "session.created"; properties: { sessionID: string; info: Session } }): void
  }
  internal.initConnectionPromise = Promise.resolve()
  if (kind === "sidebar") internal.view = { visible: true }
  if (kind === "panel") internal.panel = { visible: true, active: true }
  const pending = Promise.withResolvers<(message: Record<string, unknown>) => Promise<void>>()
  const sent: unknown[] = []
  const webview = {
    postMessage: async (message: unknown) => sent.push(message),
    onDidReceiveMessage: (handler: (message: Record<string, unknown>) => Promise<void>) => {
      pending.resolve(handler)
      return { dispose() {} }
    },
  }
  provider.attachToWebview(webview as never)
  provider.setStreamVisibility(true)
  return { provider, connection, internal, global, workspace, sent, receive: await pending.promise }
}

describe("KiloProvider Agent Manager upsell host routing", () => {
  it("replies only from the ordinary sidebar, preserving the request ID", async () => {
    for (const kind of ["sidebar", "panel", "embedded"] as const) {
      const host = await attach(kind)
      await host.internal.upsell.started("first")
      await host.internal.upsell.started("second")
      await host.receive({ type: "agentManagerUpsell", action: "shown", request: kind })

      expect(host.sent).toEqual(
        kind === "sidebar"
          ? [{ type: "agentManagerUpsellLoaded", request: kind, state: {}, engaged: true, display: true }]
          : [],
      )
      expect(host.global.get("upsell.agentManager", {})).toEqual({})
      if (kind === "panel") {
        host.internal.view = { visible: true }
        await host.receive({ type: "agentManagerUpsell", action: "shown", request: "panel-with-view" })
        expect(host.sent).toEqual([])
      }
    }
  })

  it("does not claim while hidden and keeps the visible claim latched across repeated requests", async () => {
    const host = await attach()
    await host.internal.upsell.started("first")
    await host.internal.upsell.started("second")
    host.provider.setStreamVisibility(false)
    await host.receive({ type: "agentManagerUpsell", action: "shown", request: "hidden" })
    expect(host.sent).toEqual([
      { type: "agentManagerUpsellLoaded", request: "hidden", state: {}, engaged: true, display: false },
    ])

    host.provider.setStreamVisibility(true)
    await host.receive({ type: "agentManagerUpsell", action: "shown", request: "visible" })
    host.provider.setStreamVisibility(false)
    await host.receive({ type: "agentManagerUpsell", action: "rendered", request: "rendered" })
    await host.receive({ type: "agentManagerUpsell", request: "state" })
    host.provider.setStreamVisibility(false)
    host.provider.setStreamVisibility(true)
    await host.receive({ type: "agentManagerUpsell", action: "shown", request: "repeated" })

    expect(host.sent).toEqual([
      { type: "agentManagerUpsellLoaded", request: "hidden", state: {}, engaged: true, display: false },
      { type: "agentManagerUpsellLoaded", request: "visible", state: {}, engaged: true, display: true },
      { type: "agentManagerUpsellLoaded", request: "rendered", state: {}, engaged: true, display: false },
      { type: "agentManagerUpsellLoaded", request: "state", state: {}, engaged: true, display: false },
      { type: "agentManagerUpsellLoaded", request: "repeated", state: {}, engaged: true, display: false },
    ])
  })

  it("rejects foreign-source render ACKs even when that host has an unused grant", async () => {
    for (const kind of ["panel", "embedded"] as const) {
      const host = await attach(kind)
      await host.internal.upsell.started("first")
      await host.internal.upsell.started("second")
      expect((await host.internal.upsell.handle("shown", true)).display).toBe(true)
      if (kind === "panel") host.internal.view = { visible: true }
      await host.receive({ type: "agentManagerUpsell", action: "rendered", request: "foreign" })
      expect(host.sent).toEqual([])
      expect((await host.internal.upsell.handle("shown", true)).display).toBe(true)
    }
  })

  it("counts own session creations but not generic inbound session-created events", async () => {
    const host = await attach()
    const created: Session[] = []
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url)
        if (url.pathname === "/config") return Response.json({})
        if (url.pathname === "/session" && request.method === "POST") {
          const result = session(`own-${created.length + 1}`)
          created.push(result)
          return Response.json(result)
        }
        return Response.json(true)
      },
    })
    resources.push({ dispose: () => void server.stop(true) })
    const connection = host.connection as unknown as { client: KiloClient; state: string }
    connection.client = createKiloClient({ baseUrl: server.url.href })
    connection.state = "connected"

    for (const id of ["external-first", "external-second"]) {
      host.internal.trackedSessionIds.add(id)
      host.internal.handleEvent({ type: "session.created", properties: { sessionID: id, info: session(id) } })
    }
    expect(host.sent).toContainEqual(expect.objectContaining({ type: "sessionCreated" }))
    await host.receive({ type: "agentManagerUpsell", request: "external" })
    expect(host.sent.at(-1)).toEqual({
      type: "agentManagerUpsellLoaded",
      request: "external",
      state: {},
      engaged: false,
      display: false,
    })
    expect(host.workspace.get("upsell.agentManager.sessions", [])).toEqual([])

    await host.receive({ type: "createSession" })
    await host.receive({ type: "agentManagerUpsell", request: "first" })
    expect(host.sent.at(-1)).toEqual({
      type: "agentManagerUpsellLoaded",
      request: "first",
      state: {},
      engaged: false,
      display: false,
    })
    await host.receive({ type: "createSession" })
    await host.receive({ type: "agentManagerUpsell", action: "shown", request: "second" })

    expect(created.map((item) => item.id)).toEqual(["own-1", "own-2"])
    expect(host.workspace.get("upsell.agentManager.sessions", [])).toEqual(["own-1", "own-2"])
    expect(host.sent.at(-1)).toEqual({
      type: "agentManagerUpsellLoaded",
      request: "second",
      state: {},
      engaged: true,
      display: true,
    })
    expect(host.sent).not.toContainEqual(expect.objectContaining({ type: "error" }))

    for (const kind of ["panel", "embedded"] as const) {
      const editor = await attach(kind)
      const connection = editor.connection as unknown as { client: KiloClient; state: string }
      connection.client = createKiloClient({ baseUrl: server.url.href })
      connection.state = "connected"
      if (kind === "panel") editor.internal.view = { visible: true }
      await editor.receive({ type: "createSession" })
      await editor.receive({ type: "createSession" })
      expect(await editor.internal.upsell.handle(undefined, true)).toMatchObject({ engaged: false })
      expect(editor.workspace.get("upsell.agentManager.sessions", [])).toEqual([])
      expect(editor.sent.filter((message) => (message as { type: string }).type === "sessionCreated")).toHaveLength(2)
      expect(editor.sent).not.toContainEqual(expect.objectContaining({ type: "error" }))
    }
  })

  it("opens Agent Manager through the existing command without new-draft arguments", async () => {
    const host = await attach()
    const command = spyOn(vscode.commands, "executeCommand")
    resources.push({ dispose: () => command.mockRestore() })
    command.mockClear()

    await host.receive({ type: "openAgentManager" })

    expect(command.mock.calls).toEqual([["kilo-code.new.agentManagerOpen"]])
  })

  it("drops hidden and non-sidebar upsell telemetry and bounds visible telemetry properties", async () => {
    const proxy = TelemetryProxy.getInstance()
    const internal = proxy as unknown as { url?: string; password?: string; provider?: unknown }
    const previous = { url: internal.url, password: internal.password, provider: internal.provider }
    const descriptor = Object.getOwnPropertyDescriptor(vscode.env, "isTelemetryEnabled")!
    const received: Array<{ event: string; properties: Record<string, unknown> }> = []
    const pending = Promise.withResolvers<void>()
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const message = await request.json()
        received.push(message)
        if (message.properties.action === "opened") pending.resolve()
        return Response.json(true)
      },
    })
    resources.push({
      dispose() {
        Object.assign(internal, previous)
        Object.defineProperty(vscode.env, "isTelemetryEnabled", descriptor)
        void server.stop(true)
      },
    })
    Object.defineProperty(vscode.env, "isTelemetryEnabled", { ...descriptor, value: true })
    proxy.configure(server.url.origin, "test")
    const message = { type: "telemetry", event: TelemetryEventName.AGENT_MANAGER_UPSELL }

    for (const kind of ["sidebar", "panel", "embedded"] as const) {
      const host = await attach(kind)
      if (kind === "sidebar") host.provider.setStreamVisibility(false)
      if (kind === "panel") host.internal.view = { visible: true }
      await host.receive({ ...message, properties: { action: "shown" } })
    }
    const host = await attach()
    for (const action of [undefined, "invalid", 1]) {
      await host.receive({ ...message, properties: { action } })
    }
    await host.receive({ ...message, properties: { action: "opened", prompt: "private", sessionID: "private" } })
    await pending.promise

    expect(received).toHaveLength(1)
    expect(received.at(0)?.event).toBe(TelemetryEventName.AGENT_MANAGER_UPSELL)
    expect(received.at(0)?.properties).toMatchObject({ action: "opened" })
    expect(received.at(0)?.properties).not.toHaveProperty("prompt")
    expect(received.at(0)?.properties).not.toHaveProperty("sessionID")
  })
})
