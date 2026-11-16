import { expect, test } from "bun:test"
import { backendSupport } from "@kilocode/sandbox"
import { KiloHost } from "../src/host"
import { OpenCode } from "@opencode/client"
import { KiloSandboxRpc } from "@opencode/schema/kilocode/sandbox"
import { Session } from "@opencode/schema/session"
import { createRoutes } from "@opencode/server/routes"
import { Context, Effect, Layer, References } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { mkdtemp, realpath, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { SandboxStore } from "../../kilo-plugin/src/sandbox/store"
import { loadPlugins } from "./lib/plugins"

type Closable = { readonly type: string; readonly data?: Record<string, unknown> }

const boot = (body: (input: { client: ReturnType<typeof OpenCode.make>; directory: string }) => Promise<void>) => async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-sandbox-rpc-")))
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
  "the sandbox RPC reports, toggles, persists, and publishes a session status through the generated client",
  boot(async ({ client, directory }) => {
    const session = await client.session.create({ location: { directory }, title: "Sandbox RPC" })
    const sessionID = Session.ID.make(session.id)
    const location = { directory: session.location.directory }
    const options = { location }
    const rpc = client.rpc(KiloSandboxRpc.Definition)

    const collected: Closable[] = []
    const controller = new AbortController()
    const subscription = (async () => {
      for await (const event of client.event.subscribe({ signal: controller.signal }))
        collected.push(event as Closable)
    })()
    const changed = () => collected.filter((event) => event.type === "rpc.kilocode.sandbox.changed")

    try {
      await until(() => collected.some((event) => event.type === "server.connected"), "the client is connected")

      const support = await rpc.support({}, options)
      expect(support.available).toBe(backendSupport({ mode: "deny", allowedHosts: [] }).available)

      const initial = await rpc.status({ sessionID }, options)
      expect(initial).toMatchObject({
        directory: session.location.directory,
        enabled: false,
        available: support.available,
        network: false,
        version: 0,
      })

      const toggled = await rpc.toggle({ sessionID }, options)
      expect(toggled.version).toBe(support.available ? 1 : 0)
      expect(toggled.enabled).toBe(support.available)
      expect(toggled.network).toBe(support.available)

      if (!support.available) {
        // Without a backend the toggle refuses to enable and publishes nothing; the caller reads the reply.
        expect(changed()).toHaveLength(0)
      } else {
        await until(() => changed().length > 0, "the sandbox status event arrives")
        expect(changed().at(-1)?.data).toMatchObject({
          sessionID,
          directory: session.location.directory,
          enabled: true,
          version: 1,
        })
        expect(await SandboxStore.read(session.location.directory, sessionID)).toEqual({
          enabled: true,
          mode: "deny",
          allowedHosts: [],
          writablePaths: [],
          version: 1,
        })

        const disabled = await rpc.toggle({ sessionID }, options)
        expect(disabled).toMatchObject({ enabled: false, network: false, version: 2 })
        expect(await SandboxStore.read(session.location.directory, sessionID)).toMatchObject({
          enabled: false,
          mode: "deny",
          version: 2,
        })
      }

      await expect(rpc.status({ sessionID: Session.ID.make("ses_sandbox_missing") }, options)).rejects.toMatchObject({
        type: "not_found",
      })
      await expect(rpc.toggle({ sessionID: Session.ID.make("ses_sandbox_missing") }, options)).rejects.toMatchObject({
        type: "not_found",
      })
    } finally {
      controller.abort()
      await subscription.catch(() => undefined)
    }
  }),
  30_000,
)
