import { expect, test } from "bun:test"
import { OpenCode } from "@opencode/client"
import { Database } from "@opencode/core/database/database"
import { KV } from "@opencode/core/kv"
import { storage } from "@opencode/core/plugin/host"
import { KiloMarketplaceRpc } from "@opencode/schema/kilocode/marketplace"
import { createRoutes } from "@opencode/server/routes"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Context, Effect, Layer, References } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { mkdtemp, readdir, realpath, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { KiloHost } from "../src/host"

async function eventually<A>(read: () => Promise<A>, ready: (value: A) => boolean) {
  const deadline = performance.now() + 10_000
  while (performance.now() < deadline) {
    const value = await read()
    if (ready(value)) return value
    await Bun.sleep(20)
  }
  throw new Error("Native skill/MCP watchers did not converge")
}

test("lists, installs and removes skills and MCPs through the generated client", async () => {
  const archive = await new Bun.Archive(
    {
      "demo/SKILL.md":
        "---\nname: Demo Display Name\ndescription: Demo\nmetadata:\n  opencode/autoinvoke: false\n---\nBody",
    },
    { compress: "gzip" },
  ).bytes()
  const requests: string[] = []
  using backend = Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url)
      requests.push(url.pathname)
      if (url.pathname === "/api/marketplace/skills")
        return new Response(
          Bun.YAML.stringify({
            items: [
              {
                id: "demo",
                description: "Demo skill",
                author: "Fixture Author",
                tags: ["fixture"],
                content: `${url.origin}/demo.tar.gz`,
              },
            ],
          }),
        )
      if (url.pathname === "/api/marketplace/mcps")
        return new Response(
          Bun.YAML.stringify({
            items: [
              {
                id: "demo-mcp",
                name: "Demo MCP",
                description: "Demo server",
                parameters: [{ name: "API key", key: "API_KEY" }],
                content: [
                  { name: "NPX", content: '{"command":"npx","args":["-y","demo"],"env":{"API_KEY":"{{API_KEY}}"}}' },
                ],
              },
            ],
          }),
        )
      if (url.pathname === "/demo.tar.gz") return new Response(archive)
      return new Response("not found", { status: 404 })
    },
  })
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-marketplace-")))
  const previous = process.env.KILO_API_URL
  process.env.KILO_API_URL = backend.url.origin
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
          const kv = yield* Layer.build(
            LayerNode.compile(KV.node, {
              replacements: [
                Database.node.replace(Layer.succeed(Database.Service, Context.get(context, Database.Service))),
              ],
            }),
          )
          const store = storage(Context.get(kv, KV.Service), "kilocode.marketplace")
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
            const rpc = client.rpc(KiloMarketplaceRpc.Definition)
            const options = { location: { directory } }
            expect(await rpc.list({ kind: "skill" }, options)).toEqual({
              items: [expect.objectContaining({ registry: "kilo", kind: "skill", id: "demo" })],
              failures: [],
            })
            expect((await rpc.list({ kind: "skill", query: "fixture author" }, options)).items).toHaveLength(1)
            expect((await rpc.list({ kind: "skill", query: "no match" }, options)).items).toEqual([])
            for (const scope of ["global", "project"] as const) {
              expect((await client.skill.list(options)).data.some((skill) => skill.id === "demo")).toBe(false)
              const input = { registry: "kilo", kind: "skill" as const, id: "demo", scope }
              const record = await rpc.install(input, options)
              const target = path.join(directory, scope === "global" ? "global" : ".kilo2", "skills", "demo")
              expect(record.paths).toEqual([target])
              // Retain explicit reload coverage separately from the real watcher test below.
              await client.location.reload()
              expect(await rpc.installed({}, options)).toEqual([record])
              expect((await client.skill.list(options)).data).toContainEqual({
                id: "demo",
                name: "Demo Display Name",
                description: "Demo",
                autoinvoke: false,
                path: path.join(target, "SKILL.md"),
                content: "Body",
              })
              await rpc.uninstall(input, options)
              await client.location.reload()
              expect(await rpc.installed({}, options)).toEqual([])
              expect((await client.skill.list(options)).data.some((skill) => skill.id === "demo")).toBe(false)
            }
            const skill = { registry: "kilo", kind: "skill", id: "demo", scope: "project" } as const
            const record = await rpc.install(skill, options)
            const target = path.join(directory, ".kilo2", "skills", "demo")
            expect(record).toMatchObject({ scope: "project", paths: [target] })
            expect(await Bun.file(path.join(target, "SKILL.md")).text()).toContain("Body")
            expect(await rpc.installed({}, options)).toEqual([record])
            await rpc.install(skill, options)
            await expect(rpc.install({ ...skill, id: "missing" }, options)).rejects.toMatchObject({ type: "not_found" })
            await expect(rpc.install({ ...skill, registry: "other" }, options)).rejects.toMatchObject({
              type: "not_found",
            })
            const mcp = { registry: "kilo", kind: "mcp", id: "demo-mcp", scope: "project" } as const
            await expect(rpc.install(mcp, options)).rejects.toMatchObject({ type: "invalid_params" })
            const before = await rpc.installed({}, options)
            const preview = await rpc.preview(
              { ...mcp, option: "NPX", params: { API_KEY: "private-preview-value" } },
              options,
            )
            expect(preview.config).toBe(path.join(directory, "kilo2.json"))
            expect(JSON.parse(preview.server)).toEqual({
              type: "local",
              command: ["npx", "-y", "demo"],
              environment: { API_KEY: "[redacted]" },
            })
            expect(preview.parameters).toEqual(["API key (API_KEY)"])
            expect(preview.secrets).toEqual(["API key"])
            expect(JSON.stringify(preview)).not.toContain("private-preview-value")
            expect(await Bun.file(preview.config).exists()).toBe(false)
            expect(await rpc.installed({}, options)).toEqual(before)
            await expect(rpc.preview(mcp, options)).rejects.toMatchObject({ type: "invalid_params" })
            const server = await rpc.install({ ...mcp, option: "NPX", params: { API_KEY: "secret" } }, options)
            const config = path.join(directory, "kilo2.json")
            expect(server).toMatchObject({ config, paths: [] })
            expect(await Bun.file(config).json()).toEqual({
              mcp: {
                servers: {
                  "demo-mcp": { type: "local", command: ["npx", "-y", "demo"], environment: { API_KEY: "secret" } },
                },
              },
            })
            const oldServer = (await Bun.file(config).json()).mcp.servers["demo-mcp"]
            expect(await rpc.uninstall(mcp, options)).toEqual({})
            expect(await Bun.file(config).json()).toEqual({ mcp: { servers: {} } })
            const obsolete = path.join(directory, "kilo2.jsonc")
            const replacement = path.join(directory, ".kilo2", "kilo2.jsonc")
            await Bun.write(obsolete, "{ broken")
            await Bun.write(replacement, "{}")
            await Effect.runPromise(
              store.set(
                `installed:kilo:mcp:demo-mcp:project:${directory}`,
                JSON.stringify({
                  ...server,
                  config: obsolete,
                  resources: server.resources?.map((resource) =>
                    "config" in resource ? { ...resource, config: obsolete, target: obsolete } : resource,
                  ),
                }),
              ),
            )
            const reinstalled = await rpc.install({ ...mcp, params: { API_KEY: "replacement" } }, options)
            expect(reinstalled).toMatchObject({
              config: replacement,
              pending: [{ config: obsolete, server: "demo-mcp", fingerprints: expect.any(Array) }],
            })
            expect(await rpc.installed({}, options)).toContainEqual(reinstalled)
            expect((await Bun.file(replacement).json()).mcp.servers["demo-mcp"].environment.API_KEY).toBe("replacement")
            await expect(rpc.uninstall(mcp, options)).rejects.toMatchObject({ type: "invalid_params" })
            expect(await rpc.installed({}, options)).toContainEqual({ ...reinstalled, status: "missing" })
            await Bun.write(obsolete, JSON.stringify({ mcp: { servers: { "demo-mcp": oldServer } } }))
            await rpc.uninstall(mcp, options)
            expect(await Bun.file(obsolete).json()).toEqual({ mcp: { servers: {} } })
            expect((await rpc.installed({}, options)).some((record) => record.id === mcp.id)).toBe(false)
            expect(await rpc.uninstall(skill, options)).toEqual({})
            expect(await readdir(path.join(directory, ".kilo2", "skills"))).toEqual([])
            expect(await rpc.installed({}, options)).toEqual([])
            await expect(rpc.uninstall(skill, options)).rejects.toMatchObject({ type: "not_found" })
            expect(
              requests
                .filter((request) => request.includes("marketplace") || request.startsWith("/v0/"))
                .every((request) =>
                  ["/api/marketplace/skills", "/api/marketplace/mcps", "/demo.tar.gz"].includes(request),
                ),
            ).toBe(true)
            const manifests = Array.from({ length: 205 }, (_, index): KiloMarketplaceRpc.Installed => {
              const scope = index >= 105 && index % 3 === 0 ? "global" : "project"
              return {
                registry: "kilo",
                kind: "skill",
                id: `scan-${String(index).padStart(3, "0")}`,
                scope,
                ...(scope === "project"
                  ? { project: index < 105 || index % 3 === 2 ? path.join(directory, "other") : directory }
                  : {}),
                paths: [],
                installedAt: 1,
              }
            })
            await Effect.runPromise(
              Effect.forEach(manifests, (record) => store.set(`installed:${record.id}`, JSON.stringify(record))),
            )
            expect(await rpc.installed({}, options)).toMatchObject(
              manifests.filter((record) => record.scope === "global" || record.project === directory),
            )
          })
        }),
      ).pipe(Effect.provideService(References.MinimumLogLevel, "Warn")),
    )
  } finally {
    if (previous === undefined) delete process.env.KILO_API_URL
    else process.env.KILO_API_URL = previous
    await rm(directory, { recursive: true, force: true })
  }
}, 30_000)

