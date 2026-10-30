import { expect, test } from "bun:test"
import { OpenCode } from "@opencode/client"
import { KiloAgentPluginsRpc } from "@opencode/schema/kilocode/agent-plugins"
import { createRoutes } from "@opencode/server/routes"
import { Context, Effect, Layer, References } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { KiloHost } from "../src/host"

const PLUGIN = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json"
const MCP = "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json"

// A minimal MCP stdio server. On start it records the environment and working directory it was launched with, so
// the test can check what the client provided (spec §9.1), then answers initialize and tools/list.
const SERVER = `#!/usr/bin/env bun
import { writeFileSync } from "node:fs"
writeFileSync(process.env.PLUGIN_DATA + "/started.json", JSON.stringify({
  root: process.env.PLUGIN_ROOT, data: process.env.PLUGIN_DATA, cwd: process.cwd(), mode: process.env.MODE, arg: process.argv[2],
}))
let buffer = ""
process.stdin.on("data", (chunk) => {
  buffer += chunk
  for (let index = buffer.indexOf("\\n"); index >= 0; index = buffer.indexOf("\\n")) {
    const line = buffer.slice(0, index)
    buffer = buffer.slice(index + 1)
    if (!line.trim()) continue
    const message = JSON.parse(line)
    if (message.id === undefined) continue
    const result =
      message.method === "initialize"
        ? { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "echo", version: "1.0.0" } }
        : message.method === "tools/list"
          ? { tools: [{ name: "echo", description: "Echo", inputSchema: { type: "object", properties: {} } }] }
          : {}
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }) + "\\n")
  }
})
`

async function eventually<A>(read: () => Promise<A>, ready: (value: A) => boolean) {
  const deadline = performance.now() + 15_000
  while (performance.now() < deadline) {
    const value = await read()
    if (ready(value)) return value
    await Bun.sleep(50)
  }
  throw new Error("Agent Plugin components did not appear")
}

test("a project Agent Plugin's skill and stdio MCP server reach the server API", async () => {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-agent-plugins-")))
  const root = path.join(directory, ".kilo2/plugins/demo")
  await mkdir(path.join(root, "skills/summarize"), { recursive: true })
  await mkdir(path.join(root, "bin"), { recursive: true })
  await writeFile(path.join(root, "plugin.json"), JSON.stringify({ $schema: PLUGIN, name: "demo" }))
  await writeFile(
    path.join(root, "skills/summarize/SKILL.md"),
    "---\nname: summarize\ndescription: Summarize the conversation.\n---\n# Summarize\n",
  )
  await writeFile(path.join(root, "bin/server"), SERVER)
  await chmod(path.join(root, "bin/server"), 0o755)
  await writeFile(
    path.join(root, "mcp.json"),
    JSON.stringify({
      $schema: MCP,
      mcpServers: {
        echo: { type: "stdio", command: "./bin/server", args: ["${PLUGIN_ROOT}/x"], env: { MODE: "${PLUGIN_DATA}" } },
        legacy: { type: "sse", url: "https://example.com/sse" },
      },
    }),
  )
  try {
    await withServer(directory, async (client) => {
      const options = { location: { directory } }
      const skills = await eventually(
        async () => (await client.skill.list(options)).data,
        (value) => value.some((skill) => skill.id === "demo:summarize"),
      )
      expect(skills).toContainEqual({
        id: "demo:summarize",
        name: "summarize",
        description: "Summarize the conversation.",
        path: path.join(root, "skills/summarize/SKILL.md"),
        content: "# Summarize\n",
      })
      const servers = await eventually(
        async () => (await client.mcp.list(options)).data,
        (value) => value.some((server) => server.name === "demo:echo" && server.status.status === "connected"),
      )
      expect(servers.map((server) => server.name)).not.toContain("demo:legacy")
      // The data directory lives under the Kilo data root, outside the plugin, and the server ran in the root.
      const [file] = await Array.fromAsync(
        new Bun.Glob("**/agent-plugins/demo-*/started.json").scan({
          cwd: process.env.XDG_DATA_HOME!,
          absolute: true,
        }),
      )
      if (!file) throw new Error("the MCP server did not record its start")
      const data = await realpath(path.dirname(file))
      expect(await Bun.file(file).json()).toEqual({ root, data, cwd: root, mode: data, arg: `${root}/x` })
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("the kilocode.agent-plugins RPC installs, lists, disables and uninstalls through the generated client", async () => {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-agent-plugins-rpc-")))
  const source = path.join(directory, "source/notes")
  await mkdir(path.join(source, "skills/jot"), { recursive: true })
  await writeFile(
    path.join(source, "plugin.json"),
    JSON.stringify({ $schema: PLUGIN, name: "notes", version: "0.1.0" }),
  )
  await writeFile(path.join(source, "skills/jot/SKILL.md"), "---\nname: jot\ndescription: Jot a note.\n---\n# Jot\n")
  try {
    await withServer(directory, async (client) => {
      const rpc = client.rpc(KiloAgentPluginsRpc.Definition)
      const options = { location: { directory } }
      await eventually(
        async () => (await client.skill.list(options)).data,
        (value) => value.length > 0,
      )
      expect(await rpc.list({}, options)).toEqual([])

      const installed = await rpc.install({ source: { type: "path", path: "source/notes" }, scope: "project" }, options)
      const root = path.join(directory, ".kilo2/plugins/notes")
      expect(installed).toEqual({
        name: "notes",
        version: "0.1.0",
        root,
        scope: "project",
        status: "loaded",
        skills: ["notes:jot"],
        servers: [],
        removable: true,
        diagnostics: [],
      })
      expect(await rpc.list({}, options)).toEqual([installed])
      expect((await client.skill.list(options)).data.map((skill) => skill.id)).toContain("notes:jot")

      const conflict = await rpc.install({ source: { type: "path", path: source }, scope: "project" }, options).then(
        () => undefined,
        (error: { type: string }) => error.type,
      )
      expect(conflict).toBe("conflict")

      await rpc.setEnabled({ name: "notes", enabled: false, scope: "project" }, options)
      expect(await Bun.file(path.join(directory, "kilo2.json")).json()).toEqual({
        agent_plugins: { disabled: ["notes"] },
      })
      await rpc.setEnabled({ name: "notes", enabled: true, scope: "project" }, options)
      expect(await Bun.file(path.join(directory, "kilo2.json")).json()).toEqual({})

      await rpc.uninstall({ name: "notes", scope: "project" }, options)
      expect(await rpc.list({}, options)).toEqual([])
      expect((await client.skill.list(options)).data.map((skill) => skill.id)).not.toContain("notes:jot")
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

/** Boots the host server in memory for `directory` and hands the test a generated client. */
async function withServer(directory: string, body: (client: ReturnType<typeof OpenCode.make>) => Promise<void>) {
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
        yield* Effect.promise(() => body(client))
      }),
    ).pipe(Effect.provideService(References.MinimumLogLevel, "Error")),
  )
}
