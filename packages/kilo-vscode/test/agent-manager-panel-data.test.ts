// The Agent Manager panel shares one event stream between per-directory `createData` stores. A local server streams
// real server events, and each store must receive only the events of its own directory.
import { afterAll, afterEach, describe, expect, jest, mock, setDefaultTimeout, test } from "bun:test"
import { OpenCode, type OpenCodeEvent } from "@opencode/client"
import { once } from "node:events"
import path from "node:path"
import { setImmediate } from "node:timers/promises"
import { git, initGit } from "../../core/test/fixture/git"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { command, start, stop } from "../src/server"
import { panelRelay } from "./fixtures/panel-relay"

// Real server round trips and loaded CI runners need more than the default deadline.
setDefaultTimeout(30_000)

// Another test may have loaded Solid's server build. Await its replacement so project switches notify the panel.
const CLIENT_SOLID = "solid-js/dist/solid.js"
await mock.module("solid-js", () => import(CLIENT_SOLID))
// The client build of the store, so store writes reach the memos of the client Solid build.
const CLIENT_STORE = "solid-js/store/dist/store.js"
await mock.module("solid-js/store", () => import(CLIENT_STORE))
const { createEffect, createRoot, createSignal } = await import("solid-js")
// The webview page: the event stream reconnects on page lifecycle events.
Object.assign(globalThis, {
  window: new EventTarget(),
  document: Object.assign(new EventTarget(), { visibilityState: "visible" }),
})
const { createPanelData, key, targets } = await import("../webview-ui/agent-manager/v2/panel-data")
const { createAppSession } = await import("../webview-ui/agent-manager/app-session")
const { createSessions } = await import("../webview-ui/agent-manager/v2/sessions")
const { createSessionActivity } = await import("../webview-ui/agent-manager/project/session-busy")

const ROOT = "/repo"
const WORKTREE = "/repo/.kilo/worktrees/one"
const OTHER = "/other"
/** A worktree whose folder is gone: the fake server cannot open its Location. */
const MISSING = "/repo/.kilo/worktrees/missing"

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

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

/** How many handshake calls the fake server answers with a page instead of JSON. */
let unreadableHandshakes = 0
/** How many session list calls the fake server answers with a page instead of JSON. */
let unreadableLists = 0

const server = Bun.serve({
  port: 0,
  fetch(request) {
    const url = new URL(request.url)
    requests.push({
      path: url.pathname,
      directory: url.searchParams.get("directory"),
      location: url.searchParams.get("location[directory]"),
    })
    if (url.pathname === "/api/rpc/kilocode.handshake/get") {
      if (unreadableHandshakes > 0) {
        unreadableHandshakes--
        return new Response("<html>not the server</html>", { headers: { "content-type": "text/html" } })
      }
      return json({ output: { product: "kilo", version: "test", channel: "local" } })
    }
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
    const match = /^\/api\/session\/(ses_[^/]+)$/.exec(url.pathname)
    const directory = match ? sessions.get(match[1]!) : undefined
    if (match && !directory)
      return json({ _tag: "SessionNotFoundError", sessionID: match[1], message: "Session not found" }, 404)
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
    if (url.pathname === "/api/session/active") return json({ data: {} })
    if (url.pathname === "/api/location" && url.searchParams.get("location[directory]") === MISSING)
      return json(
        { _tag: "LocationNotFoundError", location: { directory: MISSING }, message: `Location not found: ${MISSING}` },
        404,
      )
    if (url.pathname === "/api/location") {
      const directory = url.searchParams.get("location[directory]") ?? ROOT
      return json({ directory, project: { id: "prj_1", directory: ROOT, canonical: ROOT } })
    }
    if (url.pathname === "/api/vcs")
      return json({ location: { directory: ROOT }, data: { branch: { current: "main", default: "main" } } })
    if (url.pathname === "/api/project")
      return json([{ id: "prj_1", canonical: ROOT, time: { created: 1, updated: 1 }, sandboxes: [] }])
    if (url.pathname === "/api/session") {
      if (unreadableLists > 0) {
        unreadableLists--
        return new Response("<html>not the server</html>", { headers: { "content-type": "text/html" } })
      }
      return json({ data: [], location: { directory: ROOT } })
    }
    return new Response(JSON.stringify({ _tag: "NotFound", message: "not found" }), { status: 404 })
  },
})

