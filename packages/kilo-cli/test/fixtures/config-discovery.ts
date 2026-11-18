// Prints the project config sources, commands and skills the Kilo host's server finds for a directory. Run in a
// child process: `KiloConfigFiles` reads KILO_USE_RELEASE_CONFIG when it loads.
// Usage: config-discovery.ts <project> <global> <command the project config adds>
import { createRoutes } from "@opencode/server/routes"
import { Context, Effect, Layer, References, Schedule } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import path from "node:path"
import { KiloHost } from "../../src/host"

const project = process.argv[2]!
const global = process.argv[3]!
const expected = process.argv[4]!

const result = await Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      const context = yield* Layer.build(
        createRoutes(
          {
            password: "secret",
            database: { path: ":memory:" },
            models: { fetch: false },
            fs: { filewatcher: false },
            config: { directory: global, claude: false },
          },
          () => [],
          KiloHost.overrides,
        ).pipe(Layer.provide(HttpServer.layerServices)),
      )
      const handler = Context.get(context, HttpRouter.HttpRouter)
        .asHttpEffect()
        .pipe(HttpEffect.toWebHandlerWith(context))
      const get = (route: string) =>
        Effect.promise(async () => {
          const url = new URL(route, "http://kilo.local")
          url.searchParams.set("location[directory]", project)
          const response = await handler(
            new Request(url, { headers: { authorization: `Basic ${btoa("opencode:secret")}` } }),
          )
          return await response.json()
        })
      const config = (yield* get("/api/config")) as { path?: string }[]
      // Plugins activate in the background; wait for the generation that has the project's command and skill. The
      // other project directory loads in the same pass, so its absence is final then.
      const eventually = (route: string) =>
        get(route).pipe(
          Effect.map((body) => (body as { data: { name: string }[] }).data),
          Effect.filterOrFail((data) => data.some((item) => item.name === expected)),
          Effect.retry({ schedule: Schedule.spaced("50 millis"), times: 200 }),
          Effect.orDie,
        )
      const commands = yield* eventually("/api/command")
      const skills = yield* eventually("/api/skill")
      return {
        // The system directory cannot be turned off through server options, so keep only the project entries.
        config: config.flatMap((entry) =>
          entry.path?.startsWith(project) ? [path.relative(project, entry.path).replaceAll("\\", "/")] : [],
        ),
        commands: commands.map((entry) => entry.name).toSorted(),
        skills: skills.map((entry) => entry.name).toSorted(),
      }
    }),
  ).pipe(Effect.provideService(References.MinimumLogLevel, "Error")),
)

process.stdout.write(JSON.stringify(result))
