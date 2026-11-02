import { expect, test } from "bun:test"
import { fixture } from "@kilocode/gateway-core/testing"
import { OpenCode, type RpcClient } from "@opencode/client"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Tool } from "@opencode/core/tool"
import { Agent } from "@opencode/schema/agent"
import { KiloAgentManagerRpc } from "@opencode/schema/kilocode/agent-manager"
import { Location } from "@opencode/schema/location"
import { AbsolutePath } from "@opencode/schema/schema"
import { Session } from "@opencode/schema/session"
import { SessionMessage } from "@opencode/schema/session-message"
import { Tool as ToolSchema } from "@opencode/schema/tool"
import { createRoutes } from "@opencode/server/routes"
import { Context, Effect, Fiber, Layer, References } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { KiloHost } from "../src/host"

type Closable = { readonly type: string; readonly data?: Record<string, unknown> }

const boot =
  (
    body: (input: {
      readonly client: ReturnType<typeof OpenCode.make>
      readonly directory: string
    }) => Effect.Effect<void, unknown, LocationServiceMap.Service>,
  ) =>
  async () => {
    using backend = fixture()
    const root = await mkdtemp(path.join(os.tmpdir(), "kilo-agent-manager-rpc-"))
    const directory = path.join(root, "repo")
    await Bun.write(path.join(directory, "placeholder.txt"), "hello")
    const previous = { KILO_API_URL: process.env.KILO_API_URL, KILO_API_KEY: process.env.KILO_API_KEY }
    process.env.KILO_API_URL = backend.url
    delete process.env.KILO_API_KEY
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
            yield* body({ client, directory }).pipe(Effect.provide(context), Effect.orDie)
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

test(
  "the agent-manager RPC lists, replies, rejects, and publishes events through the client",
  boot(({ client, directory }) =>
    Effect.gen(function* () {
      const location = { directory }
      const session = yield* Effect.promise(() =>
        client.session.create({
          location,
          title: "Agent Manager RPC",
          permissions: [
            { action: "agent_manager", resource: "overview", effect: "allow" },
            { action: "agent_manager", resource: "prompt", effect: "allow" },
            { action: "agent_manager", resource: "local", effect: "allow" },
          ],
        }),
      )
      const sessionID = Session.ID.make(session.id)
      const ref = Location.Ref.make({ directory: AbsolutePath.make(session.location.directory) })

      const collected: Closable[] = []
      const controller = new AbortController()
      const subscription = (async () => {
        for await (const event of client.event.subscribe({ signal: controller.signal }))
          collected.push(event as Closable)
      })()
      yield* Effect.promise(() => waitFor(() => collected.some((event) => event.type === "server.connected")))
      const events = () => collected.filter((event) => event.type.startsWith("rpc.kilocode.agent-manager."))
      const rpc = client.rpc(KiloAgentManagerRpc.Definition)
      const toolContext = {
        sessionID,
        agent: Agent.ID.make("build"),
        messageID: SessionMessage.ID.make("msg_agent_manager_rpc"),
        id: ToolSchema.CallID.make("call_agent_manager_rpc"),
        progress: () => Effect.void,
      }

      yield* Effect.gen(function* () {
        const tools = yield* Tool.Service
        const agentManager = yield* retry(() =>
          tools.list().pipe(
            Effect.map((items) => items.find((item) => item.name === "agent_manager")),
            Effect.orDie,
          ),
        )

        const roundTrip = Effect.gen(function* () {
          const toolFiber = yield* agentManager.execute({ action: "list" }, toolContext).pipe(Effect.forkChild)
          const pending = yield* waitForPending(rpc, location)
          expect(pending).toHaveLength(1)
          expect(pending[0]?.operation).toBe("overview")
          expect(
            events().some(
              (event) => event.type === "rpc.kilocode.agent-manager.requested" && event.data?.operation === "overview",
            ),
          ).toBe(true)

          yield* Effect.promise(() =>
            rpc.reply(
              {
                requestID: pending[0]!.id,
                result: { operation: "overview", overview: { sections: [], ungrouped: [] } },
              },
              { location },
            ),
          )
          const result = yield* Fiber.join(toolFiber)
          expect(JSON.parse(result.output ?? "")).toMatchObject({ sections: [], ungrouped: [] })
          expect(yield* Effect.promise(() => rpc.list({}, { location }))).toEqual([])

          const rejected = yield* agentManager
            .execute({ action: "prompt", sessionID, prompt: "hello" }, toolContext)
            .pipe(Effect.forkChild)
          const waiting = yield* waitForPending(rpc, location)
          yield* Effect.promise(() =>
            rpc.reject(
              { requestID: waiting[0]!.id, error: { code: "stale_session", message: "The target session is stale" } },
              { location },
            ),
          )
          const failure = yield* Fiber.join(rejected).pipe(Effect.flip)
          expect(failure.message).toBe("The target session is stale")

          const cancelled = yield* agentManager.execute({ action: "list" }, toolContext).pipe(Effect.forkChild)
          yield* waitForPending(rpc, location)
          yield* Fiber.interrupt(cancelled)
          yield* Effect.promise(() =>
            waitFor(() =>
              events().some(
                (event) =>
                  event.type === "rpc.kilocode.agent-manager.cancelled" && event.data?.reason === "cancelled",
              ),
            ),
          )

          const started = yield* agentManager.execute({ mode: "local", tasks: [{ prompt: "hello" }] }, toolContext)
          expect(started.output).toContain("Requested 1 Agent Manager local session")
          yield* Effect.promise(() =>
            waitFor(() =>
              events().some(
                (event) => event.type === "rpc.kilocode.agent-manager.start" && event.data?.mode === "local",
              ),
            ),
          )
        })

        yield* roundTrip
      }).pipe(Effect.provide(LocationServiceMap.Service.get(ref)))

      controller.abort()
      yield* Effect.promise(() => subscription)
      expect(events().map((event) => event.type)).toEqual(
        expect.arrayContaining([
          "rpc.kilocode.agent-manager.requested",
          "rpc.kilocode.agent-manager.cancelled",
          "rpc.kilocode.agent-manager.start",
        ]),
      )
    }),
  ),
  30_000,
)

function retry<A>(read: () => Effect.Effect<A | undefined>) {
  return Effect.gen(function* () {
    for (let attempt = 0; attempt < 100; attempt++) {
      const value = yield* read()
      if (value !== undefined) return value
      yield* Effect.sleep("20 millis")
    }
    return yield* Effect.die(new Error("timed out waiting for plugin registration"))
  })
}

async function waitFor(check: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (check()) return
    await Bun.sleep(20)
  }
  throw new Error("timed out waiting for a condition")
}

function waitForPending(
  rpc: RpcClient<typeof KiloAgentManagerRpc.Definition>,
  location: { readonly directory: string },
) {
  return Effect.gen(function* () {
    for (let attempt = 0; attempt < 100; attempt++) {
      const pending = yield* Effect.promise(() => rpc.list({}, { location }))
      if (pending.length > 0) return pending
      yield* Effect.sleep("20 millis")
    }
    return yield* Effect.die(new Error("no pending Agent Manager request"))
  })
}