afterAll(() => server.stop(true))

async function until(check: () => boolean, attempts = 100) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (check()) return
    await Bun.sleep(20)
  }
  throw new Error("condition not reached")
}

// Observe the real panel store. Only a missing update should hit the deadline; a wrong badge fails immediately.
function when(label: string, check: () => boolean) {
  return new Promise<void>((resolve, reject) => {
    createRoot((dispose) => {
      const timer = setTimeout(() => {
        dispose()
        reject(new Error(`Panel never observed ${label}`))
      }, 30_000)
      createEffect(() => {
        if (!check()) return
        clearTimeout(timer)
        dispose()
        resolve()
      })
    })
  })
}

test("keeps a pending form on the owning Local row when switching projects", async () => {
  await using storage = await tmpdir("kilo-vscode-project-waiting-")
  const alpha = path.join(storage.path, "Alpha")
  const bravo = path.join(storage.path, "Bravo")
  await Promise.all(
    [alpha, bravo].map(async (directory) => {
      await initGit(directory)
      await git(directory, "commit", "--allow-empty", "-m", path.basename(directory))
    }),
  )
  const found = command({ extension: path.resolve(import.meta.dir, ".."), storage: storage.path, env: {} })
  if (!found) throw new Error("dev entry not found")
  const server = await start({ command: found, cwd: alpha, env: process.env })
  try {
    const api = OpenCode.make({ baseUrl: server.url, headers: { authorization: server.authorization } })
    const [first, second] = await Promise.all([
      api.session.create({ location: { directory: alpha } }),
      api.session.create({ location: { directory: bravo } }),
    ])
    expect(first.projectID).not.toBe(second.projectID)
    await createRoot(async (dispose) => {
      try {
        const [active, setActive] = createSignal(first.projectID)
        const items = { [first.projectID]: [{ ...first }], [second.projectID]: [{ ...second }] }
        const directory = () => (active() === first.projectID ? alpha : bravo)
        const panel = createPanelData({ post: () => {}, api })
        panel.show([alpha])
        panel.store(bravo)
        const sessions = createSessions({ panel, directories: () => [directory()], directoryOf: directory })
        const rows = createSessionActivity({
          managed: () => [],
          local: () => (items[active()] ?? []).map((item) => item.id),
          projects: () => items,
          active,
          activityFor: sessions.activityFor,
        })
        await when("server.connected", () => panel.connection.status() === "connected")
        const form = await api.session.form.create({
          sessionID: first.id,
          title: "Which color?",
          fields: [{ key: "color", type: "string", required: true }],
        })
        const forms = panel.store(alpha).data.session.form
        const pending = () => forms.list(first.id)?.some((item) => item.id === form.id) ?? false
        await when("Alpha's pending form", pending)
        expect(rows.project(first.projectID, null)).toBe("waiting")

        setActive(second.projectID)
        panel.show([bravo])
        expect(rows.project(second.projectID, null)).toBe("idle")
        expect(rows.project(first.projectID, null)).toBe("waiting")
        expect(await api.session.form.list({ sessionID: first.id })).toEqual([form])
        expect(await api.session.form.list({ sessionID: second.id })).toEqual([])

        setActive(first.projectID)
        expect(rows.project(first.projectID, null)).toBe("waiting")
        await api.session.form.reply({ sessionID: first.id, formID: form.id, answer: { color: "Blue" } })
        await when("Alpha's form reply", () => !pending())
        expect(rows.project(first.projectID, null)).toBe("idle")
        expect(await api.session.form.list({ sessionID: first.id })).toEqual([])
        setActive(second.projectID)
        expect(rows.project(first.projectID, null)).toBe("idle")
        expect(rows.project(second.projectID, null)).toBe("idle")
      } finally {
        dispose()
      }
    })
  } finally {
    const exited = once(server.process, "exit")
    stop(server.process)
    await exited
  }
}, 90_000)

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

  test("normalizes Windows backslashes, drive/case variants, and trailing slashes", () => {
    const winRoot = "c:/users/alice/repo"
    const winTree = "c:/users/alice/repo/.kilo/worktrees/one"
    expect(key("C:\\Users\\Alice\\Repo\\")).toBe(winRoot)
    expect(key("C:\\")).toBe("c:/")
    expect(key("c:")).toBe("c:/")
    expect(key("\\\\Server\\Share\\Repo\\")).toBe("//server/share/repo")
    expect(targets(event("model.updated", "C:\\Users\\Alice\\Repo"), [winRoot, winTree])).toEqual([winRoot])
    expect(targets(event("provider.updated", "C:\\Users\\Alice\\Repo\\.kilo\\worktrees\\one\\"), [winRoot, winTree])).toEqual([
      winTree,
    ])
    expect(targets(event("model.updated", "c:/users/alice/repo"), ["C:\\Users\\Alice\\Repo"])).toEqual([
      "C:\\Users\\Alice\\Repo",
    ])
  })

  test("broadcasts events without a location and session moves", () => {
    expect(targets(event("server.connected"), [ROOT, OTHER])).toEqual([ROOT, OTHER])
    expect(targets(event("session.moved", WORKTREE), [ROOT, OTHER])).toEqual([ROOT, OTHER])
  })

  test("drops an event for a directory without a store", () => {
    expect(targets(event("session.created", "/elsewhere"), [ROOT])).toEqual([])
  })
})

