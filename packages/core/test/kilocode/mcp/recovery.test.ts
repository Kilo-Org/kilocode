import { expect } from "bun:test"
import { ConfigMCP } from "@opencode/schema/config/mcp"
import { ID, type Payload } from "@opencode/schema/event"
import { Bus } from "@opencode/core/bus"
import { Credential } from "@opencode/core/credential"
import { Form } from "@opencode/core/form"
import { Integration } from "@opencode/core/integration"
import { KiloMcpRecovery } from "@opencode/core/kilocode/mcp/recovery"
import { Location } from "@opencode/core/location"
import { Mcp } from "@opencode/core/mcp/index"
import { McpPool } from "@opencode/core/mcp/pool"
import { AbsolutePath } from "@opencode/core/schema"
import { CrossSpawnSpawner } from "@opencode/util/cross-spawn-spawner"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Effect, Layer, PubSub, Schedule, Stream } from "effect"
import { hostEnvironmentLayer } from "../../fixture/environment"
import { location } from "../../fixture/location"
import { echoMcpHandler } from "../../fixture/mcp-echo"
import { testEffect } from "../../lib/effect"

// Publishes in memory so the recovery loop sees the MCP service's status changes, as on the real Bus.
const bus = Layer.effect(
  Bus.Service,
  Effect.gen(function* () {
    const events = yield* PubSub.unbounded<Payload>()
    return Bus.Service.of({
      publish: (definition, data) =>
        Effect.gen(function* () {
          const event = { id: ID.create(), type: definition.type, data } as Payload<typeof definition>
          yield* PubSub.publish(events, event)
          return event
        }),
      subscribe: ((definition?: { readonly type: string }) =>
        Stream.fromPubSub(events).pipe(
          Stream.filter((event) => !definition || event.type === definition.type),
        )) as Bus.Interface["subscribe"],
    } as Bus.Interface)
  }),
)

const unused = () => Effect.die("unused integration service")

const mcpLayer = KiloMcpRecovery.layer(Mcp.layer()).pipe(
  Layer.provide(
    Layer.mergeAll(
      bus,
      McpPool.layer.pipe(Layer.provide(LayerNode.compile(CrossSpawnSpawner.node))),
      Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(import.meta.dir) }))),
      Layer.mock(Form.Service, {}),
      // `oauth: false` servers never register an integration or read a credential.
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
      Layer.mock(Credential.Service, {}),
      hostEnvironmentLayer,
    ),
  ),
)

const it = testEffect(Layer.empty)

// A port nothing listens on yet: a connect is refused, as when DNS or the network is down.
const reservePort = () => {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() })
  const port = server.port
  server.stop(true)
  return port
}

const status = (mcp: Mcp.Interface, expected: Mcp.Status["status"], times = 100) =>
  mcp.servers().pipe(
    Effect.map((servers) => servers.find((server) => server.name === "remote")?.status.status),
    Effect.filterOrFail(
      (current) => current === expected,
      (current) => new Error(`expected ${expected}, got ${current}`),
    ),
    Effect.retry({ times, schedule: Schedule.spaced("50 millis") }),
  )

it.live("reconnects a remote server that failed once the endpoint is reachable", () =>
  Effect.gen(function* () {
    const port = reservePort()
    const mcp = yield* Mcp.Service
    yield* mcp.add(
      "remote",
      new ConfigMCP.Remote({ type: "remote", url: `http://127.0.0.1:${port}/mcp`, oauth: false }),
    )
    yield* status(mcp, "failed")

    const handler = echoMcpHandler()
    const server = Bun.serve({ hostname: "127.0.0.1", port, fetch: (request) => handler.fetch(request) })
    yield* Effect.addFinalizer(() => Effect.promise(() => server.stop(true)))

    yield* status(mcp, "connected")
    expect((yield* mcp.tools()).map((tool) => tool.name)).toEqual(["echo"])
  }).pipe(Effect.provide(mcpLayer)),
)

it.live("stops retrying a server the user disconnected", () =>
  Effect.gen(function* () {
    const port = reservePort()
    const mcp = yield* Mcp.Service
    yield* mcp.add(
      "remote",
      new ConfigMCP.Remote({ type: "remote", url: `http://127.0.0.1:${port}/mcp`, oauth: false }),
    )
    yield* status(mcp, "failed")
    yield* mcp.disconnect("remote")

    let requests = 0
    const handler = echoMcpHandler()
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port,
      fetch: (request) => {
        requests += 1
        return handler.fetch(request)
      },
    })
    yield* Effect.addFinalizer(() => Effect.promise(() => server.stop(true)))

    yield* Effect.sleep(KiloMcpRecovery.BASE_DELAY_MS * 2)
    yield* status(mcp, "disabled", 0)
    expect(requests).toBe(0)
  }).pipe(Effect.provide(mcpLayer)),
)
