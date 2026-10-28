import { describe, expect } from "bun:test"
import { mkdir, mkdtemp, readdir, realpath, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Deferred, Effect, Fiber, Layer, Schema, Stream, type Types } from "effect"
import { Bus } from "@opencode/core/bus"
import { Config } from "@opencode/core/config"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Watcher } from "@opencode/core/filesystem/watcher"
import { KiloConfigPolicy } from "@opencode/core/kilocode/config/policy"
import { AbsolutePath } from "@opencode/core/schema"
import { Skill } from "@opencode/core/skill"
import type { MCPEditor } from "@opencode/plugin/effect/mcp"
import { Document, Info, type Entry } from "@opencode/schema/config"
import { Mcp } from "@opencode/schema/mcp"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { host } from "../../../core/test/plugin/host"
import { testEffect } from "../../../core/test/lib/effect"
import type { Diagnostic } from "../../src/agent-plugins/diagnostic"
import { KiloAgentPlugins } from "../../src/agent-plugins"

const PLUGIN = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json"
const MCP = "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json"
const it = testEffect(
  Layer.merge(AppNodeBuilder.build(LayerNode.group([Skill.node, Bus.node, FSUtil.node])), Watcher.testLayer),
)
const decodeServer = Schema.decodeUnknownSync(Mcp.ServerConfig)

/** A fake MCP domain that replays transforms like the real one and decodes every write like the host does. */
function mcpHost(initial: Record<string, Mcp.ServerConfig> = {}) {
  const transforms: ((editor: MCPEditor) => void)[] = []
  const state = { servers: new Map<string, Mcp.ServerConfig>() }
  const rebuild = () => {
    const servers = new Map(Object.entries(initial))
    const editor: MCPEditor = {
      list: () => [...servers] as [string, Types.DeepMutable<Mcp.ServerConfig>][],
      get: (name) => servers.get(name) as Types.DeepMutable<Mcp.ServerConfig> | undefined,
      set: (name, config) => void servers.set(name, decodeServer(config)),
      update: () => {},
      remove: (name) => void servers.delete(name),
    }
    for (const transform of transforms) transform(editor)
    state.servers = servers
  }
  return {
    state,
    domain: {
      list: () => Effect.die("unused mcp.list"),
      transform: (callback: (editor: MCPEditor) => void) =>
        Effect.sync(() => {
          transforms.push(callback)
          rebuild()
          return { dispose: Effect.void }
        }),
      reload: () => Effect.sync(rebuild),
    },
  }
}

async function temp() {
  return realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-agent-plugins-")))
}

async function write(root: string, files: Record<string, string | object>) {
  for (const [file, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true })
    await writeFile(path.join(root, file), typeof content === "string" ? content : JSON.stringify(content))
  }
}

const skill = (name: string, description = `The ${name} skill.`) =>
  `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\n`

function plugin(name: string, extra: Record<string, string | object> = {}) {
  return { "plugin.json": { $schema: PLUGIN, name }, ...extra }
}

const settings = (agent_plugins: KiloConfigPolicy.AgentPlugins, file?: string) =>
  new Document({
    type: "document",
    info: new KiloConfigPolicy.Info({ agent_plugins }),
    ...(file ? { path: AbsolutePath.make(file) } : {}),
  })

/** Starts the plugin against a real skill service, the fake MCP domain and in-memory config and watching. */
const start = Effect.fnUntraced(function* (input: {
  home: string
  project?: string
  entries?: Entry[]
  servers?: Record<string, Mcp.ServerConfig>
}) {
  const skills = yield* Skill.Service
  const mcp = mcpHost(input.servers)
  const agents = [path.join(input.home, ".agents"), ...(input.project ? [path.join(input.project, ".agents")] : [])]
  yield* KiloAgentPlugins.Plugin.effect(
    host({
      skill: { list: () => Effect.die("unused skill.list"), transform: skills.transform, reload: skills.reload },
      mcp: mcp.domain,
    }),
  ).pipe(
    Effect.provide(
      Config.testLayer(input.entries ?? [], { claude: [], agents: agents.map((item) => AbsolutePath.make(item)) }),
    ),
    Effect.provideService(
      Global.Service,
      Global.Service.of({ ...Global.make(), home: input.home, data: path.join(input.home, "data") }),
    ),
  )
  return { skills, mcp }
})

