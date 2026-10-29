import { expect } from "bun:test"
import { fixture } from "@kilocode/gateway-core/testing"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import type { MCPEditor } from "@opencode/plugin/effect/mcp"
import { KiloGatewayRpc } from "@opencode/schema/kilocode/gateway"
import { KiloMcpGuardrailsRpc } from "@opencode/schema/kilocode/mcp-guardrails"
import { Mcp } from "@opencode/schema/mcp"
import { Global } from "@opencode/util/global"
import { Effect, Layer, Schedule, Schema } from "effect"
import { TestClock } from "effect/testing"
import { withEnv } from "../../core/test/fixture/env"
import { testEffect } from "../../core/test/lib/effect"
import { PluginTestLayer } from "../../core/test/plugin/fixture"
import { KiloGatewayPlugin } from "../src/gateway"
import { KiloMcpGuardrailsPlugin } from "../src/mcp-guardrails"

type Host = Effect.Success<ReturnType<typeof PluginHost.make>>

const it = testEffect(Layer.mergeAll(PluginTestLayer, Global.layerWith({})))
const decode = Schema.decodeUnknownSync(Mcp.ServerConfig)

const allowedRemote = "https://allowed.example.com/mcp"
const remote = (url: string, extra: object = {}) => decode({ type: "remote", url, oauth: false, ...extra })
const local = (...command: string[]) => decode({ type: "local", command })

const entries = {
  remote: (url: string) => ({
    identityKey: `remote:${url}`,
    name: url,
    description: null,
    config: { kind: "remote", url },
  }),
  npm: (identifier: string, min_version: string | null = null) => ({
    identityKey: `npm:${identifier}`,
    name: identifier,
    description: null,
    config: { kind: "package", ecosystem: "npm", identifier, min_version },
  }),
}

const policy = (enforcement: "off" | "shadow" | "enforce", allowedServers = [entries.remote(allowedRemote), entries.npm("@acme/ok", "2.0.0")]) => ({
  mcp: { enforcement, allowedServers },
})

// `KILO_ORG_ID` pins the organization, so a test that switches organizations starts without it.
function team<A, E, R>(
  body: (backend: ReturnType<typeof fixture>) => Effect.Effect<A, E, R>,
  organization: string | null = "selected",
) {
  return Effect.acquireUseRelease(
    Effect.sync(() => fixture()),
    (backend) =>
      withEnv(
        {
          KILO_API_URL: backend.url,
          KILO_AI_GATEWAY_URL: undefined,
          KILO_API_KEY: "fixture-token",
          KILOCODE_TOKEN: undefined,
          KILO_AUTH_CONTENT: undefined,
          KILO_ORG_ID: organization ?? undefined,
          KILO_DATA_COLLECTION: undefined,
        },
        () => body(backend),
      ),
    (backend) => Effect.sync(() => backend[Symbol.dispose]()),
  )
}

// Starts the guardrails plugin the way the host does and captures what it asks of the MCP service.
const start = Effect.fn(function* (existing?: Host) {
  const plugins = yield* Plugin.Service
  const host = existing ?? (yield* PluginHost.make(plugins))
  if (!existing) yield* KiloGatewayPlugin.effect(host)
  const transforms: ((editor: MCPEditor) => void)[] = []
  const state = { reloads: 0 }
  const context = {
    ...host,
    mcp: {
      ...host.mcp,
      transform: (callback: (editor: MCPEditor) => void) =>
        Effect.sync(() => {
          transforms.push(callback)
          return { dispose: Effect.void }
        }),
      reload: () =>
        Effect.sync(() => {
          state.reloads++
        }),
    },
  }
  yield* KiloMcpGuardrailsPlugin.effect(context)
  const apply = (servers: Record<string, Mcp.ServerConfig>, canBlock = true) => {
    const blocked = new Map<string, string>()
    const removed = new Set<string>()
    const editor: MCPEditor = {
      list: () => Object.entries(servers) as never,
      get: (name) => servers[name] as never,
      set: () => {},
      update: () => {},
      remove: (name) => void removed.add(name),
      ...(canBlock ? { block: (name: string, reason: string) => void blocked.set(name, reason) } : {}),
    }
    for (const transform of transforms) transform(editor)
    return { blocked, removed }
  }
  return { host, state, apply, guardrails: host.rpc(KiloMcpGuardrailsRpc.Definition), gateway: host.rpc(KiloGatewayRpc.Definition) }
})

const eventually = <A>(read: () => A, ready: (value: A) => boolean) =>
  Effect.suspend(() => (ready(read()) ? Effect.succeed(read()) : Effect.fail("pending" as const))).pipe(
    Effect.retry({ times: 500, schedule: Schedule.spaced("10 millis") }),
  )

