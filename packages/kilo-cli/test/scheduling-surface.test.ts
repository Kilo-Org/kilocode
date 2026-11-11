import { expect, test } from "bun:test"
import { Location } from "@opencode/core/location"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Plugin } from "@opencode/core/plugin"
import { AbsolutePath } from "@opencode/core/schema"
import { Skill } from "@opencode/core/skill"
import { Tool } from "@opencode/core/tool"
import { KiloHost } from "../src/host"
import { createRoutes } from "@opencode/server/routes"
import { Context, Effect, Layer, References } from "effect"
import { HttpServer } from "effect/http"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

// One scheduling surface: the host removes the native schedule tools, so only the wakeup plugin's five tools reach the
// model.
test(
  "the location registers the wakeup tools and not the native schedule tools",
  async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "kilo-scheduling-"))
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
                  config: { directory, project: false },
                },
                () => [],
                KiloHost.overrides,
              ).pipe(Layer.provide(HttpServer.layerServices)),
            )
            const locations = Context.get(context, LocationServiceMap.Service)
            const ref = LocationServiceMap.canonical(
              Location.Ref.make({ directory: AbsolutePath.make(directory) }),
            )
            const location = yield* locations.contextEffect(ref).pipe(Effect.scoped)
            yield* Context.get(location, Plugin.Service).awaitActivation
            const names = (yield* Context.get(location, Tool.Service).list()).map((tool) => tool.name).toSorted()
            expect(names).toContain("schedule_wakeup")
            expect(names).toContain("cancel_wakeup")
            expect(names).toContain("cron_create")
            expect(names).toContain("cron_list")
            expect(names).toContain("cron_delete")
            expect(names).not.toContain("schedule_create")
            expect(names).not.toContain("schedule_list")
            expect(names).not.toContain("schedule_delete")

            const skills = yield* Context.get(location, Skill.Service).list()
            // The policy is not a model-loadable skill.
            expect(skills.some((skill) => skill.id === "scheduling")).toBe(false)
            expect(skills.some((skill) => skill.id === "kilo-config")).toBe(true)
            // The upstream skills Kilo replaces must not compete with the Kilo guide.
            expect(skills.some((skill) => skill.id === "opencode")).toBe(false)
          }),
        ).pipe(Effect.provideService(References.MinimumLogLevel, "Warn")),
      )
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  },
  30_000,
)
