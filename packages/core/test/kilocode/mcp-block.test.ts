import { expect } from "bun:test"
import { ConfigMCP } from "@opencode/schema/config/mcp"
import { Bus } from "@opencode/core/bus"
import { Credential } from "@opencode/core/credential"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Environment } from "@opencode/core/environment/index"
import { Integration } from "@opencode/core/integration"
import { Location } from "@opencode/core/location"
import { Mcp } from "@opencode/core/mcp/index"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Effect, Layer, Schedule } from "effect"
import { hostEnvironmentLayer } from "../fixture/environment"
import { tempLocationLayer } from "../fixture/location"
import { testEffect } from "../lib/effect"

const unused = () => Effect.die("unused integration service")

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Mcp.node, Bus.node]), [
    Location.node.replace(tempLocationLayer),
    Environment.node.replace(hostEnvironmentLayer),
    Integration.node.replace(
      Layer.mock(Integration.Service, {
        revision: () => 0,
        connection: {
          active: unused,
          resolve: unused,
          key: unused,
          external: unused,
          activate: unused,
          update: unused,
          remove: unused,
          status: unused,
        },
        oauth: { connect: unused, status: unused, complete: unused, cancel: unused },
        command: { connect: unused, status: unused, cancel: unused },
      }),
    ),
    Credential.node.replace(Layer.mock(Credential.Service, {})),
  ]),
)

// Counts how often a client reaches the server, so "never starts" is observed instead of inferred from status.
const endpoint = Effect.acquireRelease(
  Effect.sync(() => {
    const hits = { count: 0 }
    const server = Bun.serve({
      port: 0,
      fetch() {
        hits.count++
        return new Response("unavailable", { status: 500 })
      },
    })
    return { hits, server, url: server.url.href }
  }),
  (endpoint) => Effect.sync(() => endpoint.server.stop(true)),
)

const remote = (url: string) => new ConfigMCP.Remote({ type: "remote", url, oauth: false })

const status = (mcp: Mcp.Interface, name: string) =>
  mcp.servers().pipe(Effect.map((servers) => servers.find((server) => server.name === name)?.status))

const eventually = <A, E, R>(effect: Effect.Effect<A, E, R>, done: (value: A) => boolean) =>
  effect.pipe(
    Effect.flatMap((value) => (done(value) ? Effect.succeed(value) : Effect.fail("pending" as const))),
    Effect.retry({ times: 500, schedule: Schedule.spaced("10 millis") }),
  )

it.live("lists a blocked server with its reason and never starts it", () =>
  Effect.gen(function* () {
    const mcp = yield* Mcp.Service
    const target = yield* endpoint
    yield* mcp.transform((editor) => editor.block?.("guarded", "not on the allowlist"))
    yield* mcp.add("guarded", remote(target.url))

    expect(yield* status(mcp, "guarded")).toEqual({ status: "blocked", reason: "not on the allowlist" })
    expect(yield* mcp.tools()).toEqual([])
    const failure = yield* mcp.callTool({ server: "guarded", name: "any" }).pipe(Effect.flip)
    expect(failure).toBeInstanceOf(Mcp.ToolCallError)
    expect(failure.message).toContain("is blocked: not on the allowlist")
    yield* Effect.sleep("50 millis")
    expect(target.hits.count).toBe(0)
  }),
)

it.live("refuses to connect or disconnect a blocked server", () =>
  Effect.gen(function* () {
    const mcp = yield* Mcp.Service
    const target = yield* endpoint
    yield* mcp.transform((editor) => editor.block?.("guarded", "not on the allowlist"))
    yield* mcp.add("guarded", remote(target.url))

    yield* mcp.connect("guarded")
    expect(yield* status(mcp, "guarded")).toEqual({ status: "blocked", reason: "not on the allowlist" })
    yield* mcp.disconnect("guarded")
    expect(yield* status(mcp, "guarded")).toEqual({ status: "blocked", reason: "not on the allowlist" })
    yield* Effect.sleep("50 millis")
    expect(target.hits.count).toBe(0)
  }),
)

it.live("blocks a server added later without touching the others", () =>
  Effect.gen(function* () {
    const mcp = yield* Mcp.Service
    const target = yield* endpoint
    const allowed = new Set(["first"])
    yield* mcp.transform((editor) => {
      for (const [name] of editor.list()) if (!allowed.has(name)) editor.block?.(name, "not on the allowlist")
    })
    yield* mcp.add("first", remote(target.url))
    yield* eventually(status(mcp, "first"), (value) => value?.status === "failed")
    const hits = target.hits.count
    expect(hits).toBeGreaterThan(0)

    yield* mcp.add("second", remote(target.url))
    expect(yield* status(mcp, "second")).toEqual({ status: "blocked", reason: "not on the allowlist" })
    yield* Effect.sleep("50 millis")
    expect((yield* status(mcp, "first"))?.status).toBe("failed")
    expect(target.hits.count).toBe(hits)
  }),
)

it.live("stops a running server when it becomes blocked and starts it again when it is not", () =>
  Effect.gen(function* () {
    const mcp = yield* Mcp.Service
    const target = yield* endpoint
    const blocked = { value: false }
    yield* mcp.transform((editor) => {
      if (blocked.value) editor.block?.("guarded", "not on the allowlist")
    })
    yield* mcp.add("guarded", remote(target.url))
    yield* eventually(status(mcp, "guarded"), (value) => value?.status === "failed")

    blocked.value = true
    yield* mcp.reload()
    expect(yield* status(mcp, "guarded")).toEqual({ status: "blocked", reason: "not on the allowlist" })
    const hits = target.hits.count
    yield* Effect.sleep("50 millis")
    expect(target.hits.count).toBe(hits)

    blocked.value = false
    yield* mcp.reload()
    yield* eventually(status(mcp, "guarded"), (value) => value?.status === "failed")
    expect(target.hits.count).toBeGreaterThan(hits)
  }),
)

it.live("reports a blocked server whose config did not change", () =>
  Effect.gen(function* () {
    const mcp = yield* Mcp.Service
    const target = yield* endpoint
    const reason = { value: "first reason" }
    yield* mcp.transform((editor) => editor.block?.("guarded", reason.value))
    yield* mcp.add("guarded", remote(target.url))
    expect(yield* status(mcp, "guarded")).toEqual({ status: "blocked", reason: "first reason" })

    reason.value = "second reason"
    yield* mcp.reload()
    expect(yield* status(mcp, "guarded")).toEqual({ status: "blocked", reason: "second reason" })
    expect(target.hits.count).toBe(0)
  }),
)
