export * as TuiConfig from "./tui"

import path from "path"
import { mergeDeep, unique } from "remeda"
import { Cause, Context, Effect, Fiber, Layer } from "effect"
import { ConfigParse } from "@/config/parse"
import * as ConfigPaths from "@/config/paths"
import { migrateTuiConfig } from "./tui-migrate"
import { resolveHostAttentionSoundPaths } from "./tui-host-attention"
import { Flag } from "@opencode-ai/core/flag/flag"
import { isRecord } from "@opencode-ai/tui/util/record"
import { Global } from "@opencode-ai/core/global"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { CurrentWorkingDirectory } from "./tui-cwd"
import { ConfigPlugin } from "@/config/plugin"
import { TuiKeybind } from "@opencode-ai/tui/config/keybind"
import { InstallationLocal, InstallationVersion } from "@opencode-ai/core/installation/version"
import { makeRuntime } from "@opencode-ai/core/effect/runtime"
import { Filesystem } from "@/util/filesystem"
import { ConfigVariable } from "@/config/variable"
import { Npm } from "@opencode-ai/core/npm"
import { KilocodeDefaultPlugins } from "@/kilocode/config/default-plugins" // kilocode_change
import { FormatError, FormatUnknownError } from "@/cli/error"
import { TuiConfig } from "@opencode-ai/tui/config"

export const Info = TuiConfig.Info
export type Info = TuiConfig.Info

type Acc = {
  result: Info
  plugin_origins: ConfigPlugin.Origin[]
}

export type Resolved = TuiConfig.Resolved

export type HostMetadata = {
  plugin_origins?: ConfigPlugin.Origin[]
}

export interface Interface {
  readonly get: () => Effect.Effect<Resolved>
  readonly info: () => Effect.Effect<Info> // kilocode_change - editable config for Kilo console
  readonly pluginOrigins: () => Effect.Effect<ConfigPlugin.Origin[]>
  readonly waitForDependencies: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/TuiConfig") {}

function pluginScope(file: string, ctx: { directory: string }): ConfigPlugin.Scope {
  if (Filesystem.contains(ctx.directory, file)) return "local"
  // if (ctx.worktree !== "/" && Filesystem.contains(ctx.worktree, file)) return "local"
  return "global"
}

function normalize(raw: Record<string, unknown>) {
  const data = { ...raw }
  if (!("tui" in data)) return data
  if (!isRecord(data.tui)) {
    delete data.tui
    return data
  }

  const tui = data.tui
  delete data.tui
  return {
    ...tui,
    ...data,
  }
}

function dropUnknownKeybinds(input: Record<string, unknown>) {
  if (!isRecord(input.keybinds)) return input

  const invalid = TuiKeybind.unknownKeys(input.keybinds)
  if (!invalid.length) return input

  return {
    ...input,
    keybinds: Object.fromEntries(Object.entries(input.keybinds).filter(([key]) => !invalid.includes(key))),
  }
}

const loadState = Effect.fn("TuiConfig.loadState")(function* (ctx: { directory: string }) {
  const afs = yield* FSUtil.Service
  let appliedOrder = 0

  const resolvePlugins = (config: Info, configFilepath: string): Effect.Effect<Info> =>
    Effect.gen(function* () {
      const plugins = config.plugin
      if (!plugins) return config
      return {
        ...config,
        plugin: yield* Effect.forEach(plugins, (plugin) =>
          Effect.promise(() => ConfigPlugin.resolvePluginSpec(plugin as ConfigPlugin.Origin["spec"], configFilepath)),
        ),
      }
    })

  // kilocode_change start - trusted gates {env:}; fileScope confines untrusted {file:} reads
  const load = (
    text: string,
    configFilepath: string,
    trusted: boolean,
    fileScope?: ConfigVariable.FileScope,
  ): Effect.Effect<Info> =>
    // kilocode_change end
    Effect.gen(function* () {
      // kilocode_change start - only trusted tui config resolves {env:}; untrusted {file:} confined to fileScope
      const expanded = yield* Effect.promise(() =>
        ConfigVariable.substitute({ text, type: "path", path: configFilepath, missing: "empty", trusted, fileScope }),
      )
      // kilocode_change end
      const data = ConfigParse.jsonc(expanded, configFilepath)
      if (!isRecord(data)) return {} as Info
      // Flatten a nested "tui" key so users who wrote `{ "tui": { ... } }` inside tui.json
      // (mirroring the old opencode.json shape) still get their settings applied.
      const normalized = dropUnknownKeybinds(normalize(data))
      const parsed = ConfigParse.schema(Info, normalized, configFilepath)
      const validated = parsed.attention?.sounds
        ? {
            ...parsed,
            attention: {
              ...parsed.attention,
              sounds: resolveHostAttentionSoundPaths(path.dirname(configFilepath), parsed.attention.sounds),
            },
          }
        : parsed
      return yield* resolvePlugins(validated, configFilepath)
    }).pipe(
      // catchCause (not tapErrorCause + orElseSucceed) because JSONC parsing and validation
      // can sync-throw — those become defects, which orElseSucceed wouldn't catch.
      Effect.catchCause((cause) =>
        Effect.logWarning("skipping invalid tui config", {
          path: configFilepath,
          reason: FormatError(Cause.squash(cause)) ?? FormatUnknownError(Cause.squash(cause)),
        }).pipe(Effect.as({} as Info)),
      ),
    )

  // kilocode_change start - trusted + fileScope threaded to load
  const loadFile = (filepath: string, trusted: boolean, fileScope?: ConfigVariable.FileScope): Effect.Effect<Info> =>
    // kilocode_change end
    Effect.gen(function* () {
      // Silent-swallow non-NotFound read errors (perms, EISDIR, IO) → log + skip.
      // Matches how parse/schema/plugin failures in load() are handled — every
      // broken-config path degrades gracefully rather than crashing TUI startup.
      const text = yield* afs.readFileStringSafe(filepath).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("failed to read tui config", {
            path: filepath,
            reason: FormatError(Cause.squash(cause)) ?? FormatUnknownError(Cause.squash(cause)),
          }).pipe(Effect.as(undefined)),
        ),
      )
      if (!text) return {} as Info
      yield* Effect.logInfo("loading tui config", { path: filepath })
      return yield* load(text, filepath, trusted, fileScope) // kilocode_change
    })

