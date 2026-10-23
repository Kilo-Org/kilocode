import { expect, spyOn, test } from "bun:test"
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
import { McpRegistry } from "../../kilo-plugin/src/marketplace/mcp-registry"
import { KiloHost } from "../src/host"

// The `kilocode.marketplace` RPC end to end: the host registers the marketplace plugin, the generated client calls it,
// and a local stand-in for the Kilo API serves the catalog YAML and the skill archive.
test("lists, installs and uninstalls marketplace skills and MCP servers through the generated client", async () => {
  const archive = await new Bun.Archive(
    {
      "demo/SKILL.md":
        "---\nname: Demo Display Name\ndescription: Demo\nmetadata:\n  opencode/autoinvoke: false\n---\nBody",
    },
    {
      compress: "gzip",
    },
  ).bytes()
  const searches = new Map<string, number>()
  using backend = Bun.serve({
    port: 0,
    fetch: (request) => {
      const url = new URL(request.url)
      if (url.pathname === "/v0/servers") {
        const query = url.searchParams.get("search") ?? ""
        searches.set(query, (searches.get(query) ?? 0) + 1)
        return Response.json({
          servers: query
            ? [
                {
                  server: {
                    name: `example/${query === "needle" ? "searched" : query}`,
                    remotes: [{ type: "streamable-http", url: "https://example.com/mcp" }],
                  },
                },
              ]
            : [],
        })
      }
      if (url.pathname === "/api/marketplace/skills") {
        return new Response(
          `items:\n  - id: demo\n    description: Demo skill\n    content: ${url.origin}/demo.tar.gz\n`,
          { headers: { "content-type": "application/x-yaml" } },
        )
      }
      if (url.pathname === "/api/marketplace/mcps") {
        return new Response(
          [
            "items:",
            "  - id: demo-mcp",
            "    name: Demo MCP",
            "    description: Demo server",
            "    parameters:",
            "      - name: API key",
            "        key: API_KEY",
            "    content:",
            "      - name: NPX",
            "        content: |",
            '          { "command": "npx", "args": ["-y", "demo"], "env": { "API_KEY": "{{API_KEY}}" } }',
            "",
          ].join("\n"),
          { headers: { "content-type": "application/x-yaml" } },
        )
      }
      if (url.pathname === "/demo.tar.gz") return new Response(archive)
      return new Response("not found", { status: 404 })
    },
  })
  // Keep the real registry adapter, pointing its HTTP requests at the local fixture.
  const make = McpRegistry.make
  using registry = spyOn(McpRegistry, "make").mockImplementation(() => make({ base: backend.url.origin }))
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
            const items = await rpc.list({ kind: "skill" }, options)
            expect(items).toEqual({
              items: [expect.objectContaining({ registry: "kilo", kind: "skill", id: "demo" })],
              failures: [],
            })

            for (const scope of ["global", "project"] as const) {
              expect((await client.skill.list(options)).data.some((skill) => skill.id === "demo")).toBe(false)
              const input = { registry: "kilo", kind: "skill" as const, id: "demo", scope }
              const record = await rpc.install(input, options)
              const target = path.join(directory, scope === "global" ? "global" : ".kilo2", "skills", "demo")
              expect(record.paths).toEqual([target])
              // Exercise native discovery after the public reload boundary, without a watcher or model call.
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

            const record = await rpc.install({ registry: "kilo", kind: "skill", id: "demo", scope: "project" }, options)
            const target = path.join(directory, ".kilo2", "skills", "demo")
            expect(record).toMatchObject({ scope: "project", paths: [target] })
            expect(await Bun.file(path.join(target, "SKILL.md")).text()).toContain("Body")
            expect(await rpc.installed({}, options)).toEqual([record])

            // A second install replaces the marketplace's own directory instead of reporting a conflict.
            await rpc.install({ registry: "kilo", kind: "skill", id: "demo", scope: "project" }, options)

            await expect(
              rpc.install({ registry: "kilo", kind: "skill", id: "missing", scope: "project" }, options),
            ).rejects.toMatchObject({ type: "not_found" })
            await expect(
              rpc.install({ registry: "kilo", kind: "agent", id: "demo", scope: "project" }, options),
            ).rejects.toMatchObject({ type: "unsupported" })

            // An MCP server goes into the project config, with its parameters filled and converted to the v2 shape.
            const mcp = { registry: "kilo", kind: "mcp" as const, id: "demo-mcp", scope: "project" as const }
            await expect(rpc.install(mcp, options)).rejects.toMatchObject({ type: "invalid_params" })
            const beforePreview = await rpc.installed({}, options)
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
            expect(await rpc.installed({}, options)).toEqual(beforePreview)
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

            // Failed obsolete-config cleanup must not lose the newly installed server or its pending ownership.
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

            // Only the curated registry is on by default; community registries are opt-in.
            const enabled = (list: readonly { id: string; enabled: boolean }[]) =>
              list.filter((registry) => registry.enabled).map((registry) => registry.id)
            expect(enabled(await rpc.registries({}, options))).toEqual(["kilo"])
            await expect(
              rpc.install({ registry: "skills.sh", kind: "skill", id: "a/b/c", scope: "project" }, options),
            ).rejects.toMatchObject({ type: "not_found" })
            expect(enabled(await rpc["registries.set"]({ id: "skills.sh", enabled: true }, options))).toEqual([
              "kilo",
              "skills.sh",
            ])
            expect(enabled(await rpc["registries.set"]({ id: "skills.sh", enabled: false }, options))).toEqual(["kilo"])
            await expect(rpc["registries.set"]({ id: "nope", enabled: true }, options)).rejects.toMatchObject({
              type: "not_found",
            })

            expect(
              await rpc.uninstall({ registry: "kilo", kind: "skill", id: "demo", scope: "project" }, options),
            ).toEqual({})
            expect(await readdir(path.join(directory, ".kilo2", "skills"))).toEqual([])
            expect(await rpc.installed({}, options)).toEqual([])
            await expect(
              rpc.uninstall({ registry: "kilo", kind: "skill", id: "demo", scope: "project" }, options),
            ).rejects.toMatchObject({ type: "not_found" })

            // A searched item installs from the bounded catalog, then refetches after its page is evicted.
            await rpc["registries.set"]({ id: "mcp-registry", enabled: true }, options)
            await rpc.list({ kind: "mcp", query: "needle" }, options)
            await rpc.list({ kind: "mcp", query: "needle" }, options)
            expect(searches.get("needle")).toBe(1)
            const searched = {
              registry: "mcp-registry",
              kind: "mcp" as const,
              id: "example/searched",
              scope: "project" as const,
            }
            await rpc.install(searched, options)
            expect(searches.has("searched")).toBe(false)
            await rpc.uninstall(searched, options)
            for (const index of Array.from({ length: 32 }, (_, index) => index)) {
              await rpc.list({ kind: "mcp", query: `evict-${index}` }, options)
            }
            await rpc.install(searched, options)
            expect(searches.get("")).toBe(1)
            expect(searches.get("searched")).toBe(1)
            await rpc.uninstall(searched, options)
            await rpc.list({ kind: "mcp", query: "needle" }, options)
            expect(searches.get("needle")).toBe(2)
            // Initial activation plus the four public reloads above; catalog queries reuse each adapter.
            expect(registry).toHaveBeenCalledTimes(5)

            // Other projects fill the first page; global and current-project records span later pages.
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
