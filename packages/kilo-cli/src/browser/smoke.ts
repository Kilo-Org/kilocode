// Runs one registered tool from the compiled binary, through the same Location graph the server builds: the Kilo
// plugins register on boot (`KiloHost.overrides` → `SdkPlugins`), the Tool service collects them, and this runs
// `browser_navigate` once with a synthetic call context. It exists to prove the bundled Playwright backend inside a
// `Bun.build({ compile: true })` binary, so it stays a spike harness: no session, no model, no permissions.
import { NodeHttpServer } from "@effect/platform-node"
import { databasePath } from "@opencode/cli/database-path"
import { Runtime } from "@opencode/cli/framework/runtime"
import { OPENCODE_CHANNEL, OPENCODE_VERSION } from "@opencode/cli/version"
import { Location } from "@opencode/core/location"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Plugin } from "@opencode/core/plugin"
import { AbsolutePath } from "@opencode/core/schema"
import { Tool } from "@opencode/core/tool"
import { Agent } from "@opencode/schema/agent"
import { SessionID } from "@opencode/schema/session-id"
import { SessionMessage } from "@opencode/schema/session-message"
import { createRoutes } from "@opencode/server/routes"
import { Global } from "@opencode/util/global"
import { Context, Effect, Layer, Option } from "effect"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { KiloApp } from "../app"
import { BrowserSmokeCommand } from "./command"
import { KiloHost } from "../host"

const TIMEOUT = "5 minutes"

export default Runtime.handler(
  BrowserSmokeCommand,
  Effect.fnUntraced(function* (input) {
    const directory = path.resolve(Option.getOrUndefined(input.directory) ?? process.cwd())
    const routes = createRoutes(
      {
        app: { name: KiloApp.name, version: OPENCODE_VERSION, channel: OPENCODE_CHANNEL },
        password: randomUUID(),
        database: { path: databasePath(Global.Path.data) },
      },
      () => [],
      KiloHost.overrides,
    )
    const context = yield* Layer.build(routes.pipe(Layer.provideMerge(NodeHttpServer.layerHttpServices)))
    const locations = Context.get(context, LocationServiceMap.Service)
    const ref = Location.Ref.make({ directory: AbsolutePath.make(directory) })

    const result = yield* Effect.gen(function* () {
      // Plugins of a cold Location register their tools asynchronously; the catalogue is complete when this returns.
      yield* Plugin.awaitActivation
      const tools = yield* Tool.Service
      const tool = (yield* tools.list()).find((item) => item.name === "browser_navigate")
      if (!tool) return yield* Effect.fail(new Error("browser_navigate is not registered in this build"))
      return yield* tool.execute({ url: input.url }, {
        sessionID: SessionID.make("ses_browser_smoke"),
        agent: Agent.ID.make("build"),
        messageID: SessionMessage.ID.make("msg_browser_smoke"),
        id: Tool.CallID.make("call_browser_smoke"),
        progress: () => Effect.void,
      }) as Effect.Effect<Tool.Result, Tool.Error>
    }).pipe(Effect.provide(locations.get(ref)), Effect.scoped, Effect.timeout(TIMEOUT))

    yield* Effect.sync(() => process.stdout.write(`${result.output ?? ""}\n`))
  }),
)
