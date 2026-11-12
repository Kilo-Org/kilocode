import { afterEach, beforeEach, expect, test } from "bun:test"
import { Config } from "@opencode/core/config"
import { KiloConfigPolicy } from "@opencode/core/kilocode/config/policy"
import { Document } from "@opencode/schema/config"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Effect, Queue, Stream } from "effect"
import { TestClock } from "effect/testing"
import { parse } from "jsonc-parser"
import { mkdtemp, readdir, readFile, realpath, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { KiloGatewayAccounts } from "../src/gateway/accounts"
import { KiloPagesPlugin } from "../src/pages"
import { PagesConfig } from "../src/pages/config"
import { PagesAuth } from "../src/pages/auth"
import { PagesToken } from "../src/pages/token"

const dirs: string[] = []
// The plugin reads the destination override from the process environment, so a value set in the shell or CI must not leak in.
const ambient = process.env[PagesConfig.DESTINATION_ENV]
beforeEach(() => {
  delete process.env[PagesConfig.DESTINATION_ENV]
})
afterEach(async () => {
  if (ambient === undefined) delete process.env[PagesConfig.DESTINATION_ENV]
  else process.env[PagesConfig.DESTINATION_ENV] = ambient
  PagesToken.reset()
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

type Server = { name: string; status: { status: string } }
type Entry = { type: string; url: string; oauth?: false; headers?: Record<string, string> }
type Info = ConstructorParameters<typeof KiloConfigPolicy.Info>[0]
type Pages = NonNullable<NonNullable<Info>["pages"]>

function mintServer(respond: (count: number) => Response) {
  let count = 0
  const http = Bun.serve({ port: 0, fetch: () => respond(++count) })
  return { url: `http://localhost:${http.port}`, count: () => count, stop: () => void http.stop(true) }
}
const minted = (count: number) =>
  Response.json({ token: `pages-${count}`, expiresAt: new Date(Date.now() + 300_000).toISOString() })

async function harness(input: {
  documents: { info: Info; path?: string }[]
  server: string
  signedIn?: boolean
  /** Run the plugin on a test clock, so `adjust` fires its retry timer. */
  clock?: boolean
  run: (pages: Harness) => Promise<void>
}) {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-pages-plugin-")))
  dirs.push(directory)
  const state = { account: input.signedIn === false ? undefined : { token: "account", server: input.server, baseURL: input.server, organizationID: null } }
  const unregister = KiloGatewayAccounts.register(directory, () => state.account)
  const transforms: ((editor: unknown) => void)[] = []
  const emitted: unknown[] = []
  let handlers: Record<string, (input: unknown, context: unknown) => Effect.Effect<any, any>> = {}
  let reloads = 0
  let reads = 0
  let adjust: (millis: number) => Promise<void> = () => Promise.reject(new Error("the harness has no test clock"))
  let servers: Server[] = []
  let mcpEvents: Queue.Queue<{ data: { server: string } }> | undefined
  // The global config directory is read back, so a write by the plugin reaches the next read as a config reload would.
  const globalDirectory = path.join(directory, "global")
  const written = async () =>
    Promise.all(
      (await readdir(globalDirectory).catch(() => [])).map(async (name) => ({
        info: parse(await readFile(path.join(globalDirectory, name), "utf8")) as Info,
        path: path.join(globalDirectory, name),
      })),
    )
  const config = {
    entries: () =>
      Effect.promise(async () =>
        (reads++, [...input.documents, ...(await written())].map(
          (item) => new Document({ type: "document", info: new KiloConfigPolicy.Info(item.info), ...(item.path ? { path: item.path as never } : {}) }),
        )),
      ),
    changes: () => Stream.empty,
    reload: () => Effect.void,
  } as unknown as Config.Interface

  const harness: Harness = {
    directory,
    state,
    reloads: () => reloads,
    reads: () => reads,
    adjust: (millis) => adjust(millis),
    emitted,
    servers: (next) => (servers = next),
    status: () => Effect.runPromise(handlers.status!({}, {})),
    call: (method) => Effect.runPromise(handlers[method]!({}, { error: (_: string, message: string) => new Error(message) })),
    entry: () => {
      const entries = new Map<string, Entry>()
      transforms.forEach((fn) =>
        fn({ get: (name: string) => entries.get(name), set: (name: string, value: Entry) => entries.set(name, value) }),
      )
      return entries.get("pages")
    },
    mcpEvent: () => Effect.runPromise(Queue.offer(mcpEvents!, { data: { server: "pages" } })),
    until: async (predicate) => {
      for (let i = 0; i < 200; i++) {
        if (predicate(await harness.status())) return
        await Bun.sleep(10)
      }
      throw new Error(`state never settled: ${JSON.stringify(await harness.status())}`)
    },
  }
  const ctx = {
    location: { directory },
    app: { version: "test" },
    mcp: {
      transform: (fn: (editor: unknown) => void) => Effect.sync(() => transforms.push(fn)),
      reload: () => Effect.sync(() => void reloads++),
      list: () => Effect.sync(() => ({ data: servers })),
    },
    rpc: {
      register: (_: unknown, next: typeof handlers) =>
        Effect.sync(() => {
          handlers = next
          return { events: { emit: (_name: string, status: unknown) => Effect.sync(() => void emitted.push(status)) } }
        }),
    },
    event: {
      subscribe: (options?: { types?: string[] }) =>
        options?.types?.[0] === "mcp.status.changed" && mcpEvents ? Stream.fromQueue(mcpEvents) : Stream.never,
    },
  }
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          mcpEvents = yield* Queue.unbounded<{ data: { server: string } }>()
          const context = yield* Effect.context()
          adjust = (millis) => Effect.runPromiseWith(context)(TestClock.adjust(millis))
          yield* KiloPagesPlugin.effect(ctx as never)
          yield* Effect.promise(() => input.run(harness))
        }),
      ).pipe(
        Effect.provideService(Config.Service, config),
        input.clock ? Effect.provide(TestClock.layer()) : (effect) => effect,
        Effect.provide(Global.layerWith({ home: directory, state: path.join(directory, ".state"), config: path.join(directory, "global") })),
        Effect.provide(LayerNode.compile(FSUtil.node)),
      ),
    )
  } finally {
    unregister()
  }
}

