import { expect, test } from "bun:test"
import { Agent } from "@opencode/core/agent"
import { Config } from "@opencode/core/config"
import { Location } from "@opencode/core/location"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Plugin } from "@opencode/core/plugin"
import { SdkPlugins } from "@opencode/core/plugin/sdk"
import { AbsolutePath } from "@opencode/core/schema"
import { createRoutes } from "@opencode/server/routes"
import { Context, Effect, Layer, Option, References } from "effect"
import { HttpServer } from "effect/http"
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

test("SDK plugins get each Location's Config in pre and post phases without changing config transform order", async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-plugin-context-")))
  const observed: { phase: string; directory: string; username: string | undefined; file: string | undefined }[] = []
  const agentID = Agent.ID.make("location-context-probe")
  try {
    for (const name of ["first", "second"]) {
      await mkdir(path.join(root, name))
      await Bun.write(
        path.join(root, name, "opencode.json"),
        JSON.stringify({ username: name, agents: { [agentID]: { description: `config-${name}` } } }),
      )
    }
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const context = yield* Layer.build(
            createRoutes(
              {
                database: { path: ":memory:" },
                models: { fetch: false },
                fs: { filewatcher: false },
                config: { directory: path.join(root, "global") },
              },
              () => [],
              [Config.node.replace(Config.configured({ global: false, system: false, claude: false }))],
            ).pipe(Layer.provide(HttpServer.layerServices)),
          )
          const sdk = Context.get(context, SdkPlugins.Service)
          yield* Effect.forEach(["pre", "post"] as const, (phase) =>
            sdk.register(
              {
                id: `test.location-context.${phase}`,
                effect: (ctx) =>
                  Effect.gen(function* () {
                    // SDK effects require only Scope, so inspect the Location service without widening their type.
                    const config = yield* Effect.serviceOption(Config.Service)
                    const entries = yield* Option.getOrThrow(config).entries()
                    observed.push({
                      phase,
                      directory: ctx.location.directory,
                      username: Config.latest(entries, "username"),
                      file: entries.find((entry) => entry.type === "document")?.path,
                    })
                    yield* ctx.agent.transform((editor) =>
                      editor.update(agentID, (agent) => {
                        if (phase === "pre") {
                          agent.system = "from-pre"
                          agent.description = "pre"
                          return
                        }
                        agent.description += ":post"
                      }),
                    )
                  }),
              },
              phase === "post" ? { phase } : undefined,
            ),
          )
          const locations = Context.get(context, LocationServiceMap.Service)
          for (const name of ["first", "second"]) {
            const directory = path.join(root, name)
            yield* Effect.gen(function* () {
              const plugins = yield* Plugin.Service
              yield* plugins.awaitActivation
              const inventory = yield* plugins.list()
              for (const phase of ["pre", "post"]) {
                expect(inventory.find((plugin) => plugin.id === `test.location-context.${phase}`)).toMatchObject({
                  source: { type: "sdk" },
                  state: { status: "active" },
                })
              }
              const agents = yield* Agent.Service
              expect(yield* agents.get(agentID)).toMatchObject({
                system: "from-pre",
                description: `config-${name}:post`,
              })
            }).pipe(Effect.provide(locations.get(Location.Ref.make({ directory: AbsolutePath.make(directory) }))))
          }
          expect(observed).toEqual(
            ["first", "second"].flatMap((name) =>
              ["pre", "post"].map((phase) => ({
                phase,
                directory: path.join(root, name),
                username: name,
                file: path.join(root, name, "opencode.json"),
              })),
            ),
          )
        }),
      ).pipe(Effect.provideService(References.MinimumLogLevel, "Warn")),
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 30_000)
