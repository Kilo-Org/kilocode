export * as KiloAgentPlugins from "./index"

import { Config } from "@opencode/core/config"
import { Watcher } from "@opencode/core/filesystem/watcher"
import { KiloConfigPolicy } from "@opencode/core/kilocode/config/policy"
import { define } from "@opencode/plugin/effect/plugin"
import type { RpcCallContext } from "@opencode/plugin/effect/rpc"
import { Directory, Document } from "@opencode/schema/config"
import { KiloAgentPluginsRpc } from "@opencode/schema/kilocode/agent-plugins"
import { Mcp } from "@opencode/schema/mcp"
import { ProjectID } from "@opencode/schema/project-id"
import { Skill } from "@opencode/schema/skill"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { KiloConfigFiles } from "@opencode/util/kilocode/config/files"
import { readdir } from "node:fs/promises"
import path from "node:path"
import { Effect, FiberMap, Option, PubSub, Scope, Semaphore, Stream } from "effect"
import { McpError, MarketplaceMcp, configFile } from "../marketplace/mcp"
import type { Diagnostic } from "./diagnostic"
import { KiloExtension } from "./extension"
import { Install, InstallError } from "./install"
import type { Manifest } from "./manifest"
import { Paths } from "./paths"
import { AgentPlugin } from "./plugin"

/** A plugin that loaded, with the Kilo values its components map to. */
export interface Loaded {
  readonly plugin: AgentPlugin.Loaded
  readonly scope: "global" | "project" | "explicit"
  readonly skills: readonly Skill.Info[]
  readonly servers: ReadonlyMap<string, Mcp.ServerConfig>
}

// Recursive watches skip dependency, VCS and dot directories, as the config skill watchers do: a plugin's own
// node_modules or a server writing state into its root must not trigger refreshes.
const IGNORE = [...FSUtil.ignoreGlobs, "**/.*", "**/.*/**"]

/** Every plugin found, for the `kilocode.agent-plugins` RPC: also the rejected, disabled and shadowed ones. */
export interface Listed {
  readonly root: string
  readonly scope: Loaded["scope"]
  readonly status: KiloAgentPluginsRpc.Plugin["status"]
  readonly manifest?: Manifest.Info
  readonly skills: readonly string[]
  readonly servers: readonly string[]
  readonly removable: boolean
  readonly diagnostics: readonly Diagnostic.Info[]
}

interface Candidate {
  readonly path: string
  readonly scope: Loaded["scope"]
  /** Found in the global or opened project's `plugins/` directory, which `install` and `uninstall` manage. */
  readonly removable?: boolean
}

/**
 * Loads Agent Plugins (agent-plugins.org) and contributes their skills and MCP servers. Plugins come from the
 * `plugins/` directory of every Kilo config directory (the global one, then each project `.kilo2`, nearest last) and
 * from the `agent_plugins.paths` config setting. That directory is shared with JS plugins, which load only from a
 * child with a `server` or `index` module; a child with `plugin.json` is an Agent Plugin. User config wins: a config
 * skill with the same ID replaces a plugin skill, and a configured MCP server with the same name is never overwritten.
 * Clients install, list, enable and disable plugins through the `kilocode.agent-plugins` RPC.
 */