const ids = (skills: readonly Skill.Info[]) => skills.map((item): string => item.id).toSorted()

describe("Agent Plugins adapter", () => {
  it.live("loads global, project and explicit plugins and maps their components", () =>
    Effect.gen(function* () {
      const home = yield* Effect.promise(temp)
      const project = yield* Effect.promise(temp)
      yield* Effect.promise(() =>
        Promise.all([
          write(
            path.join(home, ".agents/plugins/tools"),
            plugin("acme.tools", {
              "skills/summarize/SKILL.md": skill("summarize"),
              "bin/server": "#!/bin/sh",
              "mcp.json": {
                $schema: MCP,
                mcpServers: {
                  local: { type: "stdio", command: "./bin/server", args: ["${PLUGIN_DATA}/db"], env: { MODE: "x" } },
                  remote: { type: "streamable-http", url: "https://example.com/mcp" },
                  tenant: { type: "streamable-http", url: "https://example.com/mcp", headers: { "X-Tenant": "a" } },
                  legacy: { type: "sse", url: "https://example.com/sse" },
                },
              },
            }),
          ),
          write(
            path.join(project, ".agents/plugins/review"),
            plugin("review", { "skills/review/SKILL.md": skill("review") }),
          ),
          write(path.join(project, ".agents/plugins/not-a-plugin"), { "README.md": "no manifest" }),
          write(path.join(project, "vendor/deploy"), plugin("deploy", { "skills/ship/SKILL.md": skill("ship") })),
        ]),
      )
      const root = path.join(home, ".agents/plugins/tools")
      const { skills, mcp } = yield* start({
        home,
        project,
        entries: [settings({ paths: ["./vendor/deploy"] }, path.join(project, "kilo2.json"))],
      })
      const list = yield* skills.list()
      expect(ids(list)).toEqual(["acme.tools:summarize", "deploy:ship", "review:review"])
      expect(list.find((item) => item.id === "acme.tools:summarize")).toMatchObject({
        name: "summarize",
        description: "The summarize skill.",
        path: path.join(root, "skills/summarize/SKILL.md"),
        content: "# summarize\n",
      })
      expect([...mcp.state.servers.keys()].toSorted()).toEqual(["acme.tools:local", "acme.tools:remote"])
      const local = mcp.state.servers.get("acme.tools:local")
      if (local?.type !== "local") throw new Error("expected a local server")
      const data = local.environment!.PLUGIN_DATA!
      expect(data.startsWith(path.join(home, "data/agent-plugins/acme.tools-"))).toBe(true)
      expect(local).toMatchObject({
        type: "local",
        command: [path.join(root, "bin/server"), `${data}/db`],
        cwd: root,
        environment: { MODE: "x", PLUGIN_ROOT: root, PLUGIN_DATA: data },
      })
      expect(mcp.state.servers.get("acme.tools:remote")).toMatchObject({
        type: "remote",
        url: "https://example.com/mcp",
      })
    }),
  )

  it.live("user config wins for MCP servers, and a disabled plugin is not loaded at all", () =>
    Effect.gen(function* () {
      const home = yield* Effect.promise(temp)
      const mcpJson = { $schema: MCP, mcpServers: { db: { type: "stdio", command: "node" } } }
      yield* Effect.promise(() =>
        Promise.all([
          write(path.join(home, ".agents/plugins/a"), plugin("alpha", { "mcp.json": mcpJson })),
          write(
            path.join(home, ".agents/plugins/b"),
            plugin("beta", { "mcp.json": mcpJson, "skills/x/SKILL.md": skill("x") }),
          ),
        ]),
      )
      const user = new Mcp.RemoteConfig({ type: "remote", url: "https://mine.example.com/mcp" })
      const { skills, mcp } = yield* start({
        home,
        entries: [settings({ disabled: ["beta"] })],
        servers: { "alpha:db": user },
      })
      expect(mcp.state.servers.get("alpha:db")).toBe(user)
      expect([...mcp.state.servers.keys()]).toEqual(["alpha:db"])
      expect(ids(yield* skills.list())).toEqual([])
      // alpha got a data directory (its server was mapped, then config won); beta was never loaded.
      const created = yield* Effect.promise(() => readdir(path.join(home, "data/agent-plugins")))
      expect(created.map((name) => name.split("-")[0])).toEqual(["alpha"])
    }),
  )

  it.live("applies the global MCP timeout defaults from config", () =>
    Effect.gen(function* () {
      const home = yield* Effect.promise(temp)
      yield* Effect.promise(() =>
        write(
          path.join(home, ".agents/plugins/a"),
          plugin("alpha", { "mcp.json": { $schema: MCP, mcpServers: { db: { type: "stdio", command: "node" } } } }),
        ),
      )
      const { mcp } = yield* start({
        home,
        entries: [
          new Document({
            type: "document",
            info: Schema.decodeUnknownSync(Info)({ mcp: { timeout: { startup: 1234 } } }),
          }),
        ],
      })
      expect(mcp.state.servers.get("alpha:db")?.timeout).toEqual({ startup: 1234 })
    }),
  )

  it.live("a watched change reloads the plugins", () =>
    Effect.gen(function* () {
      const home = yield* Effect.promise(temp)
      const root = path.join(home, ".agents/plugins/live")
      yield* Effect.promise(() => write(root, plugin("live", { "skills/one/SKILL.md": skill("one") })))
      const { skills } = yield* start({ home })
      expect(ids(yield* skills.list())).toEqual(["live:one"])
      yield* Effect.promise(() => write(root, { "skills/two/SKILL.md": skill("two") }))

      const watcher = yield* Watcher.Test
      const bus = yield* Bus.Service
      const updated = yield* Deferred.make<void>()
      const fiber = yield* bus.subscribe(Skill.Event.Updated).pipe(
        Stream.runForEach(() => Deferred.succeed(updated, undefined).pipe(Effect.asVoid)),
        Effect.forkScoped,
      )
      yield* Effect.yieldNow
      yield* watcher.emit({ type: "create", path: path.join(root, "skills/two/SKILL.md") })
      yield* Deferred.await(updated).pipe(Effect.timeout("2 seconds"))
      yield* Fiber.interrupt(fiber)
      expect(ids(yield* skills.list())).toEqual(["live:one", "live:two"])
      yield* Effect.promise(() => rm(home, { recursive: true, force: true }))
    }),
  )
})