  // kilocode_change start - trusted + fileScope threaded to loadFile
  const mergeFile = (acc: Acc, file: string, trusted: boolean, fileScope?: ConfigVariable.FileScope) =>
    // kilocode_change end
    Effect.gen(function* () {
      const data = yield* loadFile(file, trusted, fileScope) // kilocode_change
      if (Object.keys(data).length) {
        appliedOrder += 1
        yield* Effect.logInfo("applying tui config", { path: file, order: appliedOrder })
      }
      acc.result = mergeDeep(acc.result, data)
      if (!data.plugin?.length) return

      const scope = pluginScope(file, ctx)
      const plugins = ConfigPlugin.deduplicatePluginOrigins([
        ...acc.plugin_origins,
        ...data.plugin.map((spec) => ({ spec: spec as ConfigPlugin.Origin["spec"], scope, source: file })),
      ])
      acc.result = {
        ...acc.result,
        plugin: plugins.map((item) => item.spec),
      }
      acc.plugin_origins = plugins
    })

  // kilocode_change start - discover canonical and legacy Kilo config directories
  // Every config dir we may read from: global config, .kilo and legacy .kilocode
  // folders between cwd and home, and KILO_CONFIG_DIR.
  // kilocode_change end
  const directories = yield* ConfigPaths.directories(ctx.directory)
  yield* Effect.promise(() => migrateTuiConfig({ directories, cwd: ctx.directory }))

  const projectFiles = Flag.KILO_DISABLE_PROJECT_CONFIG ? [] : yield* ConfigPaths.files("tui", ctx.directory)

  const acc: Acc = {
    result: {},
    plugin_origins: [],
  }

  // 1. Global tui config (lowest precedence).
  for (const file of ConfigPaths.fileInDirectory(Global.Path.config, "tui")) {
    yield* mergeFile(acc, file, true) // kilocode_change - global config is trusted
  }

  // 2. Explicit KILO_TUI_CONFIG override, if set.
  if (Flag.KILO_TUI_CONFIG) {
    const configFile = Flag.KILO_TUI_CONFIG
    yield* mergeFile(acc, configFile, true) // kilocode_change - explicit env-provided path is trusted
    yield* Effect.logDebug("loaded custom tui config", { path: configFile })
  }