describe("createAppSession.sendInitial", () => {
  const model = { providerID: "fixture", id: "selected", enabled: true }
  const initial = {
    type: "agentManager.sendInitialMessage" as const,
    sessionId: "ses_initial",
    projectId: "project",
    worktreeId: "one",
    providerID: model.providerID,
    modelID: model.id,
    agent: "code",
    text: "Fix it",
  }
  const translate = (key: string) => `translated: ${key}`
  const errorToast = (key: string) => ({
    variant: "error",
    title: translate("agentManager.error.title"),
    description: translate(key),
  })
  const unmapped = { ...initial, worktreeId: "not-indexed", variant: "high" }
  const target = `/api/session/${initial.sessionId}`

  function openPanel(
    pause: "model" | "lookup" | "publication" = "model",
    directories = pause === "model" ? [ROOT, WORKTREE] : [ROOT],
  ) {
    const requested = Promise.withResolvers<void>()
    const late = Promise.withResolvers<void>()
    const root = () => directories[0]
    const [retained, setRetained] = createSignal(directories)
    const mutations: [string, unknown][] = []
    const toasts: unknown[] = []
    let published = false
    sessions.set(initial.sessionId, WORKTREE)
    const relay = panelRelay({ url: server.url.href, authorization: "Basic fixture" }, async (request) => {
      const url = new URL(request.url)
      if (url.pathname.startsWith("/api/session") && request.method !== "GET") {
        const body = await request.json()
        mutations.push([url.pathname, body])
        return url.pathname.endsWith("/prompt") ? json({ data: { id: body.id } }) : new Response(null, { status: 204 })
      }
      if (url.pathname === "/api/session/ses_unavailable") return json({}, 503)
      if (pause === "lookup" && url.pathname === target) {
        const response = await fetch(request)
        requested.resolve()
        await late.promise
        return response
      }
      if (url.pathname !== "/api/model") return fetch(request)
      const directory = url.searchParams.get("location[directory]")
      if (directory === WORKTREE) {
        requested.resolve()
        if (pause === "model") await late.promise
        if (pause === "publication" && !published) return json({ location: { directory }, data: [] })
      }
      return json({ location: { directory }, data: [model] })
    })
    return createRoot((dispose) => ({
      app: createAppSession({
        vscode: relay.vscode,
        rootDirectory: root,
        commandProject: () => undefined,
        directories: {
          root,
          worktreePath: () => undefined,
          worktreePathIn: (project, id) => (project === "project" && id === "one" ? WORKTREE : undefined),
          sessionDirectories: () => directories,
          visibleDirectories: () => directories.slice(0, 1),
          retained,
          missingDirectories: () => [],
          directoryOf: root,
        },
      }),
      requested: requested.promise,
      release: late.resolve,
      refresh: () => setRetained([...directories]),
      publish() {
        published = true
        emit({ id: "evt_publish", type: "model.updated", created: 1, location: { directory: WORKTREE }, data: {} })
      },
      mutations,
      toasts,
      feedback: { t: translate, toast: (value: unknown) => toasts.push(value), project: "other-project" },
      dispose,
      [Symbol.dispose]() {
        late.resolve()
        dispose()
        relay.dispose()
        sessions.delete(initial.sessionId)
      },
    }))
  }

  afterEach(() => jest.useRealTimers())

  test.each(["prompt", "command"])("waits for the persisted worktree before sending an unmapped %s once", async (kind) => {
    using panel = openPanel("publication")
    const root = panel.app.rootStore()!
    await when("panel connection", () => panel.app.panel.connection.status() === "connected")
    await root.data.location.model.sync()
    expect(panel.app.models().find((row) => row.enabled && row.providerID === model.providerID)?.id).toBe(model.id)
    expect(panel.app.panel.find(WORKTREE)).toBeUndefined()

    const ev = kind === "command" ? { ...unmapped, text: undefined, command: "goal", arguments: "ship it" } : unmapped
    const pending = panel.app.sendInitial(ev, panel.feedback)
    await Promise.race([panel.requested, pending])
    expect(root.failure()?.message).not.toBe(translate("agentManager.project.missing"))
    const worktree = panel.app.panel.find(WORKTREE)!
    await worktree.data.location.model.sync()
    expect(worktree.data.location.model.list()).toHaveLength(0)
    panel.refresh() // The project snapshot still does not list the session's directory.
    expect(panel.app.panel.find(WORKTREE)?.directory).toBe(WORKTREE)
    expect(panel.mutations).toEqual([])
    panel.app.panel.store(OTHER)
    panel.publish()
    await pending
    expect(panel.app.panel.find(WORKTREE)).toBeUndefined()
    expect(panel.app.panel.find(OTHER)?.directory).toBe(OTHER)
    expect(panel.mutations).toEqual([
      [`${target}/agent`, { agent: initial.agent }],
      [`${target}/model`, { model: { providerID: model.providerID, id: model.id, variant: unmapped.variant } }],
      [
        `${target}/${kind}`,
        kind === "command" ? { name: "goal", text: "ship it" } : { id: expect.any(String), text: initial.text },
      ],
    ])
    expect(panel.toasts).toEqual([])
  })

  test("notifies once for a missing session even without a root store", async () => {
    using panel = openPanel("publication", [])
    expect(panel.app.rootStore()).toBeUndefined()
    await panel.app.sendInitial({ ...unmapped, sessionId: "ses_missing" }, panel.feedback)
    expect(panel.toasts).toEqual([errorToast("agentManager.project.missing")])
    expect(panel.app.panel.directories()).toEqual([])
    expect(panel.mutations).toEqual([])
  })

  test("reports a failed lookup instead of sending through the warm fallback store", async () => {
    using panel = openPanel("publication")
    const root = panel.app.rootStore()!
    await root.data.location.model.sync()
    expect(panel.app.models().find((row) => row.enabled && row.providerID === model.providerID)?.id).toBe(model.id)
    await panel.app.sendInitial({ ...unmapped, sessionId: "ses_unavailable" }, panel.feedback)
    expect(panel.toasts).toEqual([errorToast("error.failure.trouble")])
    expect(root.failure()?.key).not.toBe("error.failure.trouble")
    expect(panel.mutations).toEqual([])
  })

  describe.each(["lookup", "publication"] as const)("recovery waiting for %s", (pause) => {
    test.each(["timeout", "disposal"])("does not switch or send after %s", async (reason) => {
      using panel = openPanel(pause)
      const root = panel.app.rootStore()!
      await when("panel connection", () => panel.app.panel.connection.status() === "connected")
      if (reason === "timeout") jest.useFakeTimers()
      const pending = panel.app.sendInitial(unmapped, panel.feedback)
      await Promise.race([panel.requested, pending])
      const worktree = panel.app.panel.find(WORKTREE)
      if (pause === "publication") {
        await worktree?.data.location.model.sync()
        expect(worktree?.data.location.model.list()).toEqual([])
      } else expect(worktree).toBeUndefined()
      expect(panel.mutations).toEqual([])
      expect(panel.toasts).toEqual([])

      if (reason === "timeout") jest.advanceTimersByTime(30_000)
      else panel.dispose()
      await pending
      panel.release()
      panel.publish()
      await setImmediate()
      expect(panel.app.panel.find(WORKTREE)).toBeUndefined()
      expect(panel.toasts).toEqual(reason === "timeout" ? [errorToast("error.failure.timeout")] : [])
      expect(root.failure()?.message).not.toBe(translate("error.failure.timeout"))
      expect(worktree?.failure()).toBeUndefined()
      expect(panel.mutations).toEqual([])
    })
  })

  test.each(["timeout", "disposal"])("does not switch or send after a worktree model wait ends by %s", async (reason) => {
    using panel = openPanel()
    const store = panel.app.panel.store(WORKTREE)
    if (reason === "timeout") jest.useFakeTimers()
    const pending = panel.app.sendInitial(initial, panel.feedback)
    await panel.requested
    if (reason === "timeout") jest.advanceTimersByTime(30_000)
    else panel.dispose()
    await pending

    panel.release()
    await setImmediate() // Deliver the late model reply before checking for a report or session mutation.
    if (reason === "timeout") expect(store.failure()?.message).toBe(translate("error.failure.timeout"))
    else expect(store.failure()).toBeUndefined()
    expect(panel.toasts).toEqual([])
    expect(panel.mutations).toEqual([])
  })
})

