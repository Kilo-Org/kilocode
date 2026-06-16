import { $ } from "bun"
import { describe, expect } from "bun:test"
import path from "path"
import { Effect, Layer, Schema } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { Flag } from "@opencode-ai/core/flag/flag"
import { HttpApiApp } from "../../../src/server/routes/instance/httpapi/server"
import { ExperimentalPaths } from "../../../src/server/routes/instance/httpapi/groups/experimental"
import { resetDatabase } from "../../fixture/db"
import { TestInstance } from "../../fixture/fixture"
import { testEffect } from "../../lib/effect"

const state = Layer.effectDiscard(
  Effect.gen(function* () {
    const original = Flag.KILO_EXPERIMENTAL_WORKSPACES
    Flag.KILO_EXPERIMENTAL_WORKSPACES = true
    yield* Effect.addFinalizer(() =>
      Effect.promise(async () => {
        Flag.KILO_EXPERIMENTAL_WORKSPACES = original
        await resetDatabase()
      }),
    )
  }),
)

const it = testEffect(state)
const run = process.platform === "win32" ? it.instance.skip : it.instance

type Server = ReturnType<typeof HttpRouter.toWebHandler>

function serve() {
  return Effect.acquireRelease(
    Effect.sync(() => HttpRouter.toWebHandler(HttpApiApp.routes, { disableLogger: true })),
    (server) => Effect.promise(() => server.dispose()).pipe(Effect.ignore),
  )
}

function request(server: Server, input: string) {
  return Effect.promise(() => server.handler(new Request(new URL(input, "http://localhost")), HttpApiApp.context))
}

describe("Kilo Console worktree listing", () => {
  run(
    "lists worktrees created by Agent Manager",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const server = yield* serve()
        const directory = path.join(test.directory, ".kilo", "worktrees", "console-list")
        yield* Effect.promise(() =>
          $`git worktree add --quiet -b console-list ${directory} HEAD`.cwd(test.directory).quiet(),
        )

        const response = yield* request(
          server,
          `${ExperimentalPaths.worktree}?directory=${encodeURIComponent(test.directory)}`,
        )
        expect(response.status).toBe(200)
        const worktrees = Schema.decodeUnknownSync(
          Schema.Array(Schema.Struct({ directory: Schema.String, managed: Schema.Boolean })),
        )(yield* Effect.promise(() => response.json()))

        expect(worktrees).toContainEqual({ directory, managed: false })
        expect(worktrees.map((item) => item.directory)).not.toContain(test.directory)
      }),
    { git: true },
  )
})
