import { expect, spyOn, test } from "bun:test"
import { createKiloClient, type GlobalEvent, type Session } from "@kilocode/sdk/v2"
import { createRoot, createSignal } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { GoalSync } from "@/kilocode/cli/cmd/tui/goal-sync"
import { GoalState } from "@/kilocode/session/goal/state"
import { tmpdir } from "../../fixture/fixture"
import { directory, json, mount, wait } from "../../../../tui/test/cli/cmd/tui/sync-fixture"

const info: Session = {
  id: "ses_goal",
  slug: "goal",
  projectID: "proj_test",
  directory,
  title: "Goal session",
  version: "1",
  time: { created: 1, updated: 1 },
  metadata: { retained: true, "kilo.goal": { text: "Keep tests passing", active: false } },
}

function replay(session: Session, workspace = "ws_a"): GlobalEvent {
  return {
    directory,
    project: "proj_test",
    workspace,
    payload: {
      id: "evt_sync",
      type: "sync",
      syncEvent: {
        id: "evt_goal",
        type: "session.updated.1",
        aggregateID: session.id,
        seq: 1,
        data: { sessionID: session.id, info: session },
      },
    },
  }
}

function connected(workspace = "ws_a"): GlobalEvent {
  return {
    directory: "global",
    payload: {
      id: "evt_connected",
      type: "workspace.status",
      properties: { workspaceID: workspace, status: "connected" },
    },
  }
}

function response(url: URL) {
  if (url.pathname === "/experimental/workspace") return json([{ id: "ws_a" }, { id: "ws_b" }])
  if (url.pathname === "/command") {
    return json([{ name: url.searchParams.get("workspace") ?? "local", template: "", hints: [] }])
  }
  if (url.pathname === "/session") return json([info, { ...info, id: "ses_other", workspaceID: "ws_b" }])
  return undefined
}

async function select(app: Awaited<ReturnType<typeof mount>>, workspace: string) {
  app.project.workspace.set(workspace)
  await wait(() => app.sync.data.command.some((command) => command.name === workspace))
}

for (const entry of [
  { owner: "ws_a", active: false },
  { owner: "ws_a", active: true },
  { owner: undefined, active: false },
]) {
  test(`refreshes replayed goal activation from ${entry.owner ?? "local"} (${entry.active})`, async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    const calls: URL[] = []
    const app = await mount((url) => {
      if (url.pathname.startsWith("/session/ses_")) calls.push(url)
      if (url.pathname !== `/session/${info.id}`) return response(url)
      return json({
        ...info,
        title: "Do not replace the title",
        metadata: { "kilo.goal": { text: "Current goal", active: entry.active } },
      })
    }, tmp.path)
    try {
      if (entry.owner) await select(app, entry.owner)
      app.emit(
        replay({ ...info, id: "ses_other", metadata: { "kilo.goal": { text: "Other goal", active: true } } }, "ws_b"),
      )
      app.emit({
        ...replay({ ...info, metadata: { ...info.metadata, "kilo.goal": { text: "Historical goal", active: true } } }),
        workspace: entry.owner,
      })
      await wait(() => GoalState.read(app.sync.session.get(info.id)?.metadata)?.active === true)
      app.emit(connected("ws_b"))
      app.emit(
        entry.owner
          ? connected(entry.owner)
          : {
              directory: "global",
              payload: { id: "evt_server", type: "server.connected", properties: {} },
            },
      )
      await wait(() => GoalState.read(app.sync.session.get(info.id)?.metadata)?.text === "Current goal")
      expect(calls).toHaveLength(1)
      expect(calls.at(0)?.searchParams.get("workspace")).toBe(entry.owner ?? null)
      expect(app.sync.session.get(info.id)).toMatchObject({
        title: info.title,
        metadata: { retained: true, "kilo.goal": { text: "Current goal", active: entry.active } },
      })
    } finally {
      app.app.renderer.destroy()
    }
  })
}

for (const change of ["live event", "workspace switch"]) {
  test(`discards a delayed goal refresh after a ${change}`, async () => {
    const client = createKiloClient({ baseUrl: "http://test" })
    const reply = Promise.withResolvers<{ data: Session; request: Request; response: Response }>()
    const get = spyOn(client.session, "get").mockReturnValue(reply.promise)
    const handlers = new Set<(event: GlobalEvent) => void>()
    const event = {
      emit(_type: "event", value: GlobalEvent) {
        for (const handler of handlers) handler(value)
      },
      on(_type: "event", handler: (event: GlobalEvent) => void) {
        handlers.add(handler)
        return () => {
          handlers.delete(handler)
        }
      },
    }
    const [workspace, setWorkspace] = createSignal("ws_a")
    const [store, setStore] = createStore<{ session: Session[] }>({
      session: [{ ...info, metadata: { "kilo.goal": { text: "Current goal", active: true } } }],
    })
    const dispose = createRoot((dispose) => {
      GoalSync.watch({ client, event }, workspace, store, (fn) => setStore(produce(fn)))
      return dispose
    })
    try {
      await wait(() => handlers.size === 1)
      event.emit("event", connected())
      await wait(() => get.mock.calls.length === 1)
      if (change === "live event") event.emit("event", replay(store.session.at(0)!))
      if (change === "workspace switch") {
        setWorkspace("ws_b")
        setWorkspace("ws_a")
      }
      reply.resolve({
        data: { ...info, metadata: { "kilo.goal": { text: "Stale response", active: false } } },
        request: new Request("http://test"),
        response: json({}),
      })
      await reply.promise
      expect(GoalState.read(store.session.at(0)?.metadata)).toEqual({
        text: "Current goal",
        active: true,
        status: "active",
      })
    } finally {
      dispose()
      get.mockRestore()
    }
    expect(handlers.size).toBe(0)
  })
}
