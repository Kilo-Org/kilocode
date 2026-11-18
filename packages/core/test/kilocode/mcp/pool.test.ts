import { expect } from "bun:test"
import { mkdir, readFile, symlink } from "node:fs/promises"
import path from "node:path"
import { Bus } from "@opencode/core/bus"
import { Credential } from "@opencode/core/credential"
import { Environment } from "@opencode/core/environment/index"
import { Form } from "@opencode/core/form"
import { Integration } from "@opencode/core/integration"
import { KiloMcpRecovery } from "@opencode/core/kilocode/mcp/recovery"
import { Location } from "@opencode/core/location"
import { Mcp } from "@opencode/core/mcp/index"
import { McpPool } from "@opencode/core/mcp/pool"
import { AbsolutePath } from "@opencode/core/schema"
import { ConfigMCP } from "@opencode/schema/config/mcp"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Context, Effect, Layer, Stream } from "effect"
import { hostEnvironmentLayer } from "../../fixture/environment"
import { location } from "../../fixture/location"
import { tmpdirScoped } from "../../fixture/tmpdir"
import { it } from "../../lib/effect"

const unused = () => Effect.die("unexpected integration call from local MCP")

const open = (directory: string, pool: McpPool.Interface) =>
  Layer.build(
    LayerNode.compile(KiloMcpRecovery.configured(), {
      replacements: [
        Location.node.replace(Layer.succeed(Location.Service, location({ directory: AbsolutePath.make(directory) }))),
        McpPool.node.replace(Layer.succeed(McpPool.Service, pool)),
        Environment.node.replace(hostEnvironmentLayer),
        Bus.node.replace(
          Layer.mock(Bus.Service, { publish: () => Effect.void as never, subscribe: () => Stream.empty }),
        ),
        Form.node.replace(Layer.mock(Form.Service, {})),
        Credential.node.replace(Layer.mock(Credential.Service, {})),
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
      ],
    }),
  ).pipe(Effect.map((context) => Context.get(context, Mcp.Service)))

it.live(
  "pooled local MCP answers through both checkout aliases but starts a separate process for another directory",
  () =>
    Effect.gen(function* () {
      const { path: root } = yield* tmpdirScoped()
      const repo = path.join(root, "repo")
      const alias = path.join(root, "alias")
      const other = path.join(root, "other")
      yield* Effect.promise(async () => {
        await mkdir(repo)
        await mkdir(other)
        await symlink(repo, alias, process.platform === "win32" ? "junction" : "dir")
      })
      const pool = Context.get(yield* Layer.build(LayerNode.compile(McpPool.node)), McpPool.Service)
      const pidFile = path.join(root, "pids")
      const config = new ConfigMCP.Local({
        type: "local",
        pool: true,
        command: [process.execPath, path.resolve(import.meta.dir, "../../fixture/mcp-modern-stdio.ts")],
        environment: { MCP_PID_FILE: pidFile },
      })
      for (const [dir, processes] of [
        [repo, 1],
        [alias, 1],
        [other, 2],
      ] as const) {
        const mcp = yield* open(dir, pool)
        yield* mcp.add("fixture", config)
        const result = yield* mcp.callTool({ server: "fixture", name: "echo" })
        expect(result.content).toMatchObject([{ type: "text", text: "ok" }])
        expect((yield* Effect.promise(() => readFile(pidFile, "utf8"))).trim().split(/\s+/)).toHaveLength(processes)
      }
    }),
)

it.live("keeps the original MCP pool key if the configured cwd cannot be resolved", () =>
  Effect.gen(function* () {
    const { path: root } = yield* tmpdirScoped()
    const config = new ConfigMCP.Local({ type: "local", cwd: "missing", command: [process.execPath], pool: true })
    const pool = Context.get(yield* Layer.build(LayerNode.compile(McpPool.node)), McpPool.Service)
    const keys: string[] = []
    const mcp = yield* open(root, {
      connection: (input) =>
        pool.connection({
          ...input,
          select: input.select.pipe(Effect.tap(({ key }) => Effect.sync(() => keys.push(key)))),
        }),
    })
    yield* mcp.add("fixture", config)
    yield* Effect.exit(mcp.callTool({ server: "fixture", name: "echo" }))
    expect(keys).toEqual([McpPool.key({ config: { ...config, protocol: "auto" }, cwd: path.join(root, "missing") })])
  }),
)
