// Agent Manager re-login recovery across multiple directory stores:
// 1. Cross-platform path canonicalization + `syncInfo()` `defaultLocation` alignment so Wave-2 located `model.updated`
//    and `provider.updated` events reach the right store and land under the key `list()` reads.
// 2. Per-directory `createKiloModels` isolation so one store's Wave-1 empty-Kilo reload cannot cancel another store's
//    in-flight Wave-2 authenticated read, while true sign-out clears stale entries and team state.
// 3. Per-directory `kiloFailure` / `catalog.status` updates without latching to the first directory ever created.
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test"
import { OpenCode, type ModelInfo, type OpenCodeClient } from "@opencode/client"
import type { KiloGatewayRpc } from "@opencode/schema/kilocode/gateway"
import type { Accessor, Setter } from "solid-js"

const CLIENT_SOLID = "solid-js/dist/solid.js"
await mock.module("solid-js", () => import(CLIENT_SOLID))
const CLIENT_STORE = "solid-js/store/dist/store.js"
await mock.module("solid-js/store", () => import(CLIENT_STORE))

const { createRoot, createSignal } = (await import(CLIENT_SOLID)) as {
  createRoot: <T>(fn: (dispose: () => void) => T) => T
  createSignal: <T>(value: T) => [Accessor<T>, Setter<T>]
}
Object.assign(globalThis, {
  window: new EventTarget(),
  document: Object.assign(new EventTarget(), { visibilityState: "visible" }),
})

const { createPanelData } = await import("../webview-ui/agent-manager/v2/panel-data")
const { createKiloModels } = await import("../webview-ui/src/v2/kilo-models")
const { catalogEvent } = await import("../webview-ui/src/v2/kilo-catalog")
const { directoryKey } = await import("../src/shared/directory-key")

const WIN_ROOT_STORE = "c:/users/alice/repo"
const WIN_ROOT_SERVER = "C:\\Users\\Alice\\Repo"
const WIN_TREE_STORE = "c:/users/alice/repo/.kilo/worktrees/one"
const WIN_TREE_SERVER = "C:\\Users\\Alice\\Repo\\.kilo\\worktrees\\one"
const WIN_HIDDEN_STORE = "c:/users/alice/repo/.kilo/worktrees/hidden"
const WIN_HIDDEN_SERVER = "C:\\Users\\Alice\\Repo\\.kilo\\worktrees\\hidden"
const SYMLINK_STORE = "/tmp/alice-repo"
const SYMLINK_SERVER = "/private/tmp/alice-repo"

const CANONICAL = new Map<string, string>([
  [directoryKey(WIN_ROOT_STORE), WIN_ROOT_SERVER],
  [directoryKey(WIN_TREE_STORE), WIN_TREE_SERVER],
  [directoryKey(WIN_HIDDEN_STORE), WIN_HIDDEN_SERVER],
  [directoryKey(SYMLINK_STORE), SYMLINK_SERVER],
  [directoryKey(SYMLINK_SERVER), SYMLINK_SERVER],
])

type LocationState = {
  models: Array<{ providerID: string; id: string; enabled: boolean }>
  providers: Array<{ id: string; name: string }>
  gatewayModels: KiloGatewayRpc.ModelEntry[]
  auth: KiloGatewayRpc.AuthStatus
  catalog: KiloGatewayRpc.CatalogStatus
}

const modelRow = (providerID: string, id: string) => ({ providerID, id, enabled: true })
const providerRow = (id: string, name: string) => ({ id, name })
const gatewayEntry = (id: string, name: string): KiloGatewayRpc.ModelEntry => ({ id, name, isFree: false })
const signedIn = (organizationID: string | null): KiloGatewayRpc.AuthStatus => ({
  authenticated: true,
  organizationID,
  server: "https://api.kilo.ai",
})
const signedOut: KiloGatewayRpc.AuthStatus = {
  authenticated: false,
  organizationID: null,
  server: "https://api.kilo.ai",
}

