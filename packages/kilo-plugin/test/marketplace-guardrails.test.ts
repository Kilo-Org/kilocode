import { expect } from "bun:test"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { Rpc } from "@opencode/core/rpc"
import { KiloMarketplaceRpc } from "@opencode/schema/kilocode/marketplace"
import { KiloMcpGuardrailsRpc } from "@opencode/schema/kilocode/mcp-guardrails"
import { Global } from "@opencode/util/global"
import { Effect, Schema } from "effect"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { withEnv } from "../../core/test/fixture/env"
import { testEffect } from "../../core/test/lib/effect"
import { PluginTestLayer } from "../../core/test/plugin/fixture"
import { KiloMarketplacePlugin } from "../src/marketplace"

const it = testEffect(PluginTestLayer)
const decode = Schema.decodeUnknownSync(KiloMarketplaceRpc.Installed)
const decodeCatalog = Schema.decodeUnknownSync(Schema.Struct({ items: Schema.Array(KiloMarketplaceRpc.Item) }))
const decodePreview = Schema.decodeUnknownSync(Schema.Struct({ server: Schema.String }))
const allowedUrl = "https://allowed.example.com/mcp"

const items = [
  { id: "allowed", name: "Allowed", content: JSON.stringify({ url: allowedUrl }) },
  { id: "denied", name: "Denied", content: JSON.stringify({ url: "https://denied.example.com/mcp" }) },
  {
    id: "mixed",
    name: "Mixed",
    content: [
      { name: "Denied local", content: JSON.stringify({ command: "npx", args: ["-y", "@acme/denied"] }) },
      { name: "Remote", content: JSON.stringify({ url: allowedUrl }) },
    ],
  },
  {
    id: "templated",
    name: "Templated",
    parameters: [{ key: "tenant", name: "Tenant" }],
    content: JSON.stringify({ url: "https://{{tenant}}.example.com/mcp" }),
  },
  { id: "unreadable", name: "Unreadable", content: "not json at all" },
]

const fixture = Effect.fn(function* (enforcement: KiloMcpGuardrailsRpc.Enforcement | "missing") {
  const directory = yield* Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "kilo-marketplace-guardrails-")))
  yield* Effect.addFinalizer(() => Effect.promise(() => fs.rm(directory, { recursive: true, force: true })))
  const server = Bun.serve({
    port: 0,
    fetch: (request) =>
      new Response(
        Bun.YAML.stringify({ items: new URL(request.url).pathname.endsWith("/skills") ? [{ id: "guide", content: "x" }] : items }),
      ),
  })
  yield* Effect.addFinalizer(() => Effect.sync(() => server.stop(true)))
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin)
  const rpc = yield* Rpc.Service
  // The guardrails plugin answers from its cached policy; this stand-in allows exactly one remote URL.
  if (enforcement !== "missing")
    yield* host.rpc.register(KiloMcpGuardrailsRpc.Definition, {
      evaluate: (input) =>
        Effect.succeed({
          enforcement,
          results: input.servers.map((entry) =>
            enforcement === "off" || (entry.type === "remote" && entry.url === allowedUrl)
              ? { decision: "allowed" as const }
              : { decision: "denied" as const, reason: "not_allowed" as const },
          ),
        }),
    })
  yield* withEnv({ KILO_API_URL: server.url.origin }, () =>
    KiloMarketplacePlugin.effect(host).pipe(Effect.provide(Global.layerWith({ config: directory }))),
  )
  return { directory, rpc }
})

const list = (rpc: Rpc.Interface, kind: "mcp" | "skill" = "mcp", query?: string) =>
  rpc
    .call("kilocode.marketplace", "list", query === undefined ? { kind } : { kind, query })
    .pipe(Effect.map(decodeCatalog))

