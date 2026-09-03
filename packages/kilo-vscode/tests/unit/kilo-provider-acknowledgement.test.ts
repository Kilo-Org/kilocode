import { afterEach, describe, expect, it } from "bun:test"
import type { EventSessionTurnClose, Session } from "@kilocode/sdk/v2/client"
import { KiloProvider } from "../../src/KiloProvider"
import { KiloConnectionService } from "../../src/services/cli-backend/connection-service"
import type { SSEPayload } from "../../src/services/cli-backend/sdk-sse-adapter"

const resources: { dispose(): void }[] = []

afterEach(() => {
  for (const resource of resources.splice(0).reverse()) resource.dispose()
})

function create() {
  const connection = new KiloConnectionService({} as never)
  resources.push(connection)
  return connection
}

function emit(connection: KiloConnectionService, event: SSEPayload) {
  const internal = connection as unknown as { broadcast(event: SSEPayload): void }
  internal.broadcast(event)
}

function completion(id = "evt-001"): EventSessionTurnClose {
  return { id, type: "session.turn.close", properties: { sessionID: "s1", parentID: "parent", reason: "completed" } }
}

function attach(connection: KiloConnectionService, blocked = true) {
  const provider = new KiloProvider({} as never, connection)
  resources.push(provider)
  const internal = provider as unknown as { initConnectionPromise: Promise<void> }
  internal.initConnectionPromise = Promise.resolve()
  const pending = Promise.withResolvers<(message: Record<string, unknown>) => Promise<void>>()
  const sent: unknown[] = []
  const intercepts: unknown[] = []
  const webview = {
    postMessage: async (message: unknown) => sent.push(message),
    onDidReceiveMessage: (handler: (message: Record<string, unknown>) => Promise<void>) => {
      pending.resolve(handler)
      return { dispose: () => {} }
    },
  }
  provider.attachToWebview(webview as never, {
    onBeforeMessage: async (message) => {
      intercepts.push(message)
      return blocked ? null : message
    },
  })
  return { provider, webview, sent, intercepts, receive: pending.promise }
}

describe("session acknowledgement host routing", () => {
  it("broadcasts synchronously before interception and releases subscriptions on reattach and disposal", async () => {
    const connection = create()
    const sidebar = attach(connection)
    const editor = attach(connection)
    const receive = await sidebar.receive
    const first = { type: "sessionAcknowledged", sessionID: "s1", eventID: "evt-first" }
    const result = receive({ ...first, type: "acknowledgeSession" })

    expect(connection.getConnectionState()).toBe("disconnected")
    expect(sidebar.sent).toEqual([first])
    expect(editor.sent).toEqual([first])
    expect(sidebar.intercepts).toEqual([])
    await result

    editor.provider.attachToWebview(editor.webview as never)
    const second = { ...first, eventID: "evt-second" }
    connection.notifySessionAcknowledged(second.sessionID, second.eventID)
    expect(sidebar.sent).toEqual([first, second])
    expect(editor.sent).toEqual([first, second])

    sidebar.provider.dispose()
    const third = { ...first, eventID: "evt-third" }
    connection.notifySessionAcknowledged(third.sessionID, third.eventID)
    expect(sidebar.sent).toEqual([first, second])
    expect(editor.sent).toEqual([first, second, third])

    connection.dispose()
    connection.notifySessionAcknowledged("s1", "evt-fourth")
    expect(editor.sent).toEqual([first, second, third])
  })

  it.each([
    { sessionID: "s1" },
    { eventID: "evt-first" },
    { sessionID: 1, eventID: "evt-first" },
    { sessionID: "s1", eventID: null },
  ])("ignores malformed acknowledgement %j", async (message) => {
    const connection = create()
    const sidebar = attach(connection)
    const receive = await sidebar.receive

    await receive({ type: "acknowledgeSession", ...message })

    expect(sidebar.sent).toEqual([])
    expect(sidebar.intercepts).toEqual([])
  })
})