interface Harness {
  readonly directory: string
  readonly state: { account: unknown }
  readonly reloads: () => number
  /** Config reads: one per reconcile. */
  readonly reads: () => number
  readonly adjust: (millis: number) => Promise<void>
  readonly emitted: unknown[]
  readonly servers: (next: Server[]) => void
  readonly status: () => Promise<any>
  readonly call: (method: "enable" | "disable" | "ensureConnected" | "status") => Promise<any>
  readonly entry: () => Entry | undefined
  readonly mcpEvent: () => Promise<boolean>
  readonly until: (predicate: (status: any) => boolean) => Promise<void>
}

const enabled: Info = { pages: { enabled: true } }

test("registers the pages server only after a mint, with a handle and no secret", async () => {
  const backend = mintServer(minted)
  await harness({
    documents: [{ info: enabled }],
    server: backend.url,
    run: async (pages) => {
      await pages.until((status) => status.state === "connecting")
      const entry = pages.entry()!
      expect(entry).toMatchObject({ type: "remote", url: "https://pages.kiloapps.io/mcp", oauth: false })
      expect(Object.keys(entry.headers!)).toEqual([PagesAuth.HANDLE_HEADER])
      expect(JSON.stringify(entry)).not.toContain("pages-1")
      expect(pages.reloads()).toBe(1)
      expect(backend.count()).toBe(1)
      expect(await pages.status()).toMatchObject({ enabled: true, state: "connecting", server: "pages", origin: "https://pages.kiloapps.io" })
      expect(JSON.stringify(await pages.status())).not.toContain("pages-1")
    },
  }).finally(backend.stop)
})

