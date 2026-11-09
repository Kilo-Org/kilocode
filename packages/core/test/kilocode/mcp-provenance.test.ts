import { expect } from "bun:test"
import { InMemoryTransport } from "@modelcontextprotocol/client"
import { McpServer } from "@modelcontextprotocol/server"
import { Bus } from "@opencode/core/bus"
import { Credential } from "@opencode/core/credential"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Environment } from "@opencode/core/environment/index"
import { Image } from "@opencode/core/image"
import { Integration } from "@opencode/core/integration"
import { Location } from "@opencode/core/location"
import { Mcp } from "@opencode/core/mcp/index"
import { Permission } from "@opencode/core/permission"
import { Tool } from "@opencode/core/tool"
import { McpTool } from "@opencode/core/tool/mcp"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Effect, Layer, Schedule } from "effect"
import { hostEnvironmentLayer } from "../fixture/environment"
import { tempLocationLayer } from "../fixture/location"
import { testEffect } from "../lib/effect"
import { imagePassthrough } from "../lib/image"

const unused = () => Effect.die("unused integration service")

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Tool.node, McpTool.node, Mcp.node, Bus.node]), [
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
    Permission.node.replace(Layer.mock(Permission.Service, { assert: () => Effect.void })),
    Image.node.replace(imagePassthrough),
  ]),
)

// The sandbox plugin tells MCP tools from namespaced built-ins by this mark. A server named `opencode` with a tool
// named `read` has the same namespace and declared name as a built-in, so only the mark separates them.
it.live("marks the tools of an MCP server named opencode as MCP", () =>
  Effect.gen(function* () {
    const server = new McpServer({ name: "opencode", version: "1.0.0" })
    server.registerTool("read", { description: "read" }, () => ({ content: [{ type: "text", text: "read" }] }))
    const [client, transport] = InMemoryTransport.createLinkedPair()
    yield* Effect.acquireRelease(
      Effect.promise(() => server.connect(transport)),
      () => Effect.promise(() => server.close()),
    )
    const mcp = yield* Mcp.Service
    const registry = yield* Tool.Service
    const registration = yield* McpTool.Service
    yield* mcp.attach("opencode", client)

    const entry = yield* Effect.gen(function* () {
      yield* registration.flush
      const found = (yield* registry.list()).find((tool) => tool.id === "opencode_read")
      if (!found) return yield* Effect.fail("pending")
      return found
    }).pipe(Effect.retry({ times: 500, schedule: Schedule.spaced("2 millis") }))

    expect(entry.name).toBe("read")
    expect(entry.options).toMatchObject({ namespace: "opencode", mcp: true })
  }),
)
