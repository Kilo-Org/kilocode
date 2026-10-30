import { expect, test } from "bun:test"
import { createRoutes } from "@opencode/server/routes"
import { Context, Effect, Layer, References } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { KiloHost } from "../src/host"

const builtin = "review changes [commit|branch|pr], defaults to uncommitted"
const kilo = "review changes [uncommitted|staged|unpushed|branch|commit|pr]"

// The real plugin order of the server the host starts: the built-in `review`, then the Kilo `review`, then config
// commands. Each later definition of a name replaces the earlier one.
test("the server lists the Kilo review command instead of the built-in one", async () => {
  const commands = await list(undefined)
  expect(commands.filter((command) => command.name === "review")).toEqual([{ name: "review", description: kilo }])
  expect(commands.map((command) => command.description)).not.toContain(builtin)
}, 30_000)

test("a config-defined review command replaces the Kilo review command", async () => {
  const commands = await list({ commands: { review: { description: "team review", template: "Review $ARGUMENTS" } } })
  expect(commands.filter((command) => command.name === "review")).toEqual([
    { name: "review", description: "team review" },
  ])
}, 30_000)

async function list(config: object | undefined) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "kilo-review-"))
  const expected = config === undefined ? kilo : "team review"
  try {
    return await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const context = yield* Layer.build(
            createRoutes(
              {
                password: "secret",
                database: { path: ":memory:" },
                models: { fetch: false },
                fs: { filewatcher: false },
                config: {
                  directory,
                  project: false,
                  ...(config === undefined ? {} : { content: JSON.stringify(config) }),
                },
              },
              () => [],
              KiloHost.overrides,
            ).pipe(Layer.provide(HttpServer.layerServices)),
          )
          const handler = Context.get(context, HttpRouter.HttpRouter)
            .asHttpEffect()
            .pipe(HttpEffect.toWebHandlerWith(context))
          const get = Effect.promise(async () => {
            const url = new URL("/api/command", "http://kilo.local")
            url.searchParams.set("location[directory]", directory)
            const response = await handler(
              new Request(url, { headers: { authorization: `Basic ${btoa("opencode:secret")}` } }),
            )
            return ((await response.json()).data ?? []) as { name: string; description?: string }[]
          })
          // Plugins activate in the background; wait for the generation that has the expected review.
          return yield* eventually(get, (data) =>
            data.some((command) => command.name === "review" && command.description === expected),
          )
        }),
      ).pipe(Effect.provideService(References.MinimumLogLevel, "Warn")),
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

function eventually<A>(effect: Effect.Effect<A>, predicate: (value: A) => boolean, remaining = 200): Effect.Effect<A> {
  return Effect.gen(function* () {
    const value = yield* effect
    if (predicate(value) || remaining === 0) return value
    yield* Effect.sleep("25 millis")
    return yield* eventually(effect, predicate, remaining - 1)
  })
}