describe("pending completion replay", () => {
  it("seeds a fresh webview before activation and readiness", async () => {
    const connection = create()
    const event = completion()
    emit(connection, event)
    emit(connection, {
      id: "evt-002",
      type: "session.status",
      properties: { sessionID: "s1", status: { type: "idle" } },
    })
    const editor = attach(connection, false)
    const ready = editor.provider.waitForReady()
    const receive = await editor.receive
    editor.provider.setStreamVisibility(true)
    expect(editor.sent).toEqual([])

    await receive({ type: "webviewReady" })
    await ready

    expect(editor.sent.slice(0, 2)).toEqual([
      { type: "sessionTurnClosed", sessionID: "s1", parentID: "parent", eventID: "evt-001", reason: "completed" },
      { type: "webviewActiveChanged", active: true },
    ])
    expect(connection.getPendingCompletions()).toEqual([event])
  })

  it("does not replay acknowledged completions after duplicate close events", async () => {
    const connection = create()
    const event = completion()
    emit(connection, event)
    connection.notifySessionAcknowledged("s1", event.id)
    emit(connection, event)
    const editor = attach(connection, false)
    const receive = await editor.receive

    await receive({ type: "webviewReady" })

    expect(connection.getPendingCompletions()).toEqual([])
    expect(editor.sent.at(0)).toEqual({ type: "webviewActiveChanged", active: false })
  })

  it("keeps the newer completion after a stale acknowledgement or close event", () => {
    const connection = create()
    const first = completion()
    const second = completion("evt-002")
    emit(connection, first)
    emit(connection, second)
    connection.notifySessionAcknowledged("s1", first.id)
    emit(connection, first)
    expect(connection.getPendingCompletions()).toEqual([second])
  })

  it.each([
    { id: "evt-002", type: "session.turn.open", properties: { sessionID: "s1" } },
    { id: "evt-002", type: "session.status", properties: { sessionID: "s1", status: { type: "busy" } } },
    { id: "evt-002", type: "session.error", properties: { sessionID: "s1" } },
    { id: "evt-002", type: "session.deleted", properties: { sessionID: "s1", info: { id: "s1" } as Session } },
    {
      id: "evt-002",
      type: "sync",
      name: "session.deleted.1",
      seq: 2,
      aggregateID: "s1",
      data: { sessionID: "s1" },
    },
    { id: "evt-002", type: "session.turn.close", properties: { sessionID: "s1", reason: "interrupted" } },
  ] satisfies SSEPayload[])("clears the seed and rejects older closes after %j", (event) => {
    const connection = create()
    const previous = completion()
    emit(connection, previous)
    emit(connection, event)
    expect(connection.getPendingCompletions()).toEqual([])
    emit(connection, previous)
    expect(connection.getPendingCompletions()).toEqual([])
  })

  it("keeps pending completions when untracked but discards them on service disposal", () => {
    const connection = create()
    const event = completion()
    emit(connection, event)
    connection.pruneSession("s1")
    expect(connection.getPendingCompletions()).toEqual([event])
    connection.dispose()
    expect(connection.getPendingCompletions()).toEqual([])
  })
})

describe("webview activation host routing", () => {
  it.each([true, false])("replays the latest stream activation (%s) when the webview is ready", async (active) => {
    const sidebar = attach(create(), false)
    const receive = await sidebar.receive
    sidebar.provider.setStreamVisibility(!active)
    sidebar.provider.setStreamVisibility(active)
    expect(sidebar.sent).toEqual([])

    await receive({ type: "webviewReady" })

    expect(sidebar.sent).toContainEqual({ type: "webviewActiveChanged", active })
    sidebar.sent.length = 0
    sidebar.provider.setStreamVisibility(!active)
    expect(sidebar.sent).toEqual([{ type: "webviewActiveChanged", active: !active }])
  })

  it("keeps visible native panels registered when inactive and reports activation changes", async () => {
    const connection = create()
    const editor = attach(connection)
    const internal = editor.provider as unknown as {
      contextSessionID: string
      isWebviewReady: boolean
      _getHtmlForWebview: () => string
    }
    internal.contextSessionID = "s1"
    internal._getHtmlForWebview = () => ""
    const pending = Promise.withResolvers<() => void>()
    const panel = {
      webview: editor.webview,
      active: false,
      visible: true,
      onDidChangeViewState: (handler: () => void) => {
        pending.resolve(handler)
        return { dispose: () => {} }
      },
    }
    editor.provider.resolveWebviewPanel(panel as never)
    expect(editor.sent).toEqual([])
    internal.isWebviewReady = true
    const change = await pending.promise
    const presence = connection as unknown as { visible: Map<string, Set<string>> }

    change()
    expect(editor.sent.at(-1)).toEqual({ type: "webviewActiveChanged", active: false })
    expect([...presence.visible.values()].flatMap((ids) => [...ids])).toEqual(["s1"])

    panel.active = true
    change()
    expect(editor.sent.at(-1)).toEqual({ type: "webviewActiveChanged", active: true })
    expect([...presence.visible.values()].flatMap((ids) => [...ids])).toEqual(["s1"])

    panel.visible = false
    change()
    expect(editor.sent.at(-1)).toEqual({ type: "webviewActiveChanged", active: false })
    expect([...presence.visible.values()].flatMap((ids) => [...ids])).toEqual([])
  })
})