test("nothing is minted or registered while Pages is off", async () => {
  const backend = mintServer(minted)
  await harness({
    documents: [{ info: {} }],
    server: backend.url,
    run: async (pages) => {
      await pages.until((status) => status.state === "disabled")
      expect(await pages.status()).toMatchObject({ enabled: false, state: "disabled", reason: "user" })
      expect(pages.entry()).toBeUndefined()
      expect(backend.count()).toBe(0)
    },
  }).finally(backend.stop)
})

test("the last document that sets pages.enabled wins", async () => {
  const on = mintServer(minted)
  await harness({
    documents: [{ info: { pages: { enabled: false } } }, { info: enabled, path: "/elsewhere/project/kilo2.json" }],
    server: on.url,
    run: async (pages) => {
      await pages.until((status) => status.state === "connecting")
      expect(on.count()).toBe(1)
    },
  }).finally(on.stop)
  const off = mintServer(minted)
  await harness({
    documents: [{ info: enabled }, { info: { pages: { enabled: false } }, path: "/elsewhere/project/kilo2.json" }],
    server: off.url,
    run: async (pages) => {
      await pages.until((status) => status.state === "disabled")
      expect(off.count()).toBe(0)
    },
  }).finally(off.stop)
})

test("pages.destination picks the deployment, and the environment variable wins", async () => {
  const entries = (...destinations: Pages[]) =>
    destinations.map((pages) => ({ type: "document", info: new KiloConfigPolicy.Info({ pages }) }) as any)
  expect(PagesConfig.destination([], undefined)).toEqual({ origin: "https://pages.kiloapps.io", resource: "pages" })
  expect(PagesConfig.destination(entries({ destination: "pages-dev" }), undefined)).toEqual({
    origin: "https://pages-dev.kiloapps.io",
    resource: "pages-dev",
  })
  expect(PagesConfig.destination(entries({ destination: "pages-dev" }, { enabled: true }), undefined).resource).toBe("pages-dev")
  expect(PagesConfig.destination(entries({ destination: "pages" }, { destination: "pages-dev" }), undefined).resource).toBe("pages-dev")
  expect(PagesConfig.destination(entries({ destination: "pages" }), "pages-dev").resource).toBe("pages-dev")
  expect(PagesConfig.destination(entries({ destination: "pages-dev" }), "nonsense").resource).toBe("pages-dev")

  const backend = mintServer(minted)
  await harness({
    documents: [{ info: { pages: { enabled: true, destination: "pages-dev" } } }],
    server: backend.url,
    run: async (pages) => {
      await pages.until((status) => status.state === "connecting")
      expect(pages.entry()).toMatchObject({ url: "https://pages-dev.kiloapps.io/mcp" })
      expect(await pages.status()).toMatchObject({ origin: "https://pages-dev.kiloapps.io" })
    },
  }).finally(backend.stop)
})

test("mcp.use policy is checked before anything is minted", async () => {
  const backend = mintServer(minted)
  await harness({
    documents: [{ info: { ...enabled, policies: [{ action: "mcp.use", resource: "pages", effect: "deny" }] } }],
    server: backend.url,
    run: async (pages) => {
      await pages.until((status) => status.state === "disabled")
      expect(await pages.status()).toMatchObject({ reason: "policy" })
      expect(backend.count()).toBe(0)
      expect(pages.entry()).toBeUndefined()
    },
  }).finally(backend.stop)
})

test("a hand-made pages server wins and nothing is minted", async () => {
  const backend = mintServer(minted)
  await harness({
    documents: [{ info: { ...enabled, mcp: { servers: { pages: { type: "remote", url: "https://pages.example.test/mcp" } } } } as Info }],
    server: backend.url,
    run: async (pages) => {
      await pages.until((status) => status.state === "manual")
      expect(backend.count()).toBe(0)
      expect(pages.entry()).toBeUndefined()
    },
  }).finally(backend.stop)
})