const encoder = new TextEncoder()
const streams = new Set<ReadableStreamDefaultController<Uint8Array>>()
const requests: Array<{ path: string; location: string | null }> = []
const locations = new Map<string, LocationState>()
let locationGate: PromiseWithResolvers<void> | undefined

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

const canonicalFor = (directory: string) => CANONICAL.get(directoryKey(directory)) ?? directory

const stateFor = (directory: string): LocationState =>
  locations.get(directoryKey(canonicalFor(directory))) ?? {
    models: [],
    providers: [],
    gatewayModels: [],
    auth: signedOut,
    catalog: { failure: null },
  }

const setLocation = (directory: string, state: LocationState) => {
  locations.set(directoryKey(canonicalFor(directory)), state)
}

const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const url = new URL(request.url)
    const requested = url.searchParams.get("location[directory]")
    requests.push({ path: url.pathname, location: requested })

    if (url.pathname === "/api/event") {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          streams.add(controller)
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "server.connected", id: "evt_connected", created: 0, data: {} })}\n\n`,
            ),
          )
        },
        cancel(controller) {
          streams.delete(controller as unknown as ReadableStreamDefaultController<Uint8Array>)
        },
      })
      return new Response(body, { headers: { "content-type": "text/event-stream" } })
    }

    const dir = canonicalFor(requested ?? WIN_ROOT_STORE)
    const state = stateFor(dir)

    if (url.pathname === "/api/plugin") return json({ data: [{ id: "kilocode.handshake" }], location: { directory: dir } })
    if (url.pathname === "/api/rpc/kilocode.handshake/get")
      return json({ output: { product: "kilo", version: "2.0.0-test", channel: "local" } })
    if (url.pathname === "/api/rpc/kilocode.gateway/catalog.status") return json({ output: state.catalog })
    if (url.pathname === "/api/rpc/kilocode.gateway/models") return json({ output: state.gatewayModels })
    if (url.pathname === "/api/rpc/kilocode.gateway/authStatus") return json({ output: state.auth })
    if (url.pathname === "/api/location") {
      if (locationGate) await locationGate.promise
      return json({ directory: dir, project: { id: "prj_1", directory: dir, canonical: dir } })
    }
    if (url.pathname === "/api/vcs")
      return json({ location: { directory: dir }, data: { branch: { current: "main", default: "main" } } })
    if (url.pathname === "/api/project")
      return json([{ id: "prj_1", canonical: dir, time: { created: 1, updated: 1 }, sandboxes: [] }])
    if (url.pathname === "/api/session/active") return json({ data: {} })
    if (url.pathname === "/api/session") return json({ data: [], location: { directory: dir } })
    if (url.pathname === "/api/model") return json({ location: { directory: dir }, data: state.models })
    if (url.pathname === "/api/provider") return json({ location: { directory: dir }, data: state.providers })
    if (url.pathname === "/api/command")
      return json({ location: { directory: dir }, data: [{ name: "audit-win", description: "Audit", template: "" }] })
    if (url.pathname === "/api/config") return json([{ type: "document", info: { model: "kilo/v1" } }])
    return json({ _tag: "NotFound", message: "not found" }, 404)
  },
})

afterAll(() => {
  locationGate?.resolve()
  for (const controller of streams) controller.close()
  streams.clear()
  server.stop(true)
})

beforeEach(() => {
  locationGate?.resolve()
  locationGate = undefined
  requests.length = 0
  locations.clear()
})

async function until(check: () => boolean, attempts = 150) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (check()) return
    await Bun.sleep(15)
  }
  throw new Error("condition not reached")
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe("Agent Manager two-wave logout -> re-login recovery", () => {
  test("recovers models, providers, and gateway metadata across Windows-canonicalized directory stores without duplicate location reads", async () => {
    const initial: LocationState = {
      models: [modelRow("kilo", "kilo/v1")],
      providers: [providerRow("kilo", "Kilo")],
      gatewayModels: [gatewayEntry("kilo/v1", "Kilo v1")],
      auth: signedIn("org_before"),
      catalog: { failure: null },
    }
    setLocation(WIN_ROOT_STORE, { ...initial })
    setLocation(WIN_TREE_STORE, { ...initial })

    const api = OpenCode.make({ baseUrl: `http://127.0.0.1:${server.port}` })
    await createRoot(async (dispose) => {
      try {
        const panel = createPanelData({ post: () => {}, api })
        const root = panel.store(WIN_ROOT_STORE)
        const tree = panel.store(WIN_TREE_STORE)
        panel.show([WIN_ROOT_STORE, WIN_TREE_STORE])

        await until(
          () =>
            root.data.location.default().directory === WIN_ROOT_SERVER &&
            tree.data.location.default().directory === WIN_TREE_SERVER,
        )

        // Aligning defaultLocation reuses the server.connected location.get response instead of issuing a second request.
        await Bun.sleep(40)
        expect(requests.filter((item) => item.path === "/api/location" && item.location === WIN_ROOT_STORE)).toHaveLength(1)
        expect(requests.filter((item) => item.path === "/api/location" && item.location === WIN_TREE_STORE)).toHaveLength(1)

        await Promise.all([
          root.data.location.model.sync(),
          root.data.location.provider.sync(),
          tree.data.location.model.sync(),
          tree.data.location.provider.sync(),
        ])
        await until(
          () => root.kiloModels().organizationID === "org_before" && tree.kiloModels().organizationID === "org_before",
        )
        expect(root.data.location.model.list()?.map((item) => item.id)).toEqual(["kilo/v1"])
        expect(tree.data.location.model.list()?.map((item) => item.id)).toEqual(["kilo/v1"])

        // Wave 1: logout / 401 rotation wipes the catalog and emits unlocated credential.switched.
        const wiped: LocationState = {
          models: [],
          providers: [],
          gatewayModels: [],
          auth: signedOut,
          catalog: { failure: { kind: "unauthorized", status: 401 } },
        }
        setLocation(WIN_ROOT_STORE, { ...wiped })
        setLocation(WIN_TREE_STORE, { ...wiped })
        emit({
          id: "evt_cred_logout",
          created: 1,
          type: "credential.switched",
          data: { integrationID: "kilo", credentialID: "cred_none" },
        })
        await until(
          () =>
            root.data.location.model.list()?.length === 0 &&
            tree.data.location.model.list()?.length === 0 &&
            root.kiloModels().entries.size === 0 &&
            root.kiloModels().organizationID === undefined &&
            tree.kiloModels().entries.size === 0 &&
            tree.kiloModels().organizationID === undefined,
        )

        // Wave 2: re-login populates the fresh catalog and emits located model.updated / provider.updated with Windows backslashes.
        const restored: LocationState = {
          models: [modelRow("kilo", "kilo/v2")],
          providers: [providerRow("kilo", "Kilo")],
          gatewayModels: [gatewayEntry("kilo/v2", "Kilo v2")],
          auth: signedIn("org_after"),
          catalog: { failure: null },
        }
        setLocation(WIN_ROOT_STORE, { ...restored })
        setLocation(WIN_TREE_STORE, { ...restored })
        emit({ id: "evt_root_m", created: 2, type: "model.updated", location: { directory: WIN_ROOT_SERVER }, data: {} })
        emit({ id: "evt_root_p", created: 2, type: "provider.updated", location: { directory: WIN_ROOT_SERVER }, data: {} })
        emit({ id: "evt_tree_m", created: 2, type: "model.updated", location: { directory: WIN_TREE_SERVER }, data: {} })
        emit({ id: "evt_tree_p", created: 2, type: "provider.updated", location: { directory: WIN_TREE_SERVER }, data: {} })

        await until(
          () =>
            root.data.location.model.list()?.some((item) => item.id === "kilo/v2") === true &&
            tree.data.location.model.list()?.some((item) => item.id === "kilo/v2") === true &&
            root.data.location.provider.list()?.some((item) => item.id === "kilo") === true &&
            tree.data.location.provider.list()?.some((item) => item.id === "kilo") === true &&
            root.kiloModels().entries.has("kilo/v2") &&
            tree.kiloModels().entries.has("kilo/v2") &&
            root.kiloModels().organizationID === "org_after" &&
            tree.kiloModels().organizationID === "org_after",
        )
      } finally {
        dispose()
      }
    })
  })

  test("routes located events and recovers models for symlink-canonicalized directories", async () => {
    setLocation(SYMLINK_STORE, {
      models: [modelRow("kilo", "kilo/initial")],
      providers: [providerRow("kilo", "Kilo")],
      gatewayModels: [gatewayEntry("kilo/initial", "Initial")],
      auth: signedIn(null),
      catalog: { failure: null },
    })

    const api = OpenCode.make({ baseUrl: `http://127.0.0.1:${server.port}` })
    await createRoot(async (dispose) => {
      try {
        const panel = createPanelData({ post: () => {}, api })
        const store = panel.store(SYMLINK_STORE)
        panel.show([SYMLINK_STORE])

        await until(() => store.data.location.default().directory === SYMLINK_SERVER)
        await store.data.location.model.sync()
        expect(store.data.location.model.list()?.map((item) => item.id)).toEqual(["kilo/initial"])

        setLocation(SYMLINK_STORE, {
          models: [],
          providers: [],
          gatewayModels: [],
          auth: signedOut,
          catalog: { failure: null },
        })
        emit({
          id: "evt_sym_wipe",
          created: 1,
          type: "credential.switched",
          data: { integrationID: "kilo", credentialID: "cred_none" },
        })
        await until(() => store.data.location.model.list()?.length === 0)

        setLocation(SYMLINK_STORE, {
          models: [modelRow("kilo", "kilo/recovered")],
          providers: [providerRow("kilo", "Kilo")],
          gatewayModels: [gatewayEntry("kilo/recovered", "Recovered")],
          auth: signedIn(null),
          catalog: { failure: null },
        })
        emit({ id: "evt_sym_wave2", created: 2, type: "model.updated", location: { directory: SYMLINK_SERVER }, data: {} })
        await until(() => store.data.location.model.list()?.some((item) => item.id === "kilo/recovered") === true)
      } finally {
        dispose()
      }
    })
  })

  test("canonicalizes defaultLocation for a hidden store that syncs models before show()", async () => {
    setLocation(WIN_HIDDEN_STORE, {
      models: [],
      providers: [],
      gatewayModels: [],
      auth: signedOut,
      catalog: { failure: null },
    })

    const api = OpenCode.make({ baseUrl: `http://127.0.0.1:${server.port}` })
    await createRoot(async (dispose) => {
      try {
        const panel = createPanelData({ post: () => {}, api })
        const hidden = panel.store(WIN_HIDDEN_STORE)
        await until(() => panel.connection.status() === "connected")

        // Model sync runs while hidden (as NewWorktreeDialog or initial-message waitForModel does).
        await hidden.data.location.model.sync()
        await until(() => hidden.data.location.default().directory === WIN_HIDDEN_SERVER)

        setLocation(WIN_HIDDEN_STORE, {
          models: [modelRow("kilo", "kilo/late")],
          providers: [providerRow("kilo", "Kilo")],
          gatewayModels: [gatewayEntry("kilo/late", "Late")],
          auth: signedIn(null),
          catalog: { failure: null },
        })
        emit({
          id: "evt_hidden_wave2",
          created: 2,
          type: "model.updated",
          location: { directory: WIN_HIDDEN_SERVER },
          data: {},
        })
        await until(() => hidden.data.location.model.list()?.some((item) => item.id === "kilo/late") === true)
      } finally {
        dispose()
      }
    })
  })

  test("deduplicates in-flight location.get and preserves config when model/config sync finishes before location.get", async () => {
    setLocation(WIN_ROOT_STORE, {
      models: [modelRow("kilo", "kilo/v1")],
      providers: [providerRow("kilo", "Kilo")],
      gatewayModels: [gatewayEntry("kilo/v1", "Kilo v1")],
      auth: signedIn(null),
      catalog: { failure: null },
    })
    locationGate = Promise.withResolvers<void>()

    const api = OpenCode.make({ baseUrl: `http://127.0.0.1:${server.port}` })
    await createRoot(async (dispose) => {
      try {
        const panel = createPanelData({ post: () => {}, api })
        const root = panel.store(WIN_ROOT_STORE)
        panel.show([WIN_ROOT_STORE])
        await until(() => requests.some((item) => item.path === "/api/location" && item.location === WIN_ROOT_STORE))

        // model.sync() and config.sync() complete while location.get is still in flight.
        await Promise.all([root.data.location.model.sync(), root.data.location.config.sync()])
        expect(root.data.location.default().directory).toBe(WIN_ROOT_STORE)

        // Release location.get: syncInfo shares the in-flight request (still only 1 /api/location call) and resyncs config.
        locationGate!.resolve()
        locationGate = undefined
        await until(() => root.data.location.default().directory === WIN_ROOT_SERVER)
        await until(() => (root.data.location.config.list()?.length ?? 0) > 0)
        expect(requests.filter((item) => item.path === "/api/location" && item.location === WIN_ROOT_STORE)).toHaveLength(1)
        expect(root.data.location.model.list()?.map((item) => item.id)).toEqual(["kilo/v1"])
      } finally {
        locationGate?.resolve()
        dispose()
      }
    })
  })

  test("preserves original Windows store directory on requests while deduplicating normalized aliases and aligning command.list()", async () => {
    const api = OpenCode.make({ baseUrl: `http://127.0.0.1:${server.port}` })
    await createRoot(async (dispose) => {
      try {
        const panel = createPanelData({ post: () => {}, api })
        const winStore = panel.store(WIN_ROOT_SERVER)
        expect(winStore.directory).toBe(WIN_ROOT_SERVER)
        expect(panel.store(WIN_ROOT_STORE)).toBe(winStore)
        expect(panel.find(WIN_ROOT_STORE)).toBe(winStore)
        await until(() => panel.connection.status() === "connected")

        await winStore.data.location.command.sync()
        expect(requests.some((item) => item.path === "/api/command" && item.location === WIN_ROOT_SERVER)).toBe(true)
        expect(winStore.data.location.command.list()?.map((item) => item.name)).toEqual(["audit-win"])

        // A hidden store created from a forward-slash Windows path also aligns defaultLocation on command.sync().
        const hidden = panel.store(WIN_HIDDEN_STORE)
        await hidden.data.location.command.sync()
        await until(() => hidden.data.location.default().directory === WIN_HIDDEN_SERVER)
        expect(hidden.data.location.command.list()?.map((item) => item.name)).toEqual(["audit-win"])
      } finally {
        dispose()
      }
    })
  })
})

