// The Agent Manager panel shares one event stream between per-directory `createData` stores. A local server streams
// real server events, and each store must receive only the events of its own directory.
import { afterAll, describe, expect, mock, test } from "bun:test"
import { OpenCode, type OpenCodeEvent } from "@opencode/client"

// The package resolves the server build of Solid outside a renderer, where effects never run.
const CLIENT_SOLID = "solid-js/dist/solid.js"
mock.module("solid-js", () => import(CLIENT_SOLID))
// The client build of the store, so store writes reach the memos of the client Solid build.
const CLIENT_STORE = "solid-js/store/dist/store.js"
mock.module("solid-js/store", () => import(CLIENT_STORE))
const { createRoot } = (await import(CLIENT_SOLID)) as {
  createRoot: <T>(fn: (dispose: () => void) => T) => T
}
// The webview page: the event stream reconnects on page lifecycle events.
Object.assign(globalThis, {
  window: new EventTarget(),
  document: Object.assign(new EventTarget(), { visibilityState: "visible" }),
})
const { createPanelData, key, targets } = await import("../webview-ui/agent-manager/v2/panel-data")
const { createSessions } = await import("../webview-ui/agent-manager/v2/sessions")

const ROOT = "/repo"
const WORKTREE = "/repo/.kilo/worktrees/one"
const OTHER = "/other"

const encoder = new TextEncoder()
const streams = new Set<ReadableStreamDefaultController<Uint8Array>>()
const sessions = new Map<string, string>()
const requests: { path: string; directory: string | null; location: string | null }[] = []

function created(id: string, directory: string) {
  sessions.set(id, directory)
  return {
    id: `evt_${id}`,
    created: Date.now(),
    type: "session.created",
    durable: { aggregateID: id, seq: 1, version: 1 },
    location: { directory },
    data: { sessionID: id, projectID: "prj_1", location: { directory }, slug: id },
  }
}

function emit(event: unknown) {
  for (const controller of [...streams]) {
    try {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
    } catch {
      streams.delete(controller)
    }
  }
}

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } })

const server = Bun.serve({
  port: 0,
  fetch(request) {
    const url = new URL(request.url)
    requests.push({
      path: url.pathname,
      directory: url.searchParams.get("directory"),
      location: url.searchParams.get("location[directory]"),
    })
    if (url.pathname === "/api/event") {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          streams.add(controller)
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "server.connected", id: "evt_0", created: 0, data: {} })}\n\n`,
            ),
          )
        },
        cancel(controller) {
          streams.delete(controller as unknown as ReadableStreamDefaultController<Uint8Array>)
        },
      })
      return new Response(body, { headers: { "content-type": "text/event-stream" } })
    }
    const match = /^\/api\/session\/([^/]+)$/.exec(url.pathname)
    const directory = match ? sessions.get(match[1]!) : undefined
    if (match && directory)
      return json({
        data: {
          id: match[1],
          projectID: "prj_1",
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: 1, updated: 1 },
          location: { directory },
        },
      })
    if (url.pathname === "/api/session") return json({ data: [], location: { directory: ROOT } })
    return new Response(JSON.stringify({ _tag: "NotFound", message: "not found" }), { status: 404 })
  },
})

afterAll(() => server.stop(true))

async function until(check: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (check()) return
    await Bun.sleep(20)
  }
  throw new Error("condition not reached")
}

describe("targets", () => {
  const event = (type: string, directory?: string) =>
    ({ type, location: directory ? { directory } : undefined }) as unknown as OpenCodeEvent

  test("routes a located event to its directory only", () => {
    expect(targets(event("session.created", WORKTREE), [ROOT, WORKTREE, OTHER])).toEqual([WORKTREE])
  })

  test("ignores a trailing separator", () => {
    expect(targets(event("session.created", `${WORKTREE}/`), [ROOT, WORKTREE])).toEqual([WORKTREE])
    expect(key(`${ROOT}/`)).toBe(ROOT)
  })

  test("broadcasts events without a location and session moves", () => {
    expect(targets(event("server.connected"), [ROOT, OTHER])).toEqual([ROOT, OTHER])
    expect(targets(event("session.moved", WORKTREE), [ROOT, OTHER])).toEqual([ROOT, OTHER])
  })

  test("drops an event for a directory without a store", () => {
    expect(targets(event("session.created", "/elsewhere"), [ROOT])).toEqual([])
  })
})

describe("createPanelData", () => {
  test("reads the handshake and catalog once for every store of one connection", async () => {
    requests.length = 0
    const api = OpenCode.make({ baseUrl: `http://127.0.0.1:${server.port}` })
    await createRoot(async (dispose) => {
      const panel = createPanelData({ post: () => {}, api })
      panel.store(ROOT)
      panel.store(WORKTREE)
      await until(() => requests.some((item) => item.path.includes("kilocode.handshake")))
      await Bun.sleep(50)
      expect(requests.filter((item) => item.path.includes("kilocode.handshake"))).toHaveLength(1)
      expect(requests.filter((item) => item.path.includes("catalog.status"))).toHaveLength(1)
      dispose()
    })
  })

  test("loads a session list only for a shown directory", async () => {
    requests.length = 0
    const api = OpenCode.make({ baseUrl: `http://127.0.0.1:${server.port}` })
    await createRoot(async (dispose) => {
      const panel = createPanelData({ post: () => {}, api })
      panel.store(WORKTREE)
      await until(() => panel.connection.status() === "connected")
      await Bun.sleep(50)
      expect(requests.filter((item) => item.path === "/api/session" && item.directory === WORKTREE)).toHaveLength(0)
      panel.show([WORKTREE])
      await until(() =>
        requests.some((item) => item.path === "/api/session" && item.directory === WORKTREE),
      )
      expect(
        requests.filter((item) => item.path === "/api/session" && item.directory === WORKTREE).length,
      ).toBe(1)
      dispose()
    })
  })

  test("loads a hidden directory's location when it is shown, not when the server connects", async () => {
    requests.length = 0
    const api = OpenCode.make({ baseUrl: `http://127.0.0.1:${server.port}` })
    await createRoot(async (dispose) => {
      const panel = createPanelData({ post: () => {}, api })
      // Both stores exist before the server connects, as after a panel reopen or a reconnect.
      panel.store(ROOT)
      panel.store(WORKTREE)
      panel.show([ROOT])
      const located = (directory: string) =>
        requests.filter((item) => item.path === "/api/location" && item.location === directory)
      await until(() => located(ROOT).length > 0)
      await Bun.sleep(50)
      expect(located(WORKTREE)).toHaveLength(0)

      panel.show([WORKTREE])
      await until(() => located(WORKTREE).length > 0)
      panel.show([WORKTREE])
      await Bun.sleep(50)
      expect(located(WORKTREE)).toHaveLength(1)
      dispose()
    })
  })

  test("loads the location of a directory opened after the server connected once it is shown", async () => {
    requests.length = 0
    const api = OpenCode.make({ baseUrl: `http://127.0.0.1:${server.port}` })
    await createRoot(async (dispose) => {
      const panel = createPanelData({ post: () => {}, api })
      panel.store(ROOT)
      await until(() => panel.connection.status() === "connected")
      panel.store(WORKTREE)
      const located = () =>
        requests.filter((item) => item.path === "/api/location" && item.location === WORKTREE)
      await Bun.sleep(50)
      expect(located()).toHaveLength(0)
      panel.show([WORKTREE])
      await until(() => located().length > 0)
      dispose()
    })
  })

  test("fans one event stream out to lazily created directory stores", async () => {
    const api = OpenCode.make({ baseUrl: `http://127.0.0.1:${server.port}` })
    await createRoot(async (dispose) => {
      const panel = createPanelData({ post: () => {}, api })
      const root = panel.store(ROOT)
      const worktree = panel.store(WORKTREE)
      expect(panel.store(`${ROOT}/`)).toBe(root)
      expect(panel.directories()).toEqual([ROOT, WORKTREE])
      await until(() => panel.connection.status() === "connected" && streams.size > 0)

      emit(created("ses_root", ROOT))
      emit(created("ses_tree", WORKTREE))
      emit(created("ses_other", OTHER))
      await until(() => !!root.data.session.get("ses_root") && !!worktree.data.session.get("ses_tree"))

      expect(root.data.session.get("ses_tree")).toBeUndefined()
      expect(worktree.data.session.get("ses_root")).toBeUndefined()
      expect(root.data.session.get("ses_other")).toBeUndefined()
      expect(worktree.data.session.get("ses_other")).toBeUndefined()

      // A released store gets no more events, and a new store for the same directory starts empty.
      panel.release(WORKTREE)
      expect(panel.directories()).toEqual([ROOT])
      const fresh = panel.store(WORKTREE)
      expect(fresh).not.toBe(worktree)
      expect(fresh.data.session.get("ses_tree")).toBeUndefined()

      panel.retain([ROOT])
      expect(panel.directories()).toEqual([ROOT])
      dispose()
    })
  })

  test("lists a session that two stores loaded once, in the store of its directory", async () => {
    const api = OpenCode.make({ baseUrl: `http://127.0.0.1:${server.port}` })
    await createRoot(async (dispose) => {
      const panel = createPanelData({ post: () => {}, api })
      const sessions = createSessions({ panel, directories: () => [ROOT, WORKTREE], directoryOf: () => undefined })
      const info = {
        id: "ses_shared",
        projectID: "prj_1",
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: 1, updated: 1 },
        location: { directory: WORKTREE },
      }
      panel.store(ROOT).data.session.remember(info)
      panel.store(WORKTREE).data.session.remember(info)
      await until(() => sessions.sessions().length > 0)
      expect(sessions.sessions().map((item) => item.id)).toEqual(["ses_shared"])
      expect(sessions.scope("ses_shared")).toBe(panel.store(WORKTREE))
      dispose()
    })
  })

  test("forwards shift-click so the host opens the system browser", async () => {
    const api = OpenCode.make({ baseUrl: `http://127.0.0.1:${server.port}` })
    await createRoot(async (dispose) => {
      const posted: unknown[] = []
      const panel = createPanelData({ post: (message) => posted.push(message), api })
      panel.store(ROOT).open("https://kilo.ai/a", true)
      panel.store(ROOT).open("https://kilo.ai/b")
      expect(posted.filter((item) => (item as { type: string }).type === "open")).toEqual([
        { type: "open", url: "https://kilo.ai/a", external: true },
        { type: "open", url: "https://kilo.ai/b", external: undefined },
      ])
      dispose()
    })
  })
})