test("signed out reports the Gateway sign-in, and a settled account starts the connection", async () => {
  const backend = mintServer(minted)
  await harness({
    documents: [{ info: enabled }],
    server: backend.url,
    signedIn: false,
    run: async (pages) => {
      await pages.until((status) => status.state === "signed_out")
      expect(await pages.status()).toMatchObject({ signIn: { integrationID: "kilo", methodID: "device" } })
      expect(backend.count()).toBe(0)
      pages.state.account = { token: "account", server: backend.url, baseURL: backend.url, organizationID: null }
      KiloGatewayAccounts.changed(pages.directory)
      await pages.until((status) => status.state === "connecting")
      expect(backend.count()).toBe(1)
      expect(pages.entry()).toBeDefined()
    },
  }).finally(backend.stop)
})

test("a refused credential is a state with no server", async () => {
  const backend = mintServer(() => Response.json({ error: "Organization credentials are not supported" }, { status: 403 }))
  await harness({
    documents: [{ info: enabled }],
    server: backend.url,
    run: async (pages) => {
      await pages.until((status) => status.state === "unsupported")
      expect(await pages.status()).toMatchObject({ reason: "organization_credential" })
      expect(pages.entry()).toBeUndefined()
      expect(pages.reloads()).toBe(0)
    },
  }).finally(backend.stop)
})

test("a failed connect removes the entry and retries later", async () => {
  const backend = mintServer(minted)
  await harness({
    documents: [{ info: enabled }],
    server: backend.url,
    run: async (pages) => {
      await pages.until((status) => status.state === "connecting")
      pages.servers([{ name: "pages", status: { status: "connected" } }])
      await pages.mcpEvent()
      await pages.until((status) => status.state === "connected")
      pages.servers([{ name: "pages", status: { status: "failed" } }])
      await pages.mcpEvent()
      await pages.until((status) => status.state === "retrying")
      expect(await pages.status()).toMatchObject({ reason: "pages_rejected" })
      expect(pages.entry()).toBeUndefined()
      // Registered, removed.
      expect(pages.reloads()).toBe(2)
    },
  }).finally(backend.stop)
})

test("the status event is published once per change", async () => {
  const backend = mintServer(minted)
  await harness({
    documents: [{ info: enabled }],
    server: backend.url,
    run: async (pages) => {
      await pages.until((status) => status.state === "connecting")
      const states = pages.emitted.map((status) => (status as { state: string }).state)
      expect(states).toEqual([...new Set(states)])
      expect(states).toContain("connecting")
    },
  }).finally(backend.stop)
})

test("enable and disable write the global config and follow it", async () => {
  const backend = mintServer(minted)
  await harness({
    documents: [],
    server: backend.url,
    run: async (pages) => {
      await pages.until((status) => status.state === "disabled")
      expect(await pages.call("enable")).toMatchObject({ enabled: true, state: "connecting" })
      expect(pages.entry()).toBeDefined()
      expect(backend.count()).toBe(1)
      expect(await pages.call("disable")).toMatchObject({ enabled: false, state: "disabled", reason: "user" })
      expect(pages.entry()).toBeUndefined()
      expect(PagesToken.peek({ server: backend.url, token: "account" }, PagesToken.DEFAULT).kind).toBe("none")
    },
  }).finally(backend.stop)
})

test("enable under a deny policy writes nothing", async () => {
  const backend = mintServer(minted)
  await harness({
    documents: [{ info: { policies: [{ action: "mcp.use", resource: "pages", effect: "deny" }] } }],
    server: backend.url,
    run: async (pages) => {
      await pages.until((status) => status.state === "disabled")
      expect(await pages.call("enable")).toMatchObject({ enabled: false, state: "disabled", reason: "policy" })
      expect(await readdir(path.join(pages.directory, "global")).catch(() => [])).toEqual([])
      expect(pages.entry()).toBeUndefined()
      expect(backend.count()).toBe(0)
    },
  }).finally(backend.stop)
})