describe("createKiloModels multi-store isolation and sign-out clearing", () => {
  type Deferred<T> = PromiseWithResolvers<T>

  function mockGatewayApi() {
    const modelCalls = new Map<string, Deferred<KiloGatewayRpc.ModelEntry[]>[]>()
    const authCalls = new Map<string, Deferred<KiloGatewayRpc.AuthStatus>[]>()
    const push = <T>(map: Map<string, Deferred<T>[]>, directory: string) => {
      const deferred = Promise.withResolvers<T>()
      const list = map.get(directory) ?? []
      list.push(deferred)
      map.set(directory, list)
      return deferred.promise
    }
    const api = {
      rpc: () => ({
        models: (_input: unknown, opts?: { location?: { directory: string } }) =>
          push(modelCalls, opts?.location?.directory ?? ""),
        authStatus: (_input: unknown, opts?: { location?: { directory: string } }) =>
          push(authCalls, opts?.location?.directory ?? ""),
      }),
    } as unknown as OpenCodeClient
    return { api, modelCalls, authCalls }
  }

  test("Wave-1 empty reload on store B does not cancel store A's in-flight Wave-2 read and clears store B when signed out", async () => {
    const mockApi = mockGatewayApi()
    const [modelsA, setModelsA] = createSignal<ModelInfo[] | undefined>([modelRow("kilo", "kilo/old") as ModelInfo])
    const [modelsB, setModelsB] = createSignal<ModelInfo[] | undefined>([modelRow("kilo", "kilo/old") as ModelInfo])

    await createRoot(async (dispose) => {
      try {
        const kiloA = createKiloModels({ api: mockApi.api, directory: "/repo-a", models: modelsA })
        const kiloB = createKiloModels({ api: mockApi.api, directory: "/repo-b", models: modelsB })
        await tick()

        // Seed both stores with initial team metadata.
        mockApi.modelCalls.get("/repo-a")![0]!.resolve([gatewayEntry("kilo/old", "Old")])
        mockApi.authCalls.get("/repo-a")![0]!.resolve(signedIn("org_team1"))
        mockApi.modelCalls.get("/repo-b")![0]!.resolve([gatewayEntry("kilo/old", "Old")])
        mockApi.authCalls.get("/repo-b")![0]!.resolve(signedIn("org_team1"))
        await tick()
        expect(kiloA().organizationID).toBe("org_team1")
        expect(kiloB().organizationID).toBe("org_team1")

        // Store A starts Wave-2 read (kept in flight).
        setModelsA([modelRow("kilo", "kilo/new") as ModelInfo])
        await tick()
        const wave2ModelsA = mockApi.modelCalls.get("/repo-a")![1]!
        const wave2AuthA = mockApi.authCalls.get("/repo-a")![1]!

        // While Store A's Wave-2 read is still in flight, Store B receives Wave-1 empty catalog and signs out.
        setModelsB([])
        await tick()
        mockApi.authCalls.get("/repo-b")![1]!.resolve(signedOut)
        await tick()

        expect(kiloB().entries.size).toBe(0)
        expect(kiloB().organizationID).toBeUndefined()
        expect(kiloB().ready).toBe(true)

        // Store A's Wave-2 read now completes: must NOT have been cancelled by Store B.
        wave2ModelsA.resolve([gatewayEntry("kilo/new", "New")])
        wave2AuthA.resolve(signedIn("org_team2"))
        await tick()

        expect(kiloA().entries.get("kilo/new")?.name).toBe("New")
        expect(kiloA().organizationID).toBe("org_team2")
        expect(kiloA().ready).toBe(true)
      } finally {
        dispose()
      }
    })
  })

  test("preserves team state on transient authenticated reload and clears it on sign-out", async () => {
    const mockApi = mockGatewayApi()
    const [models, setModels] = createSignal<ModelInfo[] | undefined>([modelRow("kilo", "kilo/a") as ModelInfo])

    await createRoot(async (dispose) => {
      try {
        const kilo = createKiloModels({ api: mockApi.api, directory: "/repo-a", models })
        await tick()
        mockApi.modelCalls.get("/repo-a")![0]!.resolve([gatewayEntry("kilo/a", "A")])
        mockApi.authCalls.get("/repo-a")![0]!.resolve(signedIn("org_team1"))
        await tick()
        expect(kilo().organizationID).toBe("org_team1")
        expect(kilo().entries.has("kilo/a")).toBe(true)

        // Team switch Wave 1: empty models while still authenticated keeps the organizationID.
        setModels([])
        await tick()
        mockApi.authCalls.get("/repo-a")![1]!.resolve(signedIn("org_team1"))
        await tick()
        expect(kilo().organizationID).toBe("org_team1")
        expect(kilo().entries.size).toBe(0)
        expect(kilo().ready).toBe(true)

        // Actual sign-out: empty models while unauthenticated clears entries and organizationID.
        setModels([])
        await tick()
        mockApi.authCalls.get("/repo-a")![2]!.resolve(signedOut)
        await tick()
        expect(kilo().organizationID).toBeUndefined()
        expect(kilo().entries.size).toBe(0)
        expect(kilo().ready).toBe(true)
      } finally {
        dispose()
      }
    })
  })

  test("drops a slow Wave-1 authStatus answer when Wave-2 already superseded it in the same store", async () => {
    const mockApi = mockGatewayApi()
    const [models, setModels] = createSignal<ModelInfo[] | undefined>([])

    await createRoot(async (dispose) => {
      try {
        const kilo = createKiloModels({ api: mockApi.api, directory: "/repo-a", models })
        await tick()
        const slowWave1Auth = mockApi.authCalls.get("/repo-a")![0]!

        // Wave 2 arrives and completes before Wave 1's authStatus returns.
        setModels([modelRow("kilo", "kilo/fresh") as ModelInfo])
        await tick()
        mockApi.modelCalls.get("/repo-a")![0]!.resolve([gatewayEntry("kilo/fresh", "Fresh")])
        mockApi.authCalls.get("/repo-a")![1]!.resolve(signedIn("org_fresh"))
        await tick()
        expect(kilo().entries.has("kilo/fresh")).toBe(true)
        expect(kilo().organizationID).toBe("org_fresh")

        // Late Wave-1 sign-out answer must not overwrite Wave-2 state.
        slowWave1Auth.resolve(signedOut)
        await tick()
        expect(kilo().entries.has("kilo/fresh")).toBe(true)
        expect(kilo().organizationID).toBe("org_fresh")
      } finally {
        dispose()
      }
    })
  })
})

