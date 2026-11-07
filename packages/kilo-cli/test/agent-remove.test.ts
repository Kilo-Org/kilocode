import { expect, test } from "bun:test"
import { $ } from "bun"
import { OpenCode } from "@opencode/client"
import { KiloAgentRpc } from "@opencode/schema/kilocode/agent"
import { createRoutes } from "@opencode/server/routes"
import { Context, Effect, Layer, References } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { KiloHost } from "../src/host"

// The kilocode.agent RPC through the real host: a markdown agent discovered by the config agent plugin is
// removable, removing it deletes only that file, and the registry drops it. The neighbouring agent stays.
const AGENT = ["---", "description: Reviews code", "---", "", "Review the change.", ""].join("\n")
const NEIGHBOUR = ["---", "description: Writes tests", "---", "", "Write the tests.", ""].join("\n")

async function eventually<A>(read: () => Promise<A>, ready: (value: A) => boolean) {
  const deadline = performance.now() + 10_000
  while (performance.now() < deadline) {
    const value = await read()
    if (ready(value)) return value
    await Bun.sleep(20)
  }
  throw new Error("The agent registry did not converge")
}

// The real host and client for one directory, with the global config directory beside the workspace.
async function withHost(
  directory: string,
  run: (client: ReturnType<typeof OpenCode.make>, options: { location: { directory: string } }) => Promise<void>,
) {
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
        yield* Effect.promise(() => run(client, { location: { directory } }))
      }),
    ).pipe(Effect.provideService(References.MinimumLogLevel, "Warn")),
  )
}

test(
  "a markdown agent is removable and only its file is deleted",
  async () => {
    const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-agent-rpc-")))
    await $`git init -q -b main ${directory}`.quiet()
    const file = path.join(directory, ".kilo2", "agents", "demo.md")
    const neighbour = path.join(directory, ".kilo2", "agents", "writer.md")
    const global = path.join(directory, "global")
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, AGENT)
    await writeFile(neighbour, NEIGHBOUR)
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
                  config: { directory: global, project: true },
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
              const rpc = client.rpc(KiloAgentRpc.Definition)

              await eventually(
                () => client.agent.list(options),
                (result) => result.data.some((agent) => agent.id === "demo"),
              )
              expect(await rpc.removable({}, options)).toEqual([
                { name: "demo", path: file, scope: "project" },
                { name: "writer", path: neighbour, scope: "project" },
              ])

              await rpc.remove({ name: "demo" }, options)
              expect(await Bun.file(file).exists()).toBe(false)
              expect(await Bun.file(neighbour).exists()).toBe(true)

              const refreshed = await eventually(
                () => client.agent.list(options),
                (result) => !result.data.some((agent) => agent.id === "demo"),
              )
              expect(refreshed.data.some((agent) => agent.id === "writer")).toBe(true)
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

test(
  "a workspace path that differs from its real path still finds its agents",
  async () => {
    // `mkdtemp` returns the path the platform hands out, which on macOS is `/var/folders/...` while the filesystem
    // resolves it to `/private/var/folders/...`. The location and config directories keep that unresolved form here,
    // so a containment check that resolves only one side drops every root.
    const directory = await mkdtemp(path.join(os.tmpdir(), "kilo-agent-rpc-"))
    const file = path.join(directory, ".kilo2", "agents", "demo.md")
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, AGENT)
    await $`git init -q -b main ${directory}`.quiet()
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
              const rpc = client.rpc(KiloAgentRpc.Definition)
              await eventually(
                () => client.agent.list(options),
                (result) => result.data.some((agent) => agent.id === "demo"),
              )
              const listed = await rpc.removable({}, options)
              expect(listed.map((agent) => agent.name)).toContain("demo")

              await rpc.remove({ name: "demo" }, options)
              expect(await Bun.file(file).exists()).toBe(false)
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

test(
  "a config directory that is a symlink outside the project is never a removal root",
  async () => {
    const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-agent-rpc-")))
    // The link target holds an `agents` tree, but it lives outside the project, so nothing in it may be deleted
    // through the project config directory.
    const outside = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-agent-outside-")))
    const victim = path.join(outside, "agents", "outside.md")
    await mkdir(path.dirname(victim), { recursive: true })
    await writeFile(victim, AGENT)
    await $`git init -q -b main ${directory}`.quiet()
    await symlink(outside, path.join(directory, ".kilo2"))
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
              const rpc = client.rpc(KiloAgentRpc.Definition)
              await Bun.sleep(200)

              expect((await rpc.removable({}, options)).some((agent) => agent.name === "outside")).toBe(false)
              const error = await rpc.remove({ name: "outside" }, options).then(
                () => undefined,
                (cause: unknown) => cause,
              )
              expect(error).toBeDefined()
              expect(await Bun.file(victim).exists()).toBe(true)
            })
          }),
        ).pipe(Effect.provideService(References.MinimumLogLevel, "Warn")),
      )
    } finally {
      await rm(directory, { recursive: true, force: true })
      await rm(outside, { recursive: true, force: true })
    }
  },
  30_000,
)