test("native watchers activate and remove installed skills and MCPs without location reload", async () => {
  const archive = await new Bun.Archive({
    "SKILL.md": "---\nname: Watcher Skill\ndescription: Watcher fixture\n---\nBody",
    "references/guide.md": "Supporting resource",
  }).bytes()
  using backend = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === "/api/marketplace/skills")
        return new Response(Bun.YAML.stringify({ items: [{ id: "watcher", content: `${url.origin}/skill.tar` }] }))
      if (url.pathname === "/api/marketplace/mcps")
        return new Response(
          Bun.YAML.stringify({
            items: [
              {
                id: "watcher-mcp",
                content: JSON.stringify({ type: "remote", url: `${url.origin}/mcp`, oauth: false }),
              },
            ],
          }),
        )
      if (url.pathname === "/skill.tar") return new Response(archive)
      if (url.pathname !== "/mcp") return new Response(null, { status: 404 })
      if (request.method !== "POST") return new Response(null, { status: 405 })
      const message: { id?: number; method: string } = await request.json()
      if (message.id === undefined) return new Response(null, { status: 202 })
      return Response.json({
        jsonrpc: "2.0",
        id: message.id,
        result:
          message.method === "initialize"
            ? { protocolVersion: "2025-11-25", capabilities: {}, serverInfo: { name: "watcher", version: "1" } }
            : {},
      })
    },
  })
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-marketplace-watch-")))
  const previous = process.env.KILO_API_URL
  process.env.KILO_API_URL = backend.url.origin
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const context = yield* Layer.build(
            createRoutes(
              {
                password: "fixture",
                database: { path: ":memory:" },
                models: { fetch: false },
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
            headers: { authorization: `Basic ${btoa("opencode:fixture")}` },
            fetch: Object.assign(
              async (input: string | URL | Request, init?: RequestInit) =>
                handler(input instanceof Request ? input : new Request(input, init)),
              { preconnect: fetch.preconnect },
            ),
          })
          yield* Effect.promise(async () => {
            const options = { location: { directory } }
            const rpc = client.rpc(KiloMarketplaceRpc.Definition)
            for (const scope of ["project", "global"] as const) {
              expect((await client.skill.list(options)).data.some((skill) => skill.id === "watcher")).toBe(false)
              expect((await client.mcp.list(options)).data.some((server) => server.name === "watcher-mcp")).toBe(false)
              const skill = { registry: "kilo", kind: "skill", id: "watcher", scope } as const
              const installed = await rpc.install(skill, options)
              expect(await Bun.file(path.join(installed.paths[0], "references", "guide.md")).text()).toBe(
                "Supporting resource",
              )
              await eventually(
                () => client.skill.list(options),
                (value) => value.data.some((skill) => skill.id === "watcher"),
              )
              await rpc.uninstall(skill, options)
              await eventually(
                () => client.skill.list(options),
                (value) => !value.data.some((skill) => skill.id === "watcher"),
              )
              const mcp = { registry: "kilo", kind: "mcp", id: "watcher-mcp", scope } as const
              await rpc.install(mcp, options)
              await eventually(
                () => client.mcp.list(options),
                (value) =>
                  value.data.some((server) => server.name === "watcher-mcp" && server.status.status === "connected"),
              )
              await rpc.uninstall(mcp, options)
              await eventually(
                () => client.mcp.list(options),
                (value) => !value.data.some((server) => server.name === "watcher-mcp"),
              )
              expect(await rpc.installed({}, options)).toEqual([])
            }
          })
        }),
      ).pipe(Effect.provideService(References.MinimumLogLevel, "Warn")),
    )
  } finally {
    if (previous === undefined) delete process.env.KILO_API_URL
    else process.env.KILO_API_URL = previous
    await rm(directory, { recursive: true, force: true })
  }
}, 60_000)