describe("createPanelData", () => {
  test("reads the handshake once for every store of one connection and catalog status per shown store", async () => {
    requests.length = 0
    const api = OpenCode.make({ baseUrl: `http://127.0.0.1:${server.port}` })
    await createRoot(async (dispose) => {
      const panel = createPanelData({ post: () => {}, api })
      panel.store(ROOT)
      panel.store(WORKTREE)
      await until(() => requests.some((item) => item.path.includes("kilocode.handshake")))
      await Bun.sleep(50)
      expect(requests.filter((item) => item.path.includes("kilocode.handshake"))).toHaveLength(1)
      expect(requests.filter((item) => item.path.includes("catalog.status"))).toHaveLength(0)

      panel.show([ROOT])
      await until(() => requests.some((item) => item.path.includes("catalog.status") && item.location === ROOT))
      await Bun.sleep(50)
      expect(requests.filter((item) => item.path.includes("catalog.status"))).toHaveLength(1)

      panel.show([WORKTREE])
      await until(() => requests.some((item) => item.path.includes("catalog.status") && item.location === WORKTREE))
      expect(requests.filter((item) => item.path.includes("kilocode.handshake"))).toHaveLength(1)
      expect(requests.filter((item) => item.path.includes("catalog.status") && item.location === WORKTREE)).toHaveLength(
        1,
      )
      dispose()
    })
  })

  test("retries a handshake the server answered with a response the client cannot read", async () => {
    requests.length = 0
    unreadableHandshakes = 1
    const api = OpenCode.make({ baseUrl: `http://127.0.0.1:${server.port}` })
    await createRoot(async (dispose) => {
      const panel = createPanelData({ post: () => {}, api })
      const scope = panel.store(ROOT)
      await until(() => scope.handshake() !== undefined)
      expect(scope.handshake()?.key).toBe("error.failure.notKilo")
      // The banner clears on its own once a later read succeeds, without a window reload.
      await until(() => scope.handshake() === undefined)
      expect(scope.version()).toBe("test")
      dispose()
    })
  })

  test("clears the failure a failed session list reported once a later read succeeds", async () => {
    const api = OpenCode.make({ baseUrl: `http://127.0.0.1:${server.port}` })
    await createRoot(async (dispose) => {
      const panel = createPanelData({ post: () => {}, api })
      const scope = panel.store(ROOT)
      // Hydration reads of this fake answer 404 and report their own failure; start from a clean banner.
      await until(() => panel.connection.status() === "connected")
      await Bun.sleep(100)
      scope.clearError()
      unreadableLists = 1
      panel.show([ROOT])
      await until(() => scope.failure()?.key === "error.failure.unreadable")
      // The list retries after one second; the banner it reported clears with the data.
      await until(() => scope.failure() === undefined, 200)
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

  test("reads a session from the store of its directory when only another store loaded it", async () => {
    const api = OpenCode.make({ baseUrl: `http://127.0.0.1:${server.port}` })
    await createRoot(async (dispose) => {
      const panel = createPanelData({ post: () => {}, api })
      // The host files the session under the root, but the server runs it in the worktree.
      const sessions = createSessions({ panel, directories: () => [ROOT, WORKTREE], directoryOf: () => ROOT })
      panel.store(ROOT).data.session.remember({
        id: "ses_elsewhere",
        projectID: "prj_1",
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: 1, updated: 1 },
        location: { directory: WORKTREE },
      })
      await until(() => sessions.sessions().length > 0)
      expect(sessions.scope("ses_elsewhere")).toBe(panel.store(WORKTREE))
      dispose()
    })
  })

  // A subagent can move itself (the session_move tool) to a directory the project does not track. Its later events go
  // only to that directory's store, so the inspector must read it from there instead of the store whose events stopped.
  test("follows a watched subagent that moves to a directory outside the project", async () => {
    const api = OpenCode.make({ baseUrl: `http://127.0.0.1:${server.port}` })
    await createRoot(async (dispose) => {
      const panel = createPanelData({ post: () => {}, api })
      const layer = createSessions({ panel, directories: () => [ROOT, WORKTREE], directoryOf: () => ROOT })
      await until(() => panel.connection.status() === "connected" && streams.size > 0)
      emit(created("ses_sub", ROOT))
      await until(() => !!panel.store(ROOT).data.session.get("ses_sub"))
      layer.watch(["ses_sub"])
      void layer.sync("ses_sub")
      expect(layer.scope("ses_sub")).toBe(panel.store(ROOT))

      sessions.set("ses_sub", OTHER)
      emit({
        id: "evt_ses_sub_moved",
        created: Date.now(),
        type: "session.moved",
        durable: { aggregateID: "ses_sub", seq: 2, version: 1 },
        location: { directory: OTHER },
        data: { sessionID: "ses_sub", projectID: "prj_1", subpath: "", location: { directory: OTHER } },
      })

      await until(() => !!panel.find(OTHER)?.data.session.get("ses_sub"))
      expect(layer.followed()).toEqual([OTHER])
      expect(layer.scope("ses_sub")).toBe(panel.find(OTHER))
      // The followed directory's own sessions stay out of the project's session list.
      emit(created("ses_foreign", OTHER))
      await until(() => !!panel.find(OTHER)?.data.session.get("ses_foreign"))
      expect(layer.sessions().map((item) => item.id)).not.toContain("ses_foreign")

      // A tab the inspector no longer shows (closed, or of another parent session) stops following the directory.
      layer.watch([])
      expect(layer.followed()).toEqual([])
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

  // A worktree folder deleted on disk fails every load of its store. Once the folder is restored, the store clears the
  // failure and loads its location again instead of keeping both until the panel reopens.
  test("reloads a directory after its folder was restored", async () => {
    requests.length = 0
    const api = OpenCode.make({ baseUrl: `http://127.0.0.1:${server.port}` })
    await createRoot(async (dispose) => {
      const panel = createPanelData({ post: () => {}, api })
      const store = panel.store(MISSING)
      panel.show([MISSING])
      const located = () => requests.filter((item) => item.path === "/api/location" && item.location === MISSING)
      await until(() => located().length > 0 && store.failure()?.message === `Location not found: ${MISSING}`)
      const before = located().length

      panel.reload(MISSING)
      expect(store.failure()).toBeUndefined()
      await until(() => located().length > before)
      panel.reload(OTHER)
      dispose()
    })
  })

  // The host sends a cycle shortcut as an action, which a dialog can consume. Without a dialog it must reach the
  // mounted views as the same command the sidebar receives, so a composer without a session still cycles its agent.
  test("dispatches a host command to the mounted views", async () => {
    const api = OpenCode.make({ baseUrl: `http://127.0.0.1:${server.port}` })
    await createRoot(async (dispose) => {
      const panel = createPanelData({ post: () => {}, api })
      const names: string[] = []
      panel.store(ROOT).onCommand((name) => names.push(name))
      panel.command("cycleAgentMode")
      panel.receive({ type: "command", name: "cyclePreviousAgentMode" })
      expect(names).toEqual(["cycleAgentMode", "cyclePreviousAgentMode"])
      dispose()
    })
  })
})
