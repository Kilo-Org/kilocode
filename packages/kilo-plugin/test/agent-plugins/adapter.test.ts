import { describe, expect } from "bun:test"
import { chmod, lstat, mkdir, mkdtemp, readdir, realpath, rm, stat, symlink, writeFile } from "node:fs/promises"
import { parse } from "jsonc-parser"
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
import { Location } from "@opencode/core/location"
import { Project } from "@opencode/core/project"
import type { MCPEditor } from "@opencode/plugin/effect/mcp"
import type { RpcDomain, RpcHandlers } from "@opencode/plugin/effect/rpc"
import type { KiloAgentPluginsRpc } from "@opencode/schema/kilocode/agent-plugins"
import { Directory, Document, Info, type Entry } from "@opencode/schema/config"
import { Mcp } from "@opencode/schema/mcp"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { KiloConfigFiles } from "@opencode/util/kilocode/config/files"
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
  // The global Kilo config directory, then the project's .kilo2, as config discovery orders them.
  const roots = [path.join(input.home, ".config/kilo2"), ...(input.project ? [path.join(input.project, ".kilo2")] : [])]
  const directories = roots.map((root) => new Directory({ type: "directory", path: AbsolutePath.make(root) }))
  const rpc = rpcHost()
  const directory = AbsolutePath.make(input.project ?? input.home)
  yield* KiloAgentPlugins.Plugin.effect(
    host({
      skill: { list: () => Effect.die("unused skill.list"), transform: skills.transform, reload: skills.reload },
      mcp: mcp.domain,
      rpc: rpc.domain,
      location: new Location.Info({
        directory,
        project: { id: Project.ID.global, directory, canonical: directory },
      }),
    }),
  ).pipe(
    Effect.provide(Config.testLayer([...directories, ...(input.entries ?? [])])),
    Effect.provideService(
      Global.Service,
      Global.Service.of({
        ...Global.make(),
        home: input.home,
        config: path.join(input.home, ".config/kilo2"),
        data: path.join(input.home, "data"),
      }),
    ),
  )
  return { skills, mcp, rpc: rpc.captured }
})

type Handlers = RpcHandlers<typeof KiloAgentPluginsRpc.Definition>

/** A fake RPC domain that keeps the registered handlers and records emitted events. */
function rpcHost() {
  const captured = { handlers: undefined as Handlers | undefined, events: [] as string[] }
  const domain = Object.assign(
    () => {
      throw new Error("unused rpc.client")
    },
    {
      register: (_definition: unknown, handlers: Handlers) =>
        Effect.sync(() => {
          captured.handlers = handlers
          return {
            dispose: Effect.void,
            events: { emit: (name: string) => Effect.sync(() => void captured.events.push(name)) },
          }
        }),
    },
  ) as unknown as RpcDomain
  return { domain, captured }
}

// Handler errors come back as plain values, the way the RPC route serializes them.
const context = { error: (type: string, message: string) => ({ type, message }) } as never
const call = <M extends keyof Handlers>(rpc: { handlers?: Handlers }, method: M, input: Parameters<Handlers[M]>[0]) =>
  (
    rpc.handlers![method] as (
      input: unknown,
      context: never,
    ) => Effect.Effect<unknown, { type: string; message: string }>
  )(input, context)

const ids = (skills: readonly Skill.Info[]) => skills.map((item): string => item.id).toSorted()