export const Plugin = define<Global.Service | Scope.Scope>({
  id: "kilocode.agent-plugins",
  effect: Effect.fn(function* (ctx) {
    const global = yield* Global.Service
    // Location services reach host plugins through the supervisor; a bare SDK embed has neither and gets only the
    // global config directory and no watching.
    const config = Option.getOrUndefined(yield* Effect.serviceOption(Config.Service))
    const watcher = Option.getOrUndefined(yield* Effect.serviceOption(Watcher.Service))
    const dataRoot = path.join(global.data, "agent-plugins")
    const state = {
      loaded: [] as Loaded[],
      listed: [] as Listed[],
      entries: [] as readonly Document[],
      reported: new Set<string>(),
    }
    // Install and uninstall manage the global config directory and the opened project's .kilo2, as the marketplace
    // does; an unversioned directory belongs to the global project, so its own directory is the project then.
    const project =
      ctx.location.project.id === ProjectID.global ? ctx.location.directory : ctx.location.project.directory
    const directory = (scope: KiloAgentPluginsRpc.Scope) => (scope === "global" ? global.config : project)
    const root = (scope: KiloAgentPluginsRpc.Scope) =>
      scope === "global" ? global.config : path.join(project, KiloConfigFiles.directories[0])
    // The native config files of a scope that exist: the global ones, or the project's and the opened directory's.
    // A project file that resolves outside its native locations (a committed symlink) is never written.
    const existing = async (scope: KiloAgentPluginsRpc.Scope) => {
      const directories = scope === "global" ? [global.config] : [...new Set([project, ctx.location.directory])]
      const files = new Map<string, string>()
      for (const item of directories)
        for (const candidate of KiloConfigFiles.writeCandidates(item, scope === "global")) {
          if ((await Paths.kind(candidate)) !== "file") continue
          const resolved = await MarketplaceMcp.resolveFile(candidate)
          if (
            scope === "project" &&
            !KiloConfigFiles.writeCandidates(await MarketplaceMcp.resolveFile(item), false).includes(resolved)
          )
            continue
          files.set(resolved, candidate)
        }
      return [...files.values()]
    }
    const watches = yield* FiberMap.make<string>()
    const changes = yield* PubSub.sliding<string>(1)
    const lock = Semaphore.makeUnsafe(1)

    // A missing directory is watched through its first missing path, so creating it later triggers a refresh.
    const watch = Effect.fn("KiloAgentPlugins.watch")(function* (target: string) {
      if (!watcher) return
      const found = yield* Effect.promise(() => nearest(target))
      if (!found) return
      const updates = yield* watcher.subscribe(
        typeof found === "string"
          ? { path: found, type: "directory", ignore: IGNORE }
          : { path: found.missing, type: "file" },
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
        // Config directories come in precedence order: the global directory first, then project ones, nearest last.
        // The two directories install manages are always included, so a plugin installed into a .kilo2 that did not
        // exist when config was discovered still loads.
        const discovered: string[] = config
          ? entries.filter((entry): entry is Directory => entry.type === "directory").map((entry) => entry.path)
          : []
        const same = (a: string, b: string) => path.resolve(a) === path.resolve(b)
        const withGlobal = discovered.some((entry) => same(entry, root("global")))
          ? discovered
          : [root("global"), ...discovered]
        // A missing project .kilo2 ranks just above global, below the project directories that exist.
        const roots = withGlobal.some((entry) => same(entry, root("project")))
          ? withGlobal
          : [withGlobal[0]!, root("project"), ...withGlobal.slice(1)]
        const settings = KiloConfigPolicy.agentPlugins(entries)
        const directories = roots.map((root) => path.join(root, "plugins"))
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
                  (child): Candidate => ({
                    path: child,
                    scope: path.resolve(roots[index]!) === path.resolve(global.config) ? "global" : "project",
                    removable: [root("global"), root("project")].some(
                      (managed) => path.resolve(managed) === path.resolve(roots[index]!),
                    ),
                  }),
                ),
              ),
            ),
          )).flat(),
          ...explicit.map((item): Candidate => ({ path: item, scope: "explicit" })),
        ]
        const result = yield* Effect.promise(() => load(candidates, settings.disabled, dataRoot, report))
        const changed = JSON.stringify(result.listed) !== JSON.stringify(state.listed)
        state.loaded = result.active
        state.listed = result.listed
        yield* flush()
        return changed
      },
      (effect) => lock.withPermit(effect),
    )

    const registration = yield* ctx.rpc
      .register(KiloAgentPluginsRpc.Definition, {
        list: () => Effect.sync(() => state.listed.map(describe)),
        install: (input, context) =>
          Effect.tryPromise({
            try: () =>
              Install.install({
                source:
                  input.source.type === "path"
                    ? { type: "path", path: resolve(input.source.path, global.home, ctx.location.directory) }
                    : input.source,
                root: root(input.scope),
                replace: input.replace ?? false,
              }),
            catch: (error) => error,
          }).pipe(
            Effect.tap(() => reload),
            Effect.flatMap((installed) =>
              Effect.promise(() => Paths.resolve(installed.target)).pipe(
                Effect.map((target) => state.listed.find((item) => item.root === target)),
                Effect.flatMap((found) =>
                  found
                    ? Effect.succeed(describe(found))
                    : Effect.fail(new InstallError("not_found", `Installed ${installed.name}, but it was not loaded`)),
                ),
              ),
            ),
            Effect.mapError((error) => failure(error, context)),
          ),
        uninstall: (input, context) =>
          Effect.tryPromise({
            try: () =>
              Install.uninstall({
                root: root(input.scope),
                name: input.name,
                dataRoot,
                removeData: input.removeData ?? false,
              }),
            catch: (error) => error,
          }).pipe(
            Effect.tap(() => reload),
            Effect.as({}),
            Effect.mapError((error) => failure(error, context)),
          ),
        setEnabled: (input, context) =>
          Effect.tryPromise({
            try: async () => {
              // `disabled` is the union of every config document, so enabling clears the name from each native config
              // file of both scopes; disabling writes the scope's config file, as other config writes do.
              const files = input.enabled
                ? [...(await existing("global")), ...(await existing("project"))]
                : [await configFile(directory(input.scope), input.scope === "global")]
              for (const file of files)
                await MarketplaceMcp.updateValue(file, ["agent_plugins"], (current) =>
                  withDisabled(current, input.name, input.enabled),
                )
            },
            catch: (error) => error,
          }).pipe(
            // The config watcher reloads the settings and publishes config.updated, which refreshes the plugins.
            Effect.as({}),
            Effect.mapError((error) => failure(error, context)),
          ),
      })
      .pipe(Effect.orDie)

    // A failed refresh keeps the previous plugins and the watch loop alive.
    const reload: Effect.Effect<void> = refresh().pipe(
      Effect.tap((changed) => (changed ? registration.events.emit("changed", {}).pipe(Effect.ignore) : Effect.void)),
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
 * project roots nearest last, then explicit paths): a later plugin with the same name replaces an earlier one, which
 * is then listed as shadowed. `active` feeds the skill and MCP transforms; `listed` describes every plugin found.
 */
