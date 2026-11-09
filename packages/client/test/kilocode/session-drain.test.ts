import { expect } from "bun:test"
import path from "node:path"
import { NodeHttpServer } from "@effect/platform-node"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { BackgroundJob } from "@opencode-ai/core/background-job"
import { Database } from "@opencode-ai/core/database/database"
import { Flag } from "@opencode-ai/core/flag/flag"
import { SessionDrain } from "@opencode-ai/core/kilocode/session/drain"
import { createEmbeddedRoutes } from "@opencode-ai/server/routes"
import { Deferred, Effect, Fiber, Latch, Layer, Option, Stream } from "effect"
import { FetchHttpClient, HttpRouter, HttpServer } from "effect/unstable/http"
import { testEffect } from "../../../core/test/lib/effect"
import { tmpdir } from "../../../core/test/fixture/tmpdir"
import { link } from "../../../core/test/kilocode/drain-family"
import { TestLLMServer } from "../../../opencode/test/lib/llm-server"
import { OpenCode as PromiseClient } from "../../src"
import { AbsolutePath, Location, Model, OpenCode, Session } from "../../src/effect"

const services = AppNodeBuilder.build(LayerNode.group([Database.node, SessionDrain.node, BackgroundJob.node]))
const isolated = Layer.effectDiscard(
  Effect.acquireRelease(
    Effect.sync(() => {
      const previous = { db: Flag.KILO_DB, models: Flag.KILO_MODELS_PATH, fetch: Flag.KILO_DISABLE_MODELS_FETCH }
      Flag.KILO_DB = ":memory:"
      Flag.KILO_MODELS_PATH = path.resolve(import.meta.dir, "../../../core/test/plugin/fixtures/models-dev.json")
      Flag.KILO_DISABLE_MODELS_FETCH = true
      return previous
    }),
    (previous) =>
      Effect.sync(() => {
        Flag.KILO_DB = previous.db
        Flag.KILO_MODELS_PATH = previous.models
        Flag.KILO_DISABLE_MODELS_FETCH = previous.fetch
      }),
  ),
)
const layer = HttpRouter.serve(createEmbeddedRoutes(), { disableListenLog: true, disableLogger: true }).pipe(
  Layer.provideMerge(NodeHttpServer.layerTest),
  Layer.provideMerge(services),
  Layer.provideMerge(TestLLMServer.layer),
  Layer.provide(isolated),
)
const it = testEffect(layer)

