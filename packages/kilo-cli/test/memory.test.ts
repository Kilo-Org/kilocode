import { expect, test } from "bun:test"
import { $ } from "bun"
import { fixture } from "@kilocode/gateway-core/testing"
import { OpenCode } from "@opencode/client"
import { KiloMemoryRpc } from "@opencode/schema/kilocode/memory"
import { createRoutes } from "@opencode/server/routes"
import { Context, Effect, Layer, References } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { mkdtemp, realpath, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { KiloHost } from "../src/host"

// The kilocode.memory RPC and its events through the real host and
// the generated client, against a real git checkout and the test's isolated data directory.
type Client = ReturnType<typeof OpenCode.make>
type Event = { type: string; data?: Record<string, unknown> }

const waitFor = async (check: () => boolean, ms = 10_000) => {
  const deadline = Date.now() + ms
  while (!check()) {
    if (Date.now() > deadline) throw new Error("timed out")
    await Bun.sleep(25)
  }
}

test(
  "memory RPC enables, writes, reports, disables and purges project memory",
  async () => {
    using backend = fixture()
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-memory-rpc-")))
    const directory = path.join(root, "repo")
    await $`git init -q -b main ${directory}`.quiet()
    const previous = process.env.KILO_API_URL
    process.env.KILO_API_URL = backend.url
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
                  config: { directory: path.join(root, "global"), project: true },
                },
                () => [],
                KiloHost.overrides,
              ).pipe(Layer.provide(HttpServer.layerServices)),
            )
            const handler = Context.get(context, HttpRouter.HttpRouter)
              .asHttpEffect()
              .pipe(HttpEffect.toWebHandlerWith(context))
            const client: Client = OpenCode.make({
              baseUrl: "http://kilo.local",
              headers: { authorization: `Basic ${btoa("opencode:secret")}` },
              fetch: Object.assign(
                async (input: string | URL | Request, init?: RequestInit) =>
                  handler(input instanceof Request ? input : new Request(input, init)),
                { preconnect: fetch.preconnect },
              ),
            })
            const options = { location: { directory } }
            const rpc = client.rpc(KiloMemoryRpc.Definition)

            const disabled = yield* Effect.promise(() => rpc.status({}, options))
            expect(disabled.state.enabled).toBe(false)
            expect(disabled.root).toContain(path.join("memory", "repo-"))
            const refused = yield* Effect.promise(() => rpc.remember({ text: "nope" }, options).then(() => undefined, (error) => error))
            expect(refused).toMatchObject({ type: "memory_disabled" })

            const collected: Event[] = []
            const controller = new AbortController()
            void (async () => {
              for await (const event of client.event.subscribe({ signal: controller.signal })) collected.push(event as Event)
            })().catch(() => undefined)
            yield* Effect.promise(() => waitFor(() => collected.some((event) => event.type === "server.connected")))

            const enabled = yield* Effect.promise(() => rpc.enable({}, options))
            expect(enabled.state.enabled).toBe(true)
            yield* Effect.promise(() =>
              waitFor(() => collected.some((event) => event.type === "rpc.kilocode.memory.status" && event.data?.enabled === true)),
            )

            const saved = yield* Effect.promise(() =>
              rpc.remember({ key: "test_command", text: "The test command is bun test from the package directory" }, options),
            )
            expect(saved.added).toBeGreaterThan(0)
            yield* Effect.promise(() => waitFor(() => collected.some((event) => event.type === "rpc.kilocode.memory.updated")))

            // A linked worktree shares the memory folder of its repository.
            const linked = path.join(root, "linked")
            yield* Effect.promise(() => $`git -C ${directory} -c user.name=t -c user.email=t@t commit -q --allow-empty -m init`.quiet())
            yield* Effect.promise(() => $`git -C ${directory} worktree add -q ${linked}`.quiet())
            const sibling = yield* Effect.promise(() => rpc.status({}, { location: { directory: linked } }))
            expect(sibling.root).toBe(enabled.root)
            expect(sibling.state.enabled).toBe(true)

            const shown = yield* Effect.promise(() => rpc.show({}, options))
            expect(shown.sources.project).toContain("bun test")
            const status = yield* Effect.promise(() => rpc.status({}, options))
            expect(status.index.estimatedTokens).toBeGreaterThan(0)

            const configured = yield* Effect.promise(() => rpc.configure({ autoConsolidate: false }, options))
            expect(configured.state.autoConsolidate).toBe(false)

            const forgotten = yield* Effect.promise(() => rpc.forget({ query: "test_command" }, options))
            expect(forgotten.removed).toBeGreaterThan(0)

            const off = yield* Effect.promise(() => rpc.disable({}, options))
            expect(off.state.enabled).toBe(false)
            const purged = yield* Effect.promise(() => rpc.purge({ confirm: true }, options))
            expect(purged.purged).toBe(true)
            controller.abort()
          }).pipe(Effect.provideService(References.MinimumLogLevel, "Error")),
        ),
      )
    } finally {
      if (previous === undefined) delete process.env.KILO_API_URL
      else process.env.KILO_API_URL = previous
      await rm(root, { recursive: true, force: true })
    }
  },
  60_000,
)
