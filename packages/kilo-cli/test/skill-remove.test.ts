import { expect, test } from "bun:test"
import { OpenCode } from "@opencode/client"
import { KiloSkillRpc } from "@opencode/schema/kilocode/skill"
import { createRoutes } from "@opencode/server/routes"
import { Context, Effect, Layer, References } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { KiloHost } from "../src/host"

// The kilocode.skill RPC through the real host: a skill in the project's configured directory is removable, the
// removal deletes its manifest, and the config skill plugin rescans so the registry and `skill.list` lose it.
const SKILL = ["---", "name: demo", "description: A skill used by the removal test.", "---", "", "Demo body.", ""].join(
  "\n",
)

async function eventually<A>(read: () => Promise<A>, ready: (value: A) => boolean) {
  const deadline = performance.now() + 10_000
  while (performance.now() < deadline) {
    const value = await read()
    if (ready(value)) return value
    await Bun.sleep(20)
  }
  throw new Error("The skill registry did not converge")
}

test(
  "a configured skill is removable, its manifest is deleted, and the registry refreshes",
  async () => {
    const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-skill-rpc-")))
    const file = path.join(directory, ".kilo2", "skills", "demo", "SKILL.md")
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, SKILL)
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
                  config: { directory: path.join(directory, "global"), project: true },
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
            yield* Effect.promise(async () => {
              const options = { location: { directory } }
              const rpc = client.rpc(KiloSkillRpc.Definition)

              await eventually(
                () => client.skill.list(options),
                (result) => result.data.some((skill) => skill.path === file),
              )
              expect(await rpc.removable({}, options)).toEqual([file])

              await rpc.remove({ path: file }, options)
              expect(await Bun.file(file).exists()).toBe(false)

              const refreshed = await eventually(
                () => client.skill.list(options),
                (result) => !result.data.some((skill) => skill.path === file),
              )
              expect(refreshed.data.some((skill) => skill.path === file)).toBe(false)
            })
          }),
        ).pipe(Effect.provideService(References.MinimumLogLevel, "Warn")),
      )
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  },
  30_000,
)