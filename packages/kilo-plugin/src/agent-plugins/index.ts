export * as KiloAgentPlugins from "./index"

import { AgentPlugin, type Diagnostic, Paths } from "@kilocode/agent-plugins-core"
import { Config } from "@opencode/core/config"
import { Watcher } from "@opencode/core/filesystem/watcher"
import { KiloConfigPolicy } from "@opencode/core/kilocode/config/policy"
import { define } from "@opencode/plugin/effect/plugin"
import { Document } from "@opencode/schema/config"
import { Mcp } from "@opencode/schema/mcp"
import { Skill } from "@opencode/schema/skill"
import { Global } from "@opencode/util/global"
import { readdir } from "node:fs/promises"
import path from "node:path"
import { Effect, FiberMap, Option, PubSub, Scope, Semaphore, Stream } from "effect"

/** A plugin that loaded, with the Kilo values its components map to. */
export interface Loaded {
  readonly plugin: AgentPlugin.Loaded
  readonly scope: "global" | "project" | "explicit"
  readonly skills: readonly Skill.Info[]
  readonly servers: ReadonlyMap<string, Mcp.ServerConfig>
}

interface Candidate {
  readonly path: string
  readonly scope: Loaded["scope"]
}

/**
 * Loads Agent Plugins (agent-plugins.org) and contributes their skills and MCP servers. Plugins come from the
 * `plugins/` directory of every `.agents` root (`~/.agents` and the project's, nearest last) and from the
 * `agent_plugins.paths` config setting. User config wins: a config skill with the same ID replaces a plugin skill,
 * and a configured MCP server with the same name is never overwritten.
 */
export const Plugin = define<Global.Service | Scope.Scope>({
  id: "kilocode.agent-plugins",
  effect: Effect.fn(function* (ctx) {
    const global = yield* Global.Service
    // Location services reach host plugins through the supervisor; a bare SDK embed has neither and gets only the
    // global ~/.agents root and no watching.
    const config = Option.getOrUndefined(yield* Effect.serviceOption(Config.Service))
    const watcher = Option.getOrUndefined(yield* Effect.serviceOption(Watcher.Service))
    const dataRoot = path.join(global.data, "agent-plugins")
    const state = { loaded: [] as Loaded[], entries: [] as readonly Document[], reported: new Set<string>() }
    const watches = yield* FiberMap.make<string>()
    const changes = yield* PubSub.sliding<string>(1)
    const lock = Semaphore.makeUnsafe(1)

    // A missing directory is watched through its first missing path, so creating it later triggers a refresh.
    const watch = Effect.fn("KiloAgentPlugins.watch")(function* (target: string) {
      if (!watcher) return
      const found = yield* Effect.promise(() => nearest(target))
      if (!found) return
      const updates = yield* watcher.subscribe(
        typeof found === "string" ? { path: found, type: "directory" } : { path: found.missing, type: "file" },
      )
      yield* FiberMap.run(
        watches,
        target,
        updates.pipe(Stream.runForEach((update) => PubSub.publish(changes, update.path).pipe(Effect.asVoid))),
        { onlyIfMissing: true, startImmediately: true },
      )
    })

    // Collected during a refresh and logged once afterwards; a problem already reported is not repeated on every
    // watch event, but reappears after it was fixed and broken again.
    const pending: { key: string; diagnostic: Diagnostic.Info; root: string }[] = []
    const report = (root: string, diagnostic: Diagnostic.Info) =>
      pending.push({
        key: `${root}\0${diagnostic.code}\0${diagnostic.item ?? ""}\0${diagnostic.message}`,
        diagnostic,
        root,
      })
    const flush = Effect.fn("KiloAgentPlugins.flush")(function* () {
      const current = pending.splice(0)
      const keys = new Set(current.map((item) => item.key))
      for (const item of current) {
        if (state.reported.has(item.key)) continue
        const fields = {
          plugin: item.root,
          code: item.diagnostic.code,
          ...(item.diagnostic.item ? { item: item.diagnostic.item } : {}),
        }
        yield* item.diagnostic.severity === "error"
          ? Effect.logError(`Agent Plugin: ${item.diagnostic.message}`, fields)
          : Effect.logWarning(`Agent Plugin: ${item.diagnostic.message}`, fields)
      }
      state.reported = keys
    })

    const refresh = Effect.fn("KiloAgentPlugins.refresh")(
      function* () {
        yield* FiberMap.clear(watches)
        const entries = config ? yield* config.entries() : []
        state.entries = entries.filter((entry): entry is Document => entry.type === "document")
        const agents = config?.compatibility
          ? (yield* config.compatibility()).agents
          : [path.join(global.home, ".agents")]
        const settings = KiloConfigPolicy.agentPlugins(entries)
        const directories = agents.map((root) => path.join(root, "plugins"))
        yield* Effect.forEach(directories, (directory) => watch(directory), { discard: true })
        const explicit = settings.paths.map((item) =>
          item.startsWith("~/") ? path.join(global.home, item.slice(2)) : path.resolve(ctx.location.directory, item),
        )
        yield* Effect.forEach(explicit, (item) => watch(item), { discard: true })
        const candidates = [
          ...(yield* Effect.promise(() =>
            Promise.all(
              directories.map(async (directory, index) =>
                (await children(directory)).map(
                  (child): Candidate => ({ path: child, scope: scope(agents[index]!, global.home) }),
                ),
              ),
            ),
          )).flat(),
          ...explicit.map((item): Candidate => ({ path: item, scope: "explicit" })),
        ]
        state.loaded = yield* Effect.promise(() => load(candidates, settings.disabled, dataRoot, report))
        yield* flush()
      },
      (effect) => lock.withPermit(effect),
    )

    // A failed refresh keeps the previous plugins and the watch loop alive.
    const reload = refresh().pipe(
      Effect.andThen(ctx.skill.reload()),
      Effect.andThen(ctx.mcp.reload()),
      Effect.catchCause((cause) => Effect.logError("Agent Plugins refresh failed", { cause })),
    )
    const updates = yield* PubSub.subscribe(changes)
    yield* Stream.fromSubscription(updates).pipe(
      Stream.debounce("100 millis"),
      Stream.runForEach(() => reload),
      Effect.forkScoped({ startImmediately: true }),
    )
    if (config)
      yield* config.changes().pipe(
        Stream.runForEach((update) => PubSub.publish(changes, update.path)),
        Effect.forkScoped({ startImmediately: true }),
      )
    yield* ctx.event.subscribe().pipe(
      Stream.filter((event) => event.type === "config.updated"),
      Stream.runForEach(() => reload),
      Effect.forkScoped({ startImmediately: true }),
    )
    yield* refresh().pipe(Effect.catchCause((cause) => Effect.logError("Agent Plugins failed to load", { cause })))

    yield* ctx.skill.transform((editor) => {
      for (const loaded of state.loaded) for (const skill of loaded.skills) editor.add(skill)
    })
    yield* ctx.mcp.transform((editor) => {
      // Global timeout defaults from config apply to plugin servers as they do to configured ones.
      const timeout = Object.assign(
        {},
        ...state.entries.flatMap((entry) => (entry.info.mcp?.timeout ? [entry.info.mcp.timeout] : [])),
      )
      for (const loaded of state.loaded)
        for (const [name, server] of loaded.servers) {
          if (editor.get(name)) continue
          editor.set(name, Object.keys(timeout).length ? { ...server, timeout } : server)
        }
    })
  }),
})

/**
 * Loads every candidate and keeps one plugin per name. Candidates come in increasing precedence (global, then
 * project roots nearest last, then explicit paths): a later plugin with the same name replaces an earlier one.
 */