describe("Agent Plugins loading rules", () => {
  const run = async (
    candidates: { path: string; scope: "global" | "project" | "explicit" }[],
    disabled: string[] = [],
  ) => {
    const reported: [string, Diagnostic.Info][] = []
    const data = path.join(await temp(), "data")
    const loaded = await KiloAgentPlugins.load(candidates, disabled, data, (root, diagnostic) =>
      reported.push([root, diagnostic]),
    )
    return { loaded, reported, data }
  }

  it.live("a nearer plugin with the same name shadows an earlier one and the shadowed one is reported", () =>
    Effect.promise(async () => {
      const base = await temp()
      await write(path.join(base, "global"), plugin("same", { "skills/g/SKILL.md": skill("g") }))
      await write(path.join(base, "project"), plugin("same", { "skills/p/SKILL.md": skill("p") }))
      const { loaded, reported } = await run([
        { path: path.join(base, "global"), scope: "global" },
        { path: path.join(base, "project"), scope: "project" },
      ])
      expect(loaded.map((item) => [item.scope, ids(item.skills)])).toEqual([["project", ["same:p"]]])
      expect(reported.map(([root, item]) => [root, item.code])).toEqual([
        [path.join(base, "global"), "plugin-shadowed"],
      ])
    }),
  )

  it.live("the same root reached twice loads once", () =>
    Effect.promise(async () => {
      const base = await temp()
      await write(path.join(base, "p"), plugin("once"))
      const { loaded, reported } = await run([
        { path: path.join(base, "p"), scope: "global" },
        { path: path.join(base, "p"), scope: "explicit" },
      ])
      expect(loaded).toHaveLength(1)
      expect(reported).toEqual([])
    }),
  )

  it.live(
    "a missing manifest is silent in plugins/ but reported for an explicit path; invalid plugins are reported",
    () =>
      Effect.promise(async () => {
        const base = await temp()
        await write(path.join(base, "plain"), { "README.md": "x" })
        await write(path.join(base, "bad"), { "plugin.json": { $schema: PLUGIN, name: "Bad Name" } })
        const { loaded, reported } = await run([
          { path: path.join(base, "plain"), scope: "project" },
          { path: path.join(base, "plain"), scope: "explicit" },
          { path: path.join(base, "bad"), scope: "project" },
        ])
        expect(loaded).toEqual([])
        expect(reported.map(([, item]) => item.code)).toEqual(["manifest-missing", "manifest-invalid"])
      }),
  )

  it.live("remote servers with headers are skipped and explained", () =>
    Effect.promise(async () => {
      const base = await temp()
      await write(
        path.join(base, "p"),
        plugin("hdr", {
          "mcp.json": {
            $schema: MCP,
            mcpServers: { api: { type: "streamable-http", url: "https://example.com/mcp", headers: { "X-A": "b" } } },
          },
        }),
      )
      const { loaded, reported } = await run([{ path: path.join(base, "p"), scope: "explicit" }])
      expect([...loaded[0]!.servers.keys()]).toEqual([])
      expect(reported.map(([, item]) => [item.code, item.item])).toEqual([["server-unsupported", "api"]])
      expect(reported[0]![1].message).toContain('mcp.servers."hdr:api"')
    }),
  )

  it.live("OAuth settings from the ai.kilo extension reach the remote server; invalid ones are reported", () =>
    Effect.promise(async () => {
      const base = await temp()
      const servers = {
        slack: { type: "streamable-http", url: "https://mcp.slack.com/mcp" },
        other: { type: "streamable-http", url: "https://mcp.example.com/mcp" },
      }
      await write(path.join(base, "p"), {
        "plugin.json": {
          $schema: PLUGIN,
          name: "slack",
          extensions: {
            "ai.kilo": {
              mcp: {
                slack: { oauth: { client_id: "9876543210.1234567890123", callback_port: 3119 } },
                other: { oauth: { client_id: "x", redirect_uri: "https://evil.example/cb" } },
              },
            },
          },
        },
        "mcp.json": { $schema: MCP, mcpServers: servers },
      })
      const { loaded, reported } = await run([{ path: path.join(base, "p"), scope: "explicit" }])
      const slack = loaded[0]!.servers.get("slack:slack")
      expect(slack).toBeInstanceOf(Mcp.RemoteConfig)
      expect(slack).toMatchObject({
        type: "remote",
        url: "https://mcp.slack.com/mcp",
        oauth: { client_id: "9876543210.1234567890123", callback_port: 3119 },
      })
      expect(loaded[0]!.servers.get("slack:other")).toEqual(
        new Mcp.RemoteConfig({ type: "remote", url: "https://mcp.example.com/mcp" }),
      )
      expect(reported.map(([, item]) => [item.code, item.item])).toEqual([["extension-invalid", "other"]])
    }),
  )

  it.live("an opt-out in skill metadata turns off autoinvoke", () =>
    Effect.promise(async () => {
      const base = await temp()
      await write(
        path.join(base, "p"),
        plugin("meta", {
          "skills/quiet/SKILL.md":
            '---\nname: quiet\ndescription: d\nmetadata:\n  opencode/autoinvoke: "false"\n---\nbody',
          "skills/loud/SKILL.md": skill("loud"),
        }),
      )
      const { loaded } = await run([{ path: path.join(base, "p"), scope: "explicit" }])
      expect(loaded[0]!.skills.map((item): [string, boolean | undefined] => [item.id, item.autoinvoke])).toEqual([
        ["meta:loud", undefined],
        ["meta:quiet", false],
      ])
    }),
  )
})