it.live(
  "V2 drain observes real HTTP runner, descendants, background delivery, and cancellation",
  () =>
    Effect.gen(function* () {
      const llm = yield* TestLLMServer
      const jobs = yield* BackgroundJob.Service
      const address = (yield* HttpServer.HttpServer).address
      if (address._tag !== "TcpAddress") return yield* Effect.die("Expected TCP server")
      const base = `http://127.0.0.1:${address.port}`
      const client = yield* OpenCode.make({ baseUrl: base }).pipe(Effect.provide(FetchHttpClient.layer))
      const gates = Array.from({ length: 4 }, () => Promise.withResolvers<void>())
      yield* Effect.addFinalizer(() => Effect.sync(() => gates.forEach((gate) => gate.resolve())))
      const dir = yield* Effect.acquireRelease(Effect.promise(tmpdir), (dir) =>
        Effect.promise(() => dir[Symbol.asyncDispose]()),
      )
      yield* Effect.promise(() =>
        Bun.write(
          `${dir.path}/opencode.json`,
          JSON.stringify({
            snapshots: false,
            providers: {
              test: {
                api: { type: "aisdk", package: "@ai-sdk/openai-compatible", url: llm.url },
                request: { body: { apiKey: "test-key" } },
                models: { "test-model": { limit: { context: 100_000, output: 10_000 } } },
              },
            },
          }),
        ),
      )
      const model = Model.Ref.make({ id: "test-model", providerID: "test" })
      const create = () =>
        client.sessions.create({ location: Location.Ref.make({ directory: AbsolutePath.make(dir.path) }), model })
      const parent = yield* create()
      const child = yield* create()
      const grandchild = yield* create()
      const other = yield* create()
      yield* Effect.gen(function* () {
        while (
          !(yield* client.models.list({ location: parent.location })).data.some(
            (model) => model.providerID === "test" && model.id === "test-model",
          )
        )
          yield* Effect.yieldNow
      }).pipe(Effect.timeout("10 seconds"))
      // V2 subagent creation is not public yet. Seed its durable parent links, then run the real V2 runners.
      yield* link(child.id, parent.id)
      yield* link(grandchild.id, child.id)
      for (const [index, session] of [parent, child, grandchild, other].entries()) {
        yield* llm.hold(`Completed ${session.id}`, gates.at(index)!.promise)
        yield* client.sessions.prompt({
          sessionID: session.id,
          prompt: { text: "Complete this controlled drain test" },
        })
        yield* llm.wait(index + 1).pipe(Effect.timeout("10 seconds"))
      }
      const background = yield* Deferred.make<void>()
      const delivery = yield* Deferred.make<void>()
      const delivering = yield* Deferred.make<void>()
      const job = yield* jobs.start({
        type: "subagent",
        metadata: { sessionID: grandchild.id },
        run: Deferred.await(background).pipe(Effect.as("background result")),
      })
      expect(
        yield* jobs.extend({
          id: job.id,
          run: Deferred.succeed(delivering, undefined).pipe(
            Effect.andThen(Deferred.await(delivery)),
            Effect.as("delivered result"),
          ),
        }),
      ).toBe(true)
      const connected = yield* Latch.make(false)
      const acknowledged = yield* Deferred.make<void>()
      const token = crypto.randomUUID()
      yield* client.events.subscribe().pipe(
        Stream.runForEach((event) => {
          if (event.type === "server.connected") return connected.open
          if (event.type !== "session.drained" || event.data.sessionID !== parent.id || event.data.token !== token)
            return Effect.void
          return Deferred.succeed(acknowledged, undefined).pipe(Effect.asVoid)
        }),
        Effect.forkScoped,
      )
      yield* connected.await
      const waiting = yield* client.sessions.drain({ sessionID: parent.id, token }).pipe(Effect.forkChild)

      const pending = Effect.gen(function* () {
        // A negative timing assertion: HTTP drain must not finish while controlled work is blocked.
        expect(
          Option.isNone(
            yield* client.sessions.drain({ sessionID: parent.id }).pipe(Effect.timeoutOption("100 millis")),
          ),
        ).toBe(true)
        expect(waiting.pollUnsafe()).toBeUndefined()
      })
      const idle = (id: Session.ID) =>
        Effect.gen(function* () {
          while ((yield* client.sessions.active())[id]) yield* Effect.yieldNow
        }).pipe(Effect.timeout("10 seconds"))

      yield* pending
      gates.at(0)!.resolve()
      yield* idle(parent.id)
      yield* pending
      gates.at(1)!.resolve()
      gates.at(2)!.resolve()
      yield* idle(child.id)
      yield* idle(grandchild.id)
      yield* pending
      yield* Deferred.succeed(background, undefined)
      yield* Deferred.await(delivering)
      yield* pending
      yield* Deferred.succeed(delivery, undefined)
      yield* Fiber.join(waiting).pipe(Effect.timeout("10 seconds"))
      yield* Deferred.await(acknowledged).pipe(Effect.timeout("10 seconds"))
      expect((yield* client.sessions.active())[other.id]).toEqual({ type: "running" })
      expect((yield* jobs.get(job.id))?.output).toBe("delivered result")

      const requests: Array<{ path: string; status: number }> = []
      const promise = PromiseClient.make({
        baseUrl: base,
        fetch: Object.assign(
          async (input: RequestInfo | URL, init?: RequestInit) => {
            const response = await fetch(input, init)
            requests.push({
              path: new URL(input instanceof Request ? input.url : input.toString()).pathname,
              status: response.status,
            })
            return response
          },
          { preconnect: () => undefined },
        ),
      })
      yield* Effect.promise(() => promise.sessions.drain({ sessionID: parent.id }))
      expect(requests).toEqual([{ path: `/api/session/${parent.id}/drain`, status: 204 }])
      const missing = yield* client.sessions
        .drain({ sessionID: Session.ID.make("ses_missing_drain") })
        .pipe(Effect.flip)
      expect(missing._tag).toBe("SessionNotFoundError")
      const invalid = yield* Effect.promise(() =>
        fetch(`${base}/api/session/${parent.id}/drain`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token: "" }),
        }),
      )
      expect(invalid.status).toBe(400)
      yield* client.sessions.prompt({ sessionID: parent.id, prompt: { text: "Admit only; do not run" }, resume: false })
      yield* client.sessions.drain({ sessionID: parent.id })
      expect((yield* client.sessions.active())[parent.id]).toBeUndefined()
      const unchanged = yield* client.sessions.wait({ sessionID: parent.id }).pipe(Effect.flip)
      expect(unchanged).toMatchObject({
        _tag: "ServiceUnavailableError",
        message: "Session wait is not available yet",
        service: "session.wait",
      })
      gates.at(3)!.resolve()
      yield* client.sessions.drain({ sessionID: other.id })
      return yield* Effect.void
    }),
  30_000,
)