describe("per-directory kiloFailure without cross-directory latching", () => {
  test("reflects each store's own catalog.status and routes located catalog events independently", async () => {
    setLocation(WIN_ROOT_STORE, {
      models: [],
      providers: [],
      gatewayModels: [],
      auth: signedOut,
      catalog: { failure: { kind: "unauthorized", status: 401 } },
    })
    setLocation(WIN_TREE_STORE, {
      models: [],
      providers: [],
      gatewayModels: [],
      auth: signedIn(null),
      catalog: { failure: null },
    })

    const api = OpenCode.make({ baseUrl: `http://127.0.0.1:${server.port}` })
    await createRoot(async (dispose) => {
      try {
        const panel = createPanelData({ post: () => {}, api })
        const root = panel.store(WIN_ROOT_STORE)
        const tree = panel.store(WIN_TREE_STORE)
        panel.show([WIN_ROOT_STORE, WIN_TREE_STORE])

        await until(() => root.kiloFailure()?.kind === "unauthorized")
        expect(root.kiloFailure()).toEqual({ kind: "unauthorized", status: 401 })
        expect(tree.kiloFailure()).toBeUndefined()

        // Update only WORKTREE's catalog status and emit a located catalog event with Windows backslashes.
        requests.length = 0
        setLocation(WIN_TREE_STORE, {
          ...stateFor(WIN_TREE_STORE),
          catalog: { failure: { kind: "http", status: 503 } },
        })
        emit({
          id: "evt_cat_tree",
          created: 3,
          type: catalogEvent,
          location: { directory: WIN_TREE_SERVER },
          data: { failure: { kind: "http", status: 503 } },
        })

        await until(() => tree.kiloFailure()?.kind === "http")
        expect(tree.kiloFailure()).toEqual({ kind: "http", status: 503 })
        expect(root.kiloFailure()).toEqual({ kind: "unauthorized", status: 401 })
        // Only the worktree directory was queried; root was NOT spuriously re-queried.
        expect(requests.filter((item) => item.path.includes("catalog.status")).map((item) => item.location)).toEqual([
          WIN_TREE_STORE,
        ])

        // Releasing the first-created store does not break remaining stores' catalog updates.
        panel.release(WIN_ROOT_STORE)
        requests.length = 0
        setLocation(WIN_TREE_STORE, {
          ...stateFor(WIN_TREE_STORE),
          catalog: { failure: null },
        })
        emit({
          id: "evt_cat_tree_clear",
          created: 4,
          type: catalogEvent,
          location: { directory: WIN_TREE_SERVER },
          data: { failure: null },
        })

        await until(() => tree.kiloFailure() === undefined)
        expect(requests.filter((item) => item.path.includes("catalog.status")).map((item) => item.location)).toEqual([
          WIN_TREE_STORE,
        ])
      } finally {
        dispose()
      }
    })
  })
})
