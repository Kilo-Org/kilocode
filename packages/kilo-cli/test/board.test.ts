import { expect, test } from "bun:test"
import { KiloHost } from "../src/host"
import { OpenCode } from "@opencode/client"
import { KiloBoardRpc } from "@opencode/schema/kilocode/board"
import { SessionID } from "@opencode/schema/session-id"
import { createRoutes } from "@opencode/server/routes"
import { Context, Effect, Layer, References } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { mkdtemp, realpath, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { loadPlugins } from "./lib/plugins"

type Closable = { readonly type: string; readonly data?: Record<string, unknown> }

// The Kilo Swarm RPC end to end: the contract in @opencode/schema, the handlers in the board plugin registered by the
// host overrides, and the calls through the generated client's `rpc` entry point.
const boot = (body: (input: { client: ReturnType<typeof OpenCode.make>; directory: string }) => Promise<void>) => async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-board-rpc-")))
  const directory = path.join(root, "repo")
  await Bun.write(path.join(directory, "placeholder.txt"), "hello")
  const previous = {
    KILO_API_KEY: process.env.KILO_API_KEY,
    KILOCODE_TOKEN: process.env.KILOCODE_TOKEN,
    KILO_AUTH_CONTENT: process.env.KILO_AUTH_CONTENT,
    KILO_ORG_ID: process.env.KILO_ORG_ID,
  }
  Object.keys(previous).forEach((key) => delete process.env[key])
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const context = yield* Layer.build(
            createRoutes(
              {
                password: "secret",
                database: { path: ":memory:" },
                models: { fetch: false },
                fs: { filewatcher: false },
                config: { directory: path.join(root, "global"), project: false },
              },
              () => [],
              KiloHost.overrides,
            ).pipe(Layer.provide(HttpServer.layerServices)),
          )
          yield* loadPlugins(context, directory)
          const handler = Context.get(context, HttpRouter.HttpRouter)
            .asHttpEffect()
            .pipe(HttpEffect.toWebHandlerWith(context))
          const client = OpenCode.make({
            baseUrl: "http://kilo.local",
            headers: { authorization: `Basic ${btoa("opencode:secret")}` },
            fetch: Object.assign(
              async (input: string | URL | Request, init?: RequestInit) =>
                handler(input instanceof Request ? input : new Request(input, init)),
              { preconnect: fetch.preconnect },
            ),
          })
          yield* Effect.promise(() => body({ client, directory }))
        }),
      ).pipe(Effect.provideService(References.MinimumLogLevel, "Error")),
    )
  } finally {
    Object.entries(previous).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    })
    await rm(root, { recursive: true, force: true })
  }
}

async function until(condition: () => boolean, what: string, timeout = 5_000) {
  for (const start = Date.now(); Date.now() - start < timeout; await Bun.sleep(5)) {
    if (condition()) return
  }
  throw new Error(`Timed out waiting until ${what}`)
}

test(
  "the board RPC reads the family board, refuses foreign and stale resets, and publishes a reset",
  boot(async ({ client, directory }) => {
    const main = await client.session.create({ location: { directory }, title: "Main" })
    const child = await client.session.create({ location: { directory }, parentID: main.id, title: "Child" })
    const options = { location: { directory: main.location.directory } }
    const rpc = client.rpc(KiloBoardRpc.Definition)

    const collected: Closable[] = []
    const controller = new AbortController()
    const subscription = (async () => {
      for await (const event of client.event.subscribe({ signal: controller.signal })) collected.push(event as Closable)
    })()
    try {
      await until(() => collected.some((event) => event.type === "server.connected"), "the client is connected")

      expect(await rpc.status({}, options)).toEqual({ enabled: true })
      const empty = { ownerSessionID: SessionID.make(main.id), revision: 0, messages: [], hasMore: false }
      expect(await rpc.get({ sessionID: child.id }, options)).toEqual(empty)
      expect(await rpc.get({ sessionID: main.id, limit: 5 }, options)).toEqual(empty)
      await expect(rpc.get({ sessionID: "ses_missing" as typeof main.id }, options)).rejects.toMatchObject({
        type: "not_found",
      })
      await expect(rpc.reset({ sessionID: child.id, revision: 0 }, options)).rejects.toMatchObject({
        type: "invalid",
        message: "Only the owning session can reset this board",
      })
      await expect(rpc.reset({ sessionID: main.id, revision: 3 }, options)).rejects.toMatchObject({
        type: "conflict",
      })

      expect(await rpc.reset({ sessionID: main.id, revision: 0 }, options)).toEqual(empty)
      await until(
        () => collected.some((event) => event.type === "rpc.kilocode.board.changed"),
        "the board change event arrives",
      )
      expect(collected.find((event) => event.type === "rpc.kilocode.board.changed")?.data).toEqual({
        sessionID: main.id,
        revision: 0,
      })
    } finally {
      controller.abort()
      await subscription.catch(() => undefined)
    }
  }),
  30_000,
)