describe("Agent Plugins adapter", () => {
  it.live("loads global, project and explicit plugins and maps their components", () =>
    Effect.gen(function* () {
      const home = yield* Effect.promise(temp)
      const project = yield* Effect.promise(temp)
      yield* Effect.promise(() =>
        Promise.all([
          write(
            path.join(home, ".config/kilo2/plugins/tools"),
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
            path.join(project, ".kilo2/plugins/review"),
            plugin("review", { "skills/review/SKILL.md": skill("review") }),
          ),
          write(path.join(project, ".kilo2/plugins/not-a-plugin"), { "README.md": "no manifest" }),
          write(path.join(project, "vendor/deploy"), plugin("deploy", { "skills/ship/SKILL.md": skill("ship") })),
        ]),
      )
      const root = path.join(home, ".config/kilo2/plugins/tools")
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
          write(path.join(home, ".config/kilo2/plugins/a"), plugin("alpha", { "mcp.json": mcpJson })),
          write(
            path.join(home, ".config/kilo2/plugins/b"),
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
          path.join(home, ".config/kilo2/plugins/a"),
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
      const root = path.join(home, ".config/kilo2/plugins/live")
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
    const { active: loaded } = await KiloAgentPlugins.load(candidates, disabled, data, (root, diagnostic) =>
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

describe("kilocode.agent-plugins RPC", () => {
  const listed = (rpc: { handlers?: Handlers }) =>
    call(rpc, "list", {}) as Effect.Effect<KiloAgentPluginsRpc.Plugin[], { type: string; message: string }>

  it.live("list describes loaded, rejected, disabled and shadowed plugins", () =>
    Effect.gen(function* () {
      const home = yield* Effect.promise(temp)
      const project = yield* Effect.promise(temp)
      const global = path.join(home, ".config/kilo2/plugins")
      yield* Effect.promise(() =>
        Promise.all([
          write(path.join(global, "alpha"), {
            "plugin.json": { $schema: PLUGIN, name: "alpha", version: "1.2.0", description: "Alpha tools" },
            "skills/one/SKILL.md": skill("one"),
            "mcp.json": {
              $schema: MCP,
              mcpServers: { api: { type: "streamable-http", url: "https://example.com/mcp" } },
            },
          }),
          write(path.join(global, "bad"), { "plugin.json": { $schema: PLUGIN, name: "Bad" } }),
          write(path.join(global, "off"), plugin("off")),
          write(path.join(global, "same"), plugin("same")),
          write(path.join(project, ".kilo2/plugins/same"), plugin("same", { "skills/p/SKILL.md": skill("p") })),
        ]),
      )
      const { rpc } = yield* start({ home, project, entries: [settings({ disabled: ["off"] })] })
      const plugins = yield* listed(rpc)
      const byRoot = Object.fromEntries(plugins.map((item) => [item.root, item]))
      expect(byRoot[path.join(global, "alpha")]).toEqual({
        name: "alpha",
        version: "1.2.0",
        description: "Alpha tools",
        root: path.join(global, "alpha"),
        scope: "global",
        status: "loaded",
        skills: ["alpha:one"],
        servers: ["alpha:api"],
        removable: true,
        diagnostics: [],
      })
      expect(byRoot[path.join(global, "bad")]).toMatchObject({ status: "rejected", removable: true })
      expect(byRoot[path.join(global, "bad")]!.name).toBeUndefined()
      expect(byRoot[path.join(global, "bad")]!.diagnostics.map((item) => item.code)).toEqual(["manifest-invalid"])
      expect(byRoot[path.join(global, "off")]).toMatchObject({ name: "off", status: "disabled", skills: [] })
      expect(byRoot[path.join(global, "same")]).toMatchObject({ status: "shadowed" })
      expect(byRoot[path.join(global, "same")]!.diagnostics.map((item) => item.code)).toEqual(["plugin-shadowed"])
      expect(byRoot[path.join(project, ".kilo2/plugins/same")]).toMatchObject({
        scope: "project",
        status: "loaded",
        skills: ["same:p"],
        removable: true,
      })
    }),
  )

  it.live("install copies a plugin directory, refuses a duplicate and replaces on request", () =>
    Effect.gen(function* () {
      const home = yield* Effect.promise(temp)
      const source = path.join(yield* Effect.promise(temp), "demo")
      yield* Effect.promise(() =>
        write(source, plugin("demo", { "skills/one/SKILL.md": skill("one"), ".git/HEAD": "ref: main" })),
      )
      const { rpc, skills } = yield* start({ home })
      const installed = (yield* call(rpc, "install", {
        source: { type: "path", path: source },
        scope: "global",
      })) as KiloAgentPluginsRpc.Plugin
      const target = path.join(home, ".config/kilo2/plugins/demo")
      expect(installed).toMatchObject({ name: "demo", root: target, status: "loaded", skills: ["demo:one"] })
      expect(ids(yield* skills.list())).toContain("demo:one")
      expect(rpc.events).toContain("changed")
      expect(yield* Effect.promise(() => exists(path.join(target, ".git")))).toBe(false)
      expect(yield* Effect.promise(() => exists(path.join(home, ".config/kilo2/.agent-plugins-staging")))).toBe(false)

      const duplicate = yield* Effect.flip(
        call(rpc, "install", { source: { type: "path", path: source }, scope: "global" }),
      )
      expect(duplicate.type).toBe("conflict")

      yield* Effect.promise(() => write(source, { "skills/two/SKILL.md": skill("two") }))
      const replaced = (yield* call(rpc, "install", {
        source: { type: "path", path: source },
        scope: "global",
        replace: true,
      })) as KiloAgentPluginsRpc.Plugin
      expect(replaced.skills).toEqual(["demo:one", "demo:two"])
    }),
  )

  it.live("install unpacks a tar.gz archive, keeps executable servers and honors a subdirectory", () =>
    Effect.gen(function* () {
      const home = yield* Effect.promise(temp)
      const project = yield* Effect.promise(temp)
      const build = yield* Effect.promise(temp)
      const demo = path.join(build, "repo-main/plugins/demo")
      yield* Effect.promise(async () => {
        await write(
          demo,
          plugin("demo", {
            "bin/server": "#!/bin/sh\n",
            "mcp.json": { $schema: MCP, mcpServers: { local: { type: "stdio", command: "./bin/server" } } },
          }),
        )
        await chmod(path.join(demo, "bin/server"), 0o755)
        // Relative paths: GNU tar on Windows reads "C:" in an archive path as a remote host.
        await Bun.$`tar -czf repo.tar.gz repo-main`.cwd(build).quiet()
      })
      const server = Bun.serve({ port: 0, fetch: () => new Response(Bun.file(path.join(build, "repo.tar.gz"))) })
      yield* Effect.addFinalizer(() => Effect.sync(() => server.stop(true)))
      const url = `http://127.0.0.1:${server.port}/repo.tar.gz`
      const { rpc } = yield* start({ home, project })

      const missing = yield* Effect.flip(call(rpc, "install", { source: { type: "archive", url }, scope: "project" }))
      expect(missing.type).toBe("invalid")
      expect(missing.message).toContain("pass the plugin's subdirectory")

      const installed = (yield* call(rpc, "install", {
        source: { type: "archive", url, subdirectory: "plugins/demo" },
        scope: "project",
      })) as KiloAgentPluginsRpc.Plugin
      const target = path.join(project, ".kilo2/plugins/demo")
      expect(installed).toMatchObject({ root: target, scope: "project", status: "loaded", servers: ["demo:local"] })
      // Windows has no executable bit to keep.
      if (process.platform !== "win32")
        expect((yield* Effect.promise(() => stat(path.join(target, "bin/server")))).mode & 0o111).not.toBe(0)

      const escape = yield* Effect.flip(
        call(rpc, "install", { source: { type: "archive", url, subdirectory: "../.." }, scope: "project" }),
      )
      expect(escape.type).toBe("invalid")
    }),
  )

  it.live("install rejects an invalid plugin or missing source and leaves nothing behind", () =>
    Effect.gen(function* () {
      const home = yield* Effect.promise(temp)
      const source = path.join(yield* Effect.promise(temp), "bad")
      yield* Effect.promise(() => write(source, { "plugin.json": { $schema: PLUGIN, name: "Bad Name" } }))
      const { rpc } = yield* start({ home })
      const invalid = yield* Effect.flip(
        call(rpc, "install", { source: { type: "path", path: source }, scope: "global" }),
      )
      expect(invalid.type).toBe("invalid")
      expect(invalid.message).toContain("Invalid plugin name")
      const missing = yield* Effect.flip(
        call(rpc, "install", { source: { type: "path", path: path.join(source, "nope") }, scope: "global" }),
      )
      expect(missing.type).toBe("not_found")
      const config = path.join(home, ".config/kilo2")
      // Staging is removed and no plugins/ entry was created.
      expect(yield* Effect.promise(() => readdir(config).catch(() => []))).toEqual([])
    }),
  )

  it.live("uninstall removes a plugin and its data on request, and only unlinks a linked plugin", () =>
    Effect.gen(function* () {
      const home = yield* Effect.promise(temp)
      const elsewhere = yield* Effect.promise(temp)
      const plugins = path.join(home, ".config/kilo2/plugins")
      const stdio = { $schema: MCP, mcpServers: { db: { type: "stdio", command: "node" } } }
      yield* Effect.promise(async () => {
        await write(path.join(plugins, "demo"), plugin("demo", { "mcp.json": stdio }))
        await write(path.join(elsewhere, "linked"), plugin("linked"))
        await symlink(path.join(elsewhere, "linked"), path.join(plugins, "linked"), "dir")
      })
      const { rpc, mcp } = yield* start({ home })
      const local = mcp.state.servers.get("demo:db")
      const data = local?.type === "local" ? local.environment!.PLUGIN_DATA! : ""
      expect(yield* Effect.promise(() => exists(data))).toBe(true)

      yield* call(rpc, "uninstall", { name: "demo", scope: "global", removeData: true })
      expect(yield* Effect.promise(() => exists(path.join(plugins, "demo")))).toBe(false)
      expect(yield* Effect.promise(() => exists(data))).toBe(false)
      expect(mcp.state.servers.has("demo:db")).toBe(false)

      yield* call(rpc, "uninstall", { name: "linked", scope: "global" })
      expect(yield* Effect.promise(() => exists(path.join(plugins, "linked")))).toBe(false)
      expect(yield* Effect.promise(() => exists(path.join(elsewhere, "linked/plugin.json")))).toBe(true)
      expect(yield* listed(rpc)).toEqual([])

      const missing = yield* Effect.flip(call(rpc, "uninstall", { name: "demo", scope: "global" }))
      expect(missing.type).toBe("not_found")
    }),
  )

  it.live("setEnabled writes agent_plugins.disabled to the scope's config and enabling clears both scopes", () =>
    Effect.gen(function* () {
      const home = yield* Effect.promise(temp)
      const project = yield* Effect.promise(temp)
      const globalFile = path.join(home, ".config/kilo2", KiloConfigFiles.newFile)
      const projectFile = path.join(project, KiloConfigFiles.newFile)
      // An existing JSONC config is the one written, with its comments kept.
      const globalJsonc = path.join(home, ".config/kilo2/kilo2.jsonc")
      yield* Effect.promise(() =>
        write(path.dirname(globalJsonc), { "kilo2.jsonc": '{\n  // keep me\n  "theme": "x"\n}\n' }),
      )
      const { rpc } = yield* start({ home, project })
      const read = (file: string) =>
        Effect.promise(() =>
          Bun.file(file)
            .text()
            .catch(() => ""),
        )

      yield* call(rpc, "setEnabled", { name: "demo", enabled: false, scope: "global" })
      yield* call(rpc, "setEnabled", { name: "demo", enabled: false, scope: "global" })
      yield* call(rpc, "setEnabled", { name: "other", enabled: false, scope: "project" })
      yield* call(rpc, "setEnabled", { name: "demo", enabled: false, scope: "project" })
      expect(yield* read(globalJsonc)).toContain("// keep me")
      expect(parseJsonc(yield* read(globalJsonc)).agent_plugins).toEqual({ disabled: ["demo"] })
      expect(parseJsonc(yield* read(projectFile)).agent_plugins).toEqual({ disabled: ["other", "demo"] })
      expect(yield* Effect.promise(() => exists(globalFile))).toBe(false)

      yield* call(rpc, "setEnabled", { name: "demo", enabled: true, scope: "global" })
      expect(parseJsonc(yield* read(globalJsonc)).agent_plugins).toBeUndefined()
      expect(parseJsonc(yield* read(projectFile)).agent_plugins).toEqual({ disabled: ["other"] })
    }),
  )
})

describe("kilocode.agent-plugins RPC edge cases", () => {
  it.live("enabling clears the name from every native config file of the project", () =>
    Effect.gen(function* () {
      const home = yield* Effect.promise(temp)
      const project = yield* Effect.promise(temp)
      const disabled = (names: string[]) => JSON.stringify({ agent_plugins: { disabled: names } })
      yield* Effect.promise(() =>
        write(path.join(project, ".kilo2"), {
          "kilo2.jsonc": disabled(["demo"]),
          "kilo2.json": disabled(["demo", "other"]),
        }),
      )
      const { rpc } = yield* start({ home, project })
      yield* call(rpc, "setEnabled", { name: "demo", enabled: true, scope: "project" })
      const read = (file: string) => Effect.promise(() => Bun.file(path.join(project, ".kilo2", file)).json())
      expect(yield* read("kilo2.jsonc")).toEqual({})
      expect(yield* read("kilo2.json")).toEqual({ agent_plugins: { disabled: ["other"] } })
    }),
  )

  it.live("a rejected plugin can be uninstalled by its directory name", () =>
    Effect.gen(function* () {
      const home = yield* Effect.promise(temp)
      const plugins = path.join(home, ".config/kilo2/plugins")
      yield* Effect.promise(() => write(path.join(plugins, "broken"), { "plugin.json": "{ not json" }))
      const { rpc } = yield* start({ home })
      const plugins_ = (yield* call(rpc, "list", {})) as KiloAgentPluginsRpc.Plugin[]
      expect(plugins_).toMatchObject([{ status: "rejected", removable: true, root: path.join(plugins, "broken") }])
      yield* call(rpc, "uninstall", { name: "broken", scope: "global" })
      expect(yield* Effect.promise(() => exists(path.join(plugins, "broken")))).toBe(false)
    }),
  )

  it.live("archive problems are invalid and transfer problems are fetch failures", () =>
    Effect.gen(function* () {
      const home = yield* Effect.promise(temp)
      const outside = yield* Effect.promise(temp)
      const build = yield* Effect.promise(temp)
      // A tar whose only top-level entry is a link to a plugin outside the archive.
      yield* Effect.promise(async () => {
        await write(path.join(outside, "plugin"), plugin("outside"))
        await symlink(path.relative(build, path.join(outside, "plugin")), path.join(build, "top"), "dir")
        await Bun.$`tar -czf linked.tar.gz top`.cwd(build).quiet()
      })
      const server = Bun.serve({
        port: 0,
        fetch: (request) => {
          const name = new URL(request.url).pathname
          if (name === "/linked.tar.gz") return new Response(Bun.file(path.join(build, "linked.tar.gz")))
          if (name === "/corrupt.tar.gz") return new Response(new Uint8Array([0x1f, 0x8b, 8, 0, 1, 2, 3, 4, 5]))
          return new Response("missing", { status: 404 })
        },
      })
      yield* Effect.addFinalizer(() => Effect.sync(() => server.stop(true)))
      const url = (name: string) => `http://127.0.0.1:${server.port}/${name}`
      const { rpc } = yield* start({ home })
      const install = (name: string) =>
        Effect.flip(call(rpc, "install", { source: { type: "archive", url: url(name) }, scope: "global" }))

      expect((yield* install("linked.tar.gz")).type).toBe("invalid")
      expect(yield* Effect.promise(() => exists(path.join(outside, "plugin/plugin.json")))).toBe(true)
      expect((yield* install("corrupt.tar.gz")).type).toBe("invalid")
      expect((yield* install("gone.tar.gz")).type).toBe("fetch_failed")
      expect(yield* Effect.promise(() => readdir(path.join(home, ".config/kilo2")).catch(() => []))).toEqual([])
    }),
  )
})

async function exists(target: string) {
  return lstat(target).then(
    () => true,
    () => false,
  )
}

function parseJsonc(text: string): { agent_plugins?: unknown } {
  return parse(text) ?? {}
}