export async function load(
  candidates: readonly Candidate[],
  disabled: readonly string[],
  dataRoot: string,
  report: (root: string, diagnostic: Diagnostic.Info) => void,
) {
  const byName = new Map<string, Loaded>()
  const roots = new Set<string>()
  const listed: Listed[] = []
  for (const candidate of candidates) {
    const base = { scope: candidate.scope, removable: candidate.removable ?? false, skills: [], servers: [] }
    const inspected = await AgentPlugin.inspect(candidate.path)
    // A disabled plugin is described from its manifest alone, so nothing is created for it.
    if (inspected.manifest && disabled.includes(inspected.manifest.name)) {
      if (inspected.root && !roots.has(inspected.root)) {
        roots.add(inspected.root)
        listed.push({
          ...base,
          root: inspected.root,
          status: "disabled",
          manifest: inspected.manifest,
          diagnostics: [],
        })
      }
      continue
    }
    const plugin = await AgentPlugin.load(candidate.path, { dataRoot })
    // A directory without plugin.json under a plugins/ folder is not a plugin; an explicit path must be one.
    if (candidate.scope !== "explicit" && plugin.diagnostics.some((item) => item.code === "manifest-missing")) continue
    if (roots.has(plugin.root)) continue
    roots.add(plugin.root)
    const mapped = plugin.manifest ? map(plugin, candidate.scope) : undefined
    const diagnostics = [...plugin.diagnostics, ...(mapped?.diagnostics ?? [])]
    for (const diagnostic of diagnostics) report(plugin.root, diagnostic)
    if (!mapped || !plugin.manifest) {
      listed.push({ ...base, root: plugin.root, status: "rejected", diagnostics })
      continue
    }
    const previous = byName.get(plugin.manifest.name)
    if (previous) {
      const shadowed: Diagnostic.Info = {
        severity: "warning",
        code: "plugin-shadowed",
        message: `Plugin "${plugin.manifest.name}" at ${previous.plugin.root} is shadowed by ${plugin.root}`,
      }
      report(previous.plugin.root, shadowed)
      const index = listed.findIndex((item) => item.root === previous.plugin.root)
      listed[index] = { ...listed[index]!, status: "shadowed", diagnostics: [...listed[index]!.diagnostics, shadowed] }
    }
    byName.set(plugin.manifest.name, mapped.loaded)
    listed.push({
      ...base,
      root: plugin.root,
      status: "loaded",
      manifest: plugin.manifest,
      skills: mapped.loaded.skills.map((skill) => skill.id),
      servers: [...mapped.loaded.servers.keys()],
      diagnostics,
    })
  }
  return { active: [...byName.values()], listed }
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
  // OAuth settings from the plugin's ai.kilo extension, for servers that need a pre-registered client.
  const extension = KiloExtension.read(plugin.manifest!.extensions, plugin.servers)
  diagnostics.push(...extension.diagnostics)
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
    const oauth = extension.oauth.get(server.name)
    servers.set(
      id,
      new Mcp.RemoteConfig({
        type: "remote",
        url: server.url,
        ...(oauth ? { oauth: new Mcp.OAuthConfig(oauth) } : {}),
      }),
    )
  }
  return { loaded: { plugin, scope, skills, servers }, diagnostics }
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