const servers = {
  allowed: remote(allowedRemote),
  denied: remote("https://denied.example.com/mcp"),
  pinned: local("npx", "-y", "@acme/ok@2.1.0"),
  old: local("npx", "-y", "@acme/ok@1.0.0"),
  binary: local("./server"),
  insecure: remote("http://allowed.example.com/mcp"),
  disabled: remote("https://disabled.example.com/mcp", { disabled: true }),
}

const connections = (backend: ReturnType<typeof fixture>, batch = 0) =>
  (backend.state.connectionBodies[batch] as { client: string; connections: { serverName: string }[] }).connections.map(
    (connection) => connection.serverName,
  )

it.live("blocks every server the allow list does not name and reports the others", () =>
  team((backend) =>
    Effect.gen(function* () {
      backend.state.guardrails = policy("enforce")
      const guard = yield* start()
      yield* eventually(() => guard.state.reloads, (reloads) => reloads > 0)

      const { blocked, removed } = guard.apply(servers)
      expect([...blocked.keys()].toSorted()).toEqual(["binary", "denied", "disabled", "insecure", "old"])
      expect(removed.size).toBe(0)
      expect(blocked.get("denied")).toBe("Not on your organization's MCP allowlist")
      expect(blocked.get("old")).toBe("Below the minimum version your organization requires (2.0.0)")
      expect(blocked.get("binary")).toContain("can be on your organization's MCP allowlist")

      yield* eventually(() => backend.state.connectionBodies.length, (count) => count > 0)
      // A server that can never be allowlisted or never connects is not reported.
      expect(connections(backend).toSorted()).toEqual(["allowed", "denied", "old", "pinned"])
      expect(backend.state.connectionBodies[0]).toMatchObject({ client: "cli" })
      expect(backend.state.connectionBodies).toHaveLength(1)

      guard.apply(servers)
      yield* Effect.sleep("700 millis")
      expect(backend.state.connectionBodies).toHaveLength(1)
    }),
  ),
)

it.live("reports a denied server without blocking it while the allow list is only audited", () =>
  team((backend) =>
    Effect.gen(function* () {
      backend.state.guardrails = policy("shadow")
      const guard = yield* start()
      yield* eventually(() => guard.state.reloads, (reloads) => reloads > 0)

      const { blocked, removed } = guard.apply(servers)
      expect(blocked.size).toBe(0)
      expect(removed.size).toBe(0)
      yield* eventually(() => backend.state.connectionBodies.length, (count) => count > 0)
      expect(connections(backend)).toContain("denied")
    }),
  ),
)

it.live("blocks and reports nothing without a policy or while enforcement is off", () =>
  team((backend) =>
    Effect.gen(function* () {
      backend.state.guardrails = policy("off")
      const guard = yield* start()
      yield* eventually(() => backend.requests.filter((request) => request.path.endsWith("/guardrails")).length, (n) => n > 0)

      expect(guard.apply(servers).blocked.size).toBe(0)
      yield* Effect.sleep("700 millis")
      expect(backend.state.connectionBodies).toHaveLength(0)
      expect(yield* guard.guardrails.evaluate({ servers: [{ type: "remote", url: "https://denied.example.com/mcp" }] })).toEqual({
        enforcement: "off",
        results: [{ decision: "allowed" }],
      })
    }),
  ),
)

it.live("treats a missing organization as no policy", () =>
  team((backend) =>
    Effect.gen(function* () {
      backend.state.guardrailsStatus = 404
      const guard = yield* start()
      yield* eventually(() => backend.requests.filter((request) => request.path.endsWith("/guardrails")).length, (n) => n > 0)
      expect(guard.apply(servers).blocked.size).toBe(0)
    }),
  ),
)

it.live("removes a denied server when the host cannot list blocked ones", () =>
  team((backend) =>
    Effect.gen(function* () {
      backend.state.guardrails = policy("enforce")
      const guard = yield* start()
      yield* eventually(() => guard.state.reloads, (reloads) => reloads > 0)
      const { blocked, removed } = guard.apply({ allowed: servers.allowed, denied: servers.denied }, false)
      expect(blocked.size).toBe(0)
      expect([...removed]).toEqual(["denied"])
    }),
  ),
)

it.live("answers marketplace questions from the same policy", () =>
  team((backend) =>
    Effect.gen(function* () {
      backend.state.guardrails = policy("enforce")
      const guard = yield* start()
      yield* eventually(() => guard.state.reloads, (reloads) => reloads > 0)
      expect(
        yield* guard.guardrails.evaluate({
          servers: [
            { type: "remote", url: allowedRemote },
            { type: "remote", url: "https://denied.example.com/mcp" },
            { type: "local", command: ["npx", "-y", "@acme/ok@1.0.0"] },
            { type: "local", command: [] },
          ],
        }),
      ).toEqual({
        enforcement: "enforce",
        results: [
          { decision: "allowed" },
          { decision: "denied", reason: "not_allowed" },
          { decision: "denied", reason: "below_min_version" },
          { decision: "denied", reason: "unsupported_target" },
        ],
      })
    }),
  ),
)