it.live("offers only the allowed install options while the organization enforces an allow list", () =>
  Effect.gen(function* () {
    const test = yield* fixture("enforce")
    const result = yield* list(test.rpc)
    expect(result.items.map((item) => item.id)).toEqual(["allowed", "mixed"])
    expect(result.items.find((item) => item.id === "mixed")?.options.map((option) => option.name)).toEqual(["Remote"])
  }),
)

it.live("offers everything while the allow list is only audited, off, or unreachable", () =>
  Effect.gen(function* () {
    for (const mode of ["shadow", "off", "missing"] as const) {
      const test = yield* fixture(mode)
      const result = yield* list(test.rpc)
      expect(result.items.map((item) => item.id)).toEqual(["allowed", "denied", "mixed", "templated", "unreadable"])
      expect(result.items.find((item) => item.id === "mixed")?.options).toHaveLength(2)
    }
  }),
)

it.live("never filters skills", () =>
  Effect.gen(function* () {
    const test = yield* fixture("enforce")
    expect((yield* list(test.rpc, "skill")).items.map((item) => item.id)).toEqual(["guide"])
  }),
)

it.live("searches only what the organization allows", () =>
  Effect.gen(function* () {
    const test = yield* fixture("enforce")
    const search = (query: string) => list(test.rpc, "mcp", query)
    expect((yield* search("denied")).items).toEqual([])
    const mixed = (yield* search("mixed")).items
    expect(mixed.map((item) => item.id)).toEqual(["mixed"])
    expect(mixed[0]?.options.map((option) => option.name)).toEqual(["Remote"])
  }),
)

it.live("refuses to preview or install a server the allow list does not name", () =>
  Effect.gen(function* () {
    const test = yield* fixture("enforce")
    for (const id of ["denied", "templated", "unreadable"]) {
      const input = { registry: "kilo", kind: "mcp", id, scope: "global" } as const
      for (const method of ["preview", "install"] as const) {
        expect(yield* test.rpc.call("kilocode.marketplace", method, input).pipe(Effect.flip)).toMatchObject({
          type: "unsupported",
          message: expect.stringContaining("not on your organization's MCP allowlist"),
        })
      }
    }
    expect(yield* Effect.promise(() => Bun.file(path.join(test.directory, "kilo2.json")).exists())).toBe(false)
  }),
)

it.live("refuses a denied option of a server that offers an allowed one", () =>
  Effect.gen(function* () {
    const test = yield* fixture("enforce")
    const input = { registry: "kilo", kind: "mcp", id: "mixed", scope: "global", option: "Denied local" } as const
    expect(yield* test.rpc.call("kilocode.marketplace", "install", input).pipe(Effect.flip)).toMatchObject({
      type: "unsupported",
    })
    const preview = decodePreview(
      yield* test.rpc.call("kilocode.marketplace", "preview", { ...input, option: "Remote" }),
    )
    expect(preview.server).toContain(allowedUrl)
  }),
)

it.live("installs the first allowed option when none is chosen", () =>
  Effect.gen(function* () {
    const test = yield* fixture("enforce")
    const installed = decode(
      yield* test.rpc.call("kilocode.marketplace", "install", {
        registry: "kilo",
        kind: "mcp",
        id: "mixed",
        scope: "global",
      }),
    )
    expect(installed.server).toBe("mixed")
    expect(yield* Effect.promise(() => Bun.file(path.join(test.directory, "kilo2.json")).text())).toContain(allowedUrl)
  }),
)

it.live("installs an allowed server and, with no allow list, any server", () =>
  Effect.gen(function* () {
    const enforced = yield* fixture("enforce")
    const allowed = { registry: "kilo", kind: "mcp", id: "allowed", scope: "global" } as const
    expect(decode(yield* enforced.rpc.call("kilocode.marketplace", "install", allowed)).server).toBe("allowed")

    const open = yield* fixture("off")
    const denied = { registry: "kilo", kind: "mcp", id: "denied", scope: "global" } as const
    expect(decode(yield* open.rpc.call("kilocode.marketplace", "install", denied)).server).toBe("denied")
  }),
)