export async function load(
  candidates: readonly Candidate[],
  disabled: readonly string[],
  dataRoot: string,
  report: (root: string, diagnostic: Diagnostic.Info) => void,
) {
  const byName = new Map<string, Loaded>()
  const roots = new Set<string>()
  for (const candidate of candidates) {
    const name = await AgentPlugin.name(candidate.path)
    if (name && disabled.includes(name)) continue
    const plugin = await AgentPlugin.load(candidate.path, { dataRoot })
    // A directory without plugin.json under a plugins/ folder is not a plugin; an explicit path must be one.
    if (candidate.scope !== "explicit" && plugin.diagnostics.some((item) => item.code === "manifest-missing")) continue
    if (roots.has(plugin.root)) continue
    roots.add(plugin.root)
    const mapped = plugin.manifest ? map(plugin, candidate.scope) : undefined
    for (const diagnostic of [...plugin.diagnostics, ...(mapped?.diagnostics ?? [])]) report(plugin.root, diagnostic)
    if (!mapped || !plugin.manifest) continue
    const previous = byName.get(plugin.manifest.name)
    if (previous)
      report(previous.plugin.root, {
        severity: "warning",
        code: "plugin-shadowed",
        message: `Plugin "${plugin.manifest.name}" at ${previous.plugin.root} is shadowed by ${plugin.root}`,
      })
    byName.set(plugin.manifest.name, mapped.loaded)
  }
  return [...byName.values()]
}

/**
 * Maps a loaded plugin to Kilo skills and MCP servers. Skill IDs and server names are namespaced by the plugin
 * name so plugins never collide with each other or with user config.
 */
export function map(plugin: AgentPlugin.Loaded, scope: Loaded["scope"]) {
  const name = plugin.manifest!.name
  const diagnostics: Diagnostic.Info[] = []
  const skills = plugin.skills.map((skill) =>
    Skill.Info.make({
      id: Skill.ID.make(`${name}:${skill.name}`),
      name: Skill.Name.make(skill.name),
      description: skill.description,
      // Agent Skills metadata values are strings; the opencode key uses the same opt-out as config skills.
      ...(skill.metadata?.["opencode/autoinvoke"] === "false" ? { autoinvoke: false } : {}),
      path: Skill.Info.fields.path.make(skill.path),
      content: skill.body,
    }),
  )
  const servers = new Map<string, Mcp.ServerConfig>()
  for (const server of plugin.servers) {
    const id = `${name}:${server.name}`
    if (server.transport === "stdio") {
      servers.set(
        id,
        new Mcp.LocalConfig({
          type: "local",
          command: [server.command, ...server.args],
          cwd: server.cwd,
          environment: { ...server.env },
        }),
      )
      continue
    }
    // The MCP client sends configured headers through Bun fetch, which keeps them on a cross-origin redirect.
    // Agent Plugins forbids that without user authorization (spec §7.2.1), so such servers are not loaded; a user
    // can still configure one directly under mcp.servers.
    if (Object.keys(server.headers).length) {
      diagnostics.push({
        severity: "error",
        code: "server-unsupported",
        component: "mcp",
        item: server.name,
        message: `Skipped server "${server.name}": remote servers with headers are not supported yet, because the MCP client could forward the headers to another origin on a redirect. Configure it under mcp.servers.${JSON.stringify(id)} to use it`,
      })
      continue
    }
    servers.set(id, new Mcp.RemoteConfig({ type: "remote", url: server.url }))
  }
  return { loaded: { plugin, scope, skills, servers }, diagnostics }
}

function scope(root: string, home: string): Loaded["scope"] {
  return path.resolve(root) === path.join(home, ".agents") ? "global" : "project"
}

async function children(directory: string) {
  const names = await readdir(directory).catch(() => [] as string[])
  const paths = names.toSorted().map((name) => path.join(directory, name))
  const kinds = await Promise.all(paths.map((item) => Paths.kind(item)))
  return paths.filter((_, index) => kinds[index] === "directory")
}

/** The target itself when it exists, else the first missing path below the nearest existing ancestor. */
async function nearest(target: string): Promise<string | { missing: string } | undefined> {
  if ((await Paths.kind(target)) === "directory") return target
  const parent = path.dirname(target)
  if (parent === target) return
  const found = await nearest(parent)
  if (!found) return
  return typeof found === "string" ? { missing: target } : found
}