it.live("enforces the stored policy on a restart before the network answers, and keeps it when a refresh fails", () =>
  team((backend) =>
    Effect.gen(function* () {
      backend.state.guardrails = policy("enforce")
      const first = yield* start()
      yield* eventually(() => first.state.reloads, (reloads) => reloads > 0)

      backend.state.guardrailsStatus = 500
      const requests = backend.requests.length
      const restarted = yield* start(first.host)
      // The stored policy is loaded before the transform registers, so servers are guarded from the first pass.
      expect([...restarted.apply(servers).blocked.keys()]).toContain("denied")
      yield* eventually(() => backend.requests.length, (count) => count > requests)
      yield* Effect.sleep("100 millis")
      expect([...restarted.apply(servers).blocked.keys()]).toContain("denied")
    }),
  ),
)

it.live("drops the policy of an organization the account switched away from, even when the new fetch fails", () =>
  team((backend) =>
    Effect.gen(function* () {
      backend.state.guardrails = policy("enforce")
      const guard = yield* start()
      expect(guard.apply(servers).blocked.size).toBe(0)

      yield* guard.gateway["organization.set"]({ organizationID: "selected" })
      yield* eventually(() => guard.apply(servers).blocked.has("denied"), (blocked) => blocked)

      const reloads = guard.state.reloads
      backend.state.guardrailsStatus = 500
      yield* guard.gateway["organization.set"]({ organizationID: "first" })
      yield* eventually(() => guard.state.reloads, (count) => count > reloads)
      expect(guard.apply(servers).blocked.size).toBe(0)
    }),
    null,
  ),
)

it.live("applies the new organization's policy after a switch and has none for a personal account", () =>
  team((backend) =>
    Effect.gen(function* () {
      backend.state.guardrails = policy("enforce")
      const guard = yield* start()
      expect(guard.apply(servers).blocked.size).toBe(0)
      expect(backend.requests.some((request) => request.path.endsWith("/guardrails"))).toBe(false)

      yield* guard.gateway["organization.set"]({ organizationID: "first" })
      yield* eventually(() => guard.apply(servers).blocked.has("denied"), (blocked) => blocked)
      expect(backend.requests.some((request) => request.path === "/api/organizations/first/guardrails")).toBe(true)

      yield* guard.gateway["organization.set"]({ organizationID: null })
      yield* eventually(() => guard.apply(servers).blocked.size, (size) => size === 0)
    }),
    null,
  ),
)

it.effect("refreshes every ten minutes and offers an unreported connection again", () =>
  team((backend) =>
    Effect.gen(function* () {
      const guardrails = () => backend.requests.filter((request) => request.path.endsWith("/guardrails")).length
      // The test clock only moves when adjusted, so waiting for the fixture's real I/O polls with real sleeps.
      const settle = (ready: () => boolean, attempts = 500): Effect.Effect<void, "pending"> =>
        Effect.suspend(() => {
          if (ready()) return Effect.void
          if (attempts === 0) return Effect.fail("pending" as const)
          return Effect.promise(() => Bun.sleep(10)).pipe(Effect.andThen(settle(ready, attempts - 1)))
        })
      backend.state.guardrails = policy("off")
      backend.state.connectionsStatus = 500
      const guard = yield* start()
      yield* settle(() => guardrails() === 1)

      // Nothing refreshes before the interval.
      yield* TestClock.adjust("9 minutes")
      yield* Effect.promise(() => Bun.sleep(50))
      expect(guardrails()).toBe(1)

      backend.state.guardrails = policy("enforce")
      yield* TestClock.adjust("1 minute")
      yield* settle(() => guardrails() === 2)
      yield* settle(() => guard.state.reloads > 0)
      expect(guard.apply(servers).blocked.has("denied")).toBe(true)

      // The report that failed is offered again once a refresh has succeeded.
      yield* TestClock.adjust("1 second")
      yield* settle(() => backend.state.connectionBodies.length === 1)
      backend.state.connectionsStatus = 200
      const reloads = guard.state.reloads
      yield* TestClock.adjust("10 minutes")
      yield* settle(() => guard.state.reloads > reloads)
      guard.apply(servers)
      yield* TestClock.adjust("1 second")
      yield* settle(() => backend.state.connectionBodies.length === 2)
    }),
  ),
)
