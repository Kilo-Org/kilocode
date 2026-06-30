import { NodeHttpServer } from "@effect/platform-node"
import { describe, expect } from "bun:test"
import { Context, Effect, Fiber, Layer, Option, Stream } from "effect"
import { HttpClient, HttpRouter } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Auth } from "../../../src/auth"
import { GlobalBus } from "../../../src/bus/global"
import { Config } from "../../../src/config/config"
import { Installation } from "../../../src/installation"
import { ServerAuth } from "../../../src/server/auth"
import { RootHttpApi } from "../../../src/server/routes/instance/httpapi/api"
import { GlobalPaths } from "../../../src/server/routes/instance/httpapi/groups/global"
import { controlHandlers } from "../../../src/server/routes/instance/httpapi/handlers/control"
import { globalHandlers } from "../../../src/server/routes/instance/httpapi/handlers/global"
import { authorizationLayer } from "../../../src/server/routes/instance/httpapi/middleware/authorization"
import { schemaErrorLayer } from "../../../src/server/routes/instance/httpapi/middleware/schema-error"
import { pollWithTimeout, testEffect } from "../../lib/effect"

const apiLayer = HttpRouter.serve(
  HttpApiBuilder.layer(RootHttpApi).pipe(
    Layer.provide([controlHandlers, globalHandlers]),
    Layer.provide([authorizationLayer, schemaErrorLayer]),
  ),
  { disableListenLog: true, disableLogger: true },
).pipe(
  Layer.provideMerge(NodeHttpServer.layerTest),
  Layer.provide(Layer.mock(Auth.Service)({})),
  Layer.provide(Layer.mock(Config.Service)({})),
  Layer.provide(
    Layer.mock(Installation.Service)({
      method: () => Effect.succeed("npm"),
      latest: () => Effect.succeed("9.9.9"),
      upgrade: () => Effect.void,
    }),
  ),
  Layer.provide(ServerAuth.Config.layer({ password: Option.none(), username: "opencode" })),
  // Raw HttpApi routes expose an opaque handler context at the web boundary.
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
  Layer.provide(Layer.succeedContext(Context.empty() as Context.Context<unknown>)),
)
const it = testEffect(apiLayer)

describe("global SSE lifecycle", () => {
  it.live(
    "removes event listeners after clients disconnect",
    () =>
      Effect.gen(function* () {
        const count = GlobalBus.listenerCount("event")

        for (const attempt of [1, 2, 3]) {
          const response = yield* HttpClient.get(GlobalPaths.event)
          expect(response.status).toBe(200)
          const fiber = yield* response.stream.pipe(Stream.runDrain, Effect.forkChild({ startImmediately: true }))

          yield* pollWithTimeout(
            Effect.sync(() => (GlobalBus.listenerCount("event") === count + 1 ? true : undefined)),
            `global event stream ${attempt} did not subscribe`,
          )
          yield* Fiber.interrupt(fiber)
          yield* pollWithTimeout(
            Effect.sync(() => (GlobalBus.listenerCount("event") === count ? true : undefined)),
            `global event stream ${attempt} did not remove its listener`,
          )
        }
      }),
    15_000,
  )
})