/** The RPC view of a listed plugin: manifest metadata without the schema and extension data. */
export function describe(item: Listed): KiloAgentPluginsRpc.Plugin {
  const manifest = item.manifest
  return {
    ...(manifest
      ? {
          name: manifest.name,
          ...(manifest.version ? { version: manifest.version } : {}),
          ...(manifest.description ? { description: manifest.description } : {}),
          ...(manifest.author ? { author: manifest.author } : {}),
          ...(manifest.homepage ? { homepage: manifest.homepage } : {}),
          ...(manifest.repository ? { repository: manifest.repository } : {}),
          ...(manifest.license ? { license: manifest.license } : {}),
          ...(manifest.keywords ? { keywords: manifest.keywords } : {}),
        }
      : {}),
    root: item.root,
    scope: item.scope,
    status: item.status,
    skills: item.skills,
    servers: item.servers,
    removable: item.removable,
    diagnostics: item.diagnostics,
  }
}

/**
 * The next `agent_plugins` value with `name` added to or removed from `disabled`. Other settings are kept; an empty
 * list drops `disabled`, and an empty object drops `agent_plugins`, so enabling leaves no residue.
 */
export function withDisabled(current: unknown, name: string, enabled: boolean) {
  const settings =
    current && typeof current === "object" && !Array.isArray(current) ? (current as Record<string, unknown>) : {}
  const names = Array.isArray(settings.disabled)
    ? settings.disabled.filter((item): item is string => typeof item === "string")
    : []
  if (enabled ? !names.includes(name) : names.includes(name)) return current
  const disabled = enabled ? names.filter((item) => item !== name) : [...names, name]
  const { disabled: _, ...rest } = settings
  const next = disabled.length ? { ...rest, disabled } : rest
  return Object.keys(next).length ? next : undefined
}

function resolve(item: string, home: string, directory: string) {
  return item.startsWith("~/") ? path.join(home, item.slice(2)) : path.resolve(directory, item)
}

/** Maps a failure to the RPC error the method declares; every method shares one error set. */
function failure(cause: unknown, context: RpcCallContext<typeof KiloAgentPluginsRpc.Definition.methods.install>) {
  const message = cause instanceof Error ? cause.message : String(cause)
  if (cause instanceof InstallError) return context.error(cause.reason, message)
  if (cause instanceof McpError)
    return context.error(
      cause.reason === "conflict" ? "conflict" : cause.reason === "invalid_params" ? "invalid" : "write_failed",
      message,
    )
  return context.error("write_failed", message)
}
