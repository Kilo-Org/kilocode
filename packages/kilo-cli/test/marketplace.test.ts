import { expect, spyOn, test } from "bun:test"
import { OpenCode } from "@opencode/client"
import { Database } from "@opencode/core/database/database"
import { KV } from "@opencode/core/kv"
import { storage } from "@opencode/core/plugin/host"
import { KiloMarketplaceRpc } from "@opencode/schema/kilocode/marketplace"
import { createRoutes } from "@opencode/server/routes"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Context, Effect, Layer, Option, References } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { mkdtemp, readdir, realpath, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { McpRegistry } from "../../kilo-plugin/src/marketplace/mcp-registry"
import { KiloHost } from "../src/host"
import { recordMessages, validateResponse } from "../src/marketplace/handlers/client"
import { resolveRegistry } from "../src/marketplace/handlers/install"
import { selectUninstall } from "../src/marketplace/handlers/uninstall"

test.each([[], { items: [] }, { items: [], failures: [undefined] }])(
  "rejects incompatible marketplace list responses with restart instructions: %j",
  async (response) => {
    await expect(validateResponse("list")(response)).rejects.toThrow("bun dev service restart")
  },
)

test("accepts empty marketplace lists and preserves registry warnings", async () => {
  expect(await validateResponse("list")({ items: [], failures: [] })).toEqual({ items: [], failures: [] })
  const response = { items: [], failures: [{ registry: "kilo", message: "Registry unavailable" }] }
  expect(await validateResponse("list")(response)).toEqual(response)
})

test.each([
  ["installed", [{ id: "demo" }]],
  ["registries", [{ id: "kilo" }]],
  ["registries.set", {}],
  ["install", { id: "demo" }],
  ["uninstall", null],
] as const)("rejects incompatible marketplace %s responses", async (method, value) => {
  await expect(validateResponse(method)(value)).rejects.toThrow("kilo service restart")
})

test("accepts compatible non-list responses", async () => {
  const record: KiloMarketplaceRpc.Installed = {
    registry: "kilo",
    kind: "skill",
    id: "demo",
    scope: "global",
    paths: [],
    installedAt: 1,
  }
  const registry: KiloMarketplaceRpc.RegistryInfo = {
    id: "kilo",
    name: "Kilo",
    description: "",
    kinds: ["skill"],
    curated: true,
    searchable: false,
    enabled: true,
  }
  expect(await validateResponse("installed")([record])).toEqual([record])
  expect(await validateResponse("install")(record)).toEqual(record)
  expect(await validateResponse("registries")([registry])).toEqual([registry])
  expect(await validateResponse("registries.set")([registry])).toEqual([registry])
  expect(await validateResponse("uninstall")({})).toEqual({})
})

test.each(["ready", "missing", "modified", "incomplete"] as const)(
  "validates and formats optional installed state: %s",
  async (status) => {
    const record: KiloMarketplaceRpc.Installed = {
      registry: "kilo",
      kind: "skill",
      id: "demo",
      scope: "project",
      paths: [],
      installedAt: 1,
      status,
      recovering: true,
      resources: [{ path: "/project/.kilo2/skills/demo", fingerprints: ["private-content-evidence"] }],
      pending: [{ config: "/project/obsolete.json", server: "demo" }],
      warnings: ["Obsolete config cleanup failed"],
    }
    expect(await validateResponse("install")(record)).toEqual(record)
    expect(await validateResponse("installed")([record])).toEqual([record])
    expect(recordMessages(record)).toEqual([
      `Status: ${status}`,
      "Warning: Installation is incomplete; reinstall to repair it.",
      "Warning: Obsolete config cleanup failed",
    ])
    expect(recordMessages(record).join("\n")).not.toContain("private-content-evidence")
    expect(recordMessages({ ...record, recovering: false, warnings: undefined })).toContain(
      "Warning: Pending cleanup: /project/obsolete.json (MCP server demo)",
    )
  },
)

test.each([
  { status: "unknown" },
  { recovering: "true" },
  { warnings: [1] },
  { resources: [{ path: "/demo", fingerprints: [1] }] },
  { pending: [{ config: "/demo" }] },
])("rejects malformed optional installed fields: %j", async (fields) => {
  const record = { registry: "kilo", kind: "skill", id: "demo", scope: "global", paths: [], installedAt: 1, ...fields }
  await expect(validateResponse("install")(record)).rejects.toThrow("kilo service restart")
  await expect(validateResponse("installed")([record])).rejects.toThrow("kilo service restart")
})

test("derives old-server pending cleanup warnings without exposing fingerprints", () => {
  expect(
    recordMessages({
      registry: "kilo",
      kind: "skill",
      id: "demo",
      scope: "global",
      paths: [],
      installedAt: 1,
      pending: [{ path: "/old/skill", fingerprints: ["secret"] }],
    }),
  ).toEqual(["Warning: Pending cleanup: /old/skill"])
})

test.each(["unique", "ambiguous", "missing", "partial", "partial-empty", "settings-failed"])(
  "implicit registry resolution diagnoses enabled sources: %s",
  async (scenario) => {
    const calls: string[] = []
    using server = Bun.serve({
      port: 0,
      fetch: async (request) => {
        const method = new URL(request.url).pathname.split("/").at(-1)!
        calls.push(method)
        if (method === "list") {
          expect((await request.json()).input).toEqual({ kind: "skill", query: "demo" })
          const registries =
            scenario === "missing" || scenario === "partial-empty"
              ? []
              : scenario === "ambiguous"
                ? ["kilo", "other"]
                : ["kilo"]
          return Response.json({
            output: {
              items: registries.map((registry) => ({
                registry,
                kind: "skill",
                id: "owner/demo",
                name: "Demo",
                description: "",
                tags: [],
                prerequisites: [],
                parameters: [],
                options: [],
              })),
              failures:
                scenario.startsWith("partial") || scenario === "settings-failed"
                  ? [{ registry: "offline", message: "Catalog unavailable" }]
                  : [],
            },
          })
        }
        if (method === "registries") {
          if (scenario === "settings-failed") return new Response("Settings unavailable", { status: 503 })
          return Response.json({
            output: [
              {
                id: "skills.sh",
                name: "Skills.sh",
                description: "",
                kinds: ["skill"],
                curated: false,
                searchable: true,
                enabled: false,
              },
              {
                id: "mcp-only",
                name: "MCP Only",
                description: "",
                kinds: ["mcp"],
                curated: false,
                searchable: true,
                enabled: false,
              },
            ],
          })
        }
        return new Response("Unexpected request", { status: 500 })
      },
    })
    const client = OpenCode.make({ baseUrl: server.url.origin })
    const location = { directory: "/project" }
    const result = resolveRegistry(
      { client, rpc: client.rpc(KiloMarketplaceRpc.Definition), location, options: { location } },
      "skill",
      "owner/demo",
    )
    if (scenario === "unique") {
      expect(await result).toBe("kilo")
      expect(calls).toEqual(["list"])
      return
    }
    const error = await result.catch((error: Error) => error)
    expect(error).toBeInstanceOf(Error)
    const message = error instanceof Error ? error.message : ""
    if (scenario.startsWith("partial") || scenario === "settings-failed") {
      expect(message).toContain("Discovery in enabled registries is incomplete")
      expect(message).toContain("offline: Catalog unavailable")
    }
    if (scenario === "missing" || scenario === "partial-empty") expect(message).toContain("enabled registries")
    if (scenario === "ambiguous") expect(message).toContain("kilo, other; pass --registry")
    if (scenario !== "settings-failed") {
      expect(message).toContain("Skills.sh (skills.sh) is disabled")
      expect(message).toContain("kilo marketplace registries --enable skills.sh")
      expect(message).not.toContain("MCP Only")
    }
    expect(calls).toEqual(["list", "registries"])
  },
)

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
            const obsolete = path.join(directory, "obsolete.json")
            await Bun.write(obsolete, "{ broken")
            await Effect.runPromise(
              store.set(
                `installed:kilo:mcp:demo-mcp:project:${directory}`,
                JSON.stringify({
                  ...server,
                  config: obsolete,
                  resources: server.resources?.map((resource) =>
                    "config" in resource ? { ...resource, config: obsolete } : resource,
                  ),
                }),
              ),
            )
            const reinstalled = await rpc.install({ ...mcp, params: { API_KEY: "replacement" } }, options)
            expect(reinstalled).toMatchObject({
              config,
              pending: [{ config: obsolete, server: "demo-mcp", fingerprints: expect.any(Array) }],
            })
            expect(await rpc.installed({}, options)).toContainEqual(reinstalled)
            expect((await Bun.file(config).json()).mcp.servers["demo-mcp"].environment.API_KEY).toBe("replacement")
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

            const selected = selectUninstall(await rpc.installed({}, options), {
              kind: "skill",
              id: "demo",
              project: false,
              global: false,
              registry: Option.none(),
            })
            expect(selected.scope).toBe("project")
            expect(
              await rpc.uninstall(
                { registry: selected.registry, kind: selected.kind, id: selected.id, scope: selected.scope },
                options,
              ),
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