  // 3. Project tui files, applied root-first so the closest file wins.
  for (const file of projectFiles) {
    yield* mergeFile(acc, file, false, { root: ctx.directory, source: file }) // kilocode_change - untrusted, {file:} confined to project
  }

  // kilocode_change start - load tui.json from supported Kilo config directories
  // 4. `.kilo` and legacy `.kilocode` directories (and KILO_CONFIG_DIR)
  // discovered while walking up the tree. Also returned below so callers can
  // install plugin dependencies from each location.
  const dirs = unique(directories).filter(
    (dir) => dir.endsWith(".kilo") || dir.endsWith(".kilocode") || dir === Flag.KILO_CONFIG_DIR,
  )
  // kilocode_change end

  for (const dir of dirs) {
    // kilocode_change start - trust global (home/KILO_CONFIG_DIR) dirs like config.ts; in-repo .kilo/.kilocode stay untrusted
    const trusted = pluginScope(dir, ctx) === "global"
    const fileScope = trusted ? undefined : { root: ctx.directory, source: dir }
    for (const file of ConfigPaths.fileInDirectory(dir, "tui")) {
      yield* mergeFile(acc, file, trusted, fileScope)
    }
    // kilocode_change end
  }

  const result = TuiConfig.resolve(
    {
      ...acc.result,
    },
    {
      terminalSuspend: process.platform !== "win32",
    },
  )
  if (acc.result.attention?.sound_pack === undefined) result.attention.sound_pack = "kilo.default" // kilocode_change - preserve Kilo's default sound pack

  // kilocode_change start - inject Kilo default plugins to keep TUI aligned with server config
  const defaults = KilocodeDefaultPlugins.apply(
    { plugin: result.plugin ? [...result.plugin] : undefined, plugin_origins: acc.plugin_origins },
    { disabled: Flag.KILO_DISABLE_DEFAULT_PLUGINS },
  )
  const config = { ...result, plugin: defaults.plugin }
  // kilocode_change end

  return {
    config,
    info: { ...acc.result, plugin: defaults.plugin }, // kilocode_change - include applied Kilo defaults
    pluginOrigins: defaults.plugin_origins ?? [], // kilocode_change - exclude builtins from dependency installation
    dirs: result.plugin?.length ? dirs : [],
  }
})

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const directory = yield* CurrentWorkingDirectory
    const npm = yield* Npm.Service
    const data = yield* loadState({ directory })
    const deps = yield* Effect.forEach(
      data.dirs,
      (dir) =>
        npm
          .install(dir, {
            add: [
              {
                name: "@kilocode/plugin",
                version: InstallationLocal ? undefined : InstallationVersion,
              },
            ],
          })
          .pipe(Effect.forkScoped),
      {
        concurrency: "unbounded",
      },
    )

    const get = Effect.fn("TuiConfig.get")(() => Effect.succeed(data.config))
    const info = Effect.fn("TuiConfig.info")(() => Effect.succeed(data.info)) // kilocode_change
    const pluginOrigins = Effect.fn("TuiConfig.pluginOrigins")(() => Effect.succeed(data.pluginOrigins))

    const waitForDependencies = Effect.fn("TuiConfig.waitForDependencies")(() =>
      Effect.forEach(deps, Fiber.join, { concurrency: "unbounded" }).pipe(Effect.ignore(), Effect.asVoid),
    )
    return Service.of({ get, info, pluginOrigins, waitForDependencies }) // kilocode_change
  }).pipe(Effect.withSpan("TuiConfig.layer")),
)

export const defaultLayer = layer.pipe(Layer.provide(Npm.defaultLayer), Layer.provide(FSUtil.defaultLayer))

const { runPromise } = makeRuntime(Service, defaultLayer)

export async function waitForDependencies() {
  await runPromise((svc) => svc.waitForDependencies())
}

export async function get() {
  return runPromise((svc) => svc.get())
}

export async function info() {
  return runPromise((svc) => svc.info())
}

export async function pluginOrigins() {
  return runPromise((svc) => svc.pluginOrigins())
}