test(
  "a built-in agent is not removable and stays refused",
  async () => {
    const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-agent-rpc-")))
    await $`git init -q -b main ${directory}`.quiet()
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
              const rpc = client.rpc(KiloAgentRpc.Definition)
              await eventually(
                () => client.agent.list(options),
                (result) => result.data.some((agent) => agent.id === "plan"),
              )

              expect((await rpc.removable({}, options)).some((agent) => agent.name === "plan")).toBe(false)
              const error = await rpc.remove({ name: "plan" }, options).then(
                () => undefined,
                (cause: unknown) => cause,
              )
              expect(error).toBeDefined()
              // A registered agent with no file is refused as not removable, not reported as unknown.
              expect(JSON.stringify(error)).toContain("not_removable")
              // A refused removal leaves the built-in agent in place.
              const after = await client.agent.list(options)
              expect(after.data.some((agent) => agent.id === "plan")).toBe(true)
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

// A source file with frontmatter the config agent plugin decodes.
const SOURCE = (description: string) => ["---", `description: ${description}`, "---", "", "Prompt.", ""].join("\n")

test(
  "a symlinked agents directory cannot delete outside the project",
  async () => {
    const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-agent-rpc-")))
    const outside = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-agent-outside-")))
    const victim = path.join(outside, "agents", "outside.md")
    await mkdir(path.dirname(victim), { recursive: true })
    await writeFile(victim, AGENT)
    await $`git init -q -b main ${directory}`.quiet()
    await mkdir(path.join(directory, ".kilo2"), { recursive: true })
    // The config plugin still discovers through the link; removal must not delete through it.
    await symlink(path.join(outside, "agents"), path.join(directory, ".kilo2", "agents"))
    try {
      await withHost(directory, async (client, options) => {
        const rpc = client.rpc(KiloAgentRpc.Definition)
        // Discovery must follow the link, or this would pass without ever exercising the containment guard.
        await eventually(
          () => client.agent.list(options),
          (result) => result.data.some((agent) => agent.id === "outside"),
        )
        expect((await rpc.removable({}, options)).some((agent) => agent.name === "outside")).toBe(false)
        const error = await rpc.remove({ name: "outside" }, options).then(
          () => undefined,
          (cause: unknown) => cause,
        )
        expect(error).toBeDefined()
        expect(await Bun.file(victim).exists()).toBe(true)
      })
    } finally {
      await rm(directory, { recursive: true, force: true })
      await rm(outside, { recursive: true, force: true })
    }
  },
  30_000,
)

test(
  "removal covers exactly the files the config agent plugin discovers",
  async () => {
    // The same source directories the config agent plugin scans, plus a wrong-depth and a non-agent file. This ties
    // the copied discovery rules to the real plugin instead of only to their own literals.
    const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-agent-rpc-")))
    await $`git init -q -b main ${directory}`.quiet()
    const config = path.join(directory, ".kilo2")
    const files = {
      flat: path.join(config, "agents", "flat.md"),
      single: path.join(config, "agent", "single.md"),
      nested: path.join(config, "agents", "nested", "deep.md"),
      mode: path.join(config, "mode", "reviewer.md"),
      modes: path.join(config, "modes", "writer.md"),
      wrong: path.join(config, "modes", "nested", "wrong.md"),
      ignored: path.join(config, "skills", "ignored.md"),
    }
    for (const [name, file] of Object.entries(files)) {
      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(file, SOURCE(name))
    }
    try {
      await withHost(directory, async (client, options) => {
        const rpc = client.rpc(KiloAgentRpc.Definition)
        const expected = ["flat", "single", "nested/deep", "reviewer", "writer"]
        const registry = await eventually(
          () => client.agent.list(options),
          (result) => expected.every((id) => result.data.some((agent) => agent.id === id)),
        )
        expect(registry.data.some((agent) => agent.id === "nested/wrong")).toBe(false)
        expect(registry.data.some((agent) => agent.id === "ignored")).toBe(false)
        expect((await rpc.removable({}, options)).map((agent) => agent.name).sort()).toEqual(expected.toSorted())
      })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  },
  30_000,
)

test(
  "an ancestor .kilo2 inside the worktree stays removable from a subdirectory workspace",
  async () => {
    // Config discovery walks up to the worktree root, so these agents are listed; the removal root must match it.
    const repository = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-agent-rpc-")))
    const directory = path.join(repository, "packages", "app")
    const file = path.join(repository, ".kilo2", "agents", "demo.md")
    await mkdir(path.dirname(file), { recursive: true })
    await mkdir(directory, { recursive: true })
    await writeFile(file, AGENT)
    await $`git init -q -b main ${repository}`.quiet()
    try {
      await withHost(directory, async (client, options) => {
        const rpc = client.rpc(KiloAgentRpc.Definition)
        await eventually(
          () => client.agent.list(options),
          (result) => result.data.some((agent) => agent.id === "demo"),
        )
        expect((await rpc.removable({}, options)).map((agent) => agent.name)).toContain("demo")
        await rpc.remove({ name: "demo" }, options)
        expect(await Bun.file(file).exists()).toBe(false)
      })
    } finally {
      await rm(repository, { recursive: true, force: true })
    }
  },
  30_000,
)

test(
  "a config definition outlives its markdown file",
  async () => {
    const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-agent-rpc-")))
    await $`git init -q -b main ${directory}`.quiet()
    const config = path.join(directory, ".kilo2")
    const file = path.join(config, "agents", "demo.md")
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, AGENT)
    await writeFile(path.join(config, "kilo2.jsonc"), JSON.stringify({ agents: { demo: { description: "From config" } } }))
    try {
      await withHost(directory, async (client, options) => {
        const rpc = client.rpc(KiloAgentRpc.Definition)
        await eventually(
          () => client.agent.list(options),
          (result) => result.data.some((agent) => agent.id === "demo"),
        )
        expect((await rpc.removable({}, options)).map((agent) => agent.name)).toContain("demo")
        await rpc.remove({ name: "demo" }, options)
        expect(await Bun.file(file).exists()).toBe(false)
        // The config entry keeps the agent registered, so the removal must not wait for it to leave the registry.
        expect((await client.agent.list(options)).data.some((agent) => agent.id === "demo")).toBe(true)
      })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  },
  30_000,
)