test("ensureConnected retries a refusal but never opens a sign-in", async () => {
  let refuse = true
  const backend = mintServer((count) =>
    refuse ? Response.json({ error: "Access denied (R0)" }, { status: 403 }) : minted(count),
  )
  await harness({
    documents: [{ info: enabled }],
    server: backend.url,
    run: async (pages) => {
      await pages.until((status) => status.state === "blocked")
      refuse = false
      expect(await pages.call("ensureConnected")).toMatchObject({ state: "connecting" })
      expect(pages.entry()).toBeDefined()
    },
  }).finally(backend.stop)
})

test("the retry timer keeps retrying while the failure lasts", async () => {
  const backend = mintServer(() => new Response("down", { status: 503 }))
  await harness({
    documents: [{ info: enabled }],
    server: backend.url,
    clock: true,
    run: async (pages) => {
      await pages.until((status) => status.state === "retrying")
      expect(backend.count()).toBe(1)
      // Each fire reconciles once and, while Kilo keeps failing, schedules the next one. The next timer is set a moment
      // after the read, so the clock is advanced again until the read happens.
      for (let fire = 0; fire < 3; fire++) {
        const before = pages.reads()
        for (let i = 0; i < 200 && pages.reads() === before; i++) {
          await pages.adjust(31_000)
          await Bun.sleep(10)
        }
        expect(pages.reads()).toBeGreaterThan(before)
        expect(await pages.status()).toMatchObject({ state: "retrying" })
      }
    },
  }).finally(backend.stop)
})

test("a retry that succeeds registers the server", async () => {
  let down = true
  const backend = mintServer((count) => (down ? new Response("down", { status: 503 }) : minted(count)))
  await harness({
    documents: [{ info: enabled }],
    server: backend.url,
    clock: true,
    run: async (pages) => {
      await pages.until((status) => status.state === "retrying")
      expect(pages.entry()).toBeUndefined()
      down = false
      PagesToken.reset()
      await pages.adjust(31_000)
      await pages.until((status) => status.state === "connecting")
      expect(pages.entry()).toBeDefined()
    },
  }).finally(backend.stop)
})

test("switching the account forgets the previous account's token at once", async () => {
  const backend = mintServer(minted)
  await harness({
    documents: [{ info: enabled }],
    server: backend.url,
    run: async (pages) => {
      await pages.until((status) => status.state === "connecting")
      const previous = { server: backend.url, token: "account" }
      expect(PagesToken.peek(previous, PagesToken.DEFAULT).kind).toBe("valid")
      pages.state.account = { token: "other", server: backend.url, baseURL: backend.url, organizationID: null }
      KiloGatewayAccounts.changed(pages.directory)
      for (let i = 0; i < 200 && backend.count() < 2; i++) await Bun.sleep(10)
      expect(backend.count()).toBe(2)
      expect(PagesToken.peek(previous, PagesToken.DEFAULT).kind).toBe("none")
      expect(PagesToken.peek({ server: backend.url, token: "other" }, PagesToken.DEFAULT).kind).toBe("valid")
    },
  }).finally(backend.stop)
})

test("a forced refresh of a connected server keeps it connected", async () => {
  const backend = mintServer(minted)
  await harness({
    documents: [{ info: enabled }],
    server: backend.url,
    run: async (pages) => {
      await pages.until((status) => status.state === "connecting")
      pages.servers([{ name: "pages", status: { status: "connected" } }])
      await pages.mcpEvent()
      await pages.until((status) => status.state === "connected")
      const reloads = pages.reloads()
      expect(await pages.call("ensureConnected")).toMatchObject({ state: "connected" })
      expect(await pages.call("enable")).toMatchObject({ state: "connected" })
      expect(pages.entry()).toBeDefined()
      expect(pages.reloads()).toBe(reloads)
      expect(backend.count()).toBe(1)
    },
  }).finally(backend.stop)
})
