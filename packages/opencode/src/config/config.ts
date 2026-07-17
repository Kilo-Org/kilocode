import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { httpClient } from "@opencode-ai/core/effect/layer-node-platform"
import { serviceUse } from "@opencode-ai/core/effect/service-use"
import path from "path"
import { pathToFileURL } from "url"
import os from "os"
import { mergeDeep } from "remeda"
import { Global } from "@opencode-ai/core/global"
import fsNode from "fs/promises"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Auth } from "../auth"
import { Env } from "../env"
import { applyEdits, findNodeAtLocation, modify, parseTree } from "jsonc-parser" // kilocode_change - parseTree/findNodeAtLocation used in patchJsonc
import { InstallationLocal, InstallationVersion } from "@opencode-ai/core/installation/version"
import { existsSync } from "fs"
// kilocode_change start
import { GlobalBus } from "@/bus/global"
import { Event } from "../server/event"
// kilocode_change end
import { Account } from "@/account/account"
import { isRecord } from "@/util/record"
import type { ConsoleState } from "@opencode-ai/core/v1/config/console-state"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { InstanceState } from "@/effect/instance-state"
import { Context, Duration, Effect, Exit, Fiber, Layer, Option, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http"
import { EffectFlock } from "@opencode-ai/core/util/effect-flock"
import { containsPath, type InstanceContext } from "../project/instance-context"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { RemoteAuthError } from "@opencode-ai/core/v1/config/error"
import { ConfigPermissionV1 } from "@opencode-ai/core/v1/config/permission"
import { ConfigPluginV1 } from "@opencode-ai/core/v1/config/plugin"
import { ConfigAgent } from "./agent"
import { ConfigCommand } from "./command"
import { ConfigManaged } from "./managed"
import { ConfigParse } from "./parse"
import { ConfigPaths } from "./paths"
import { ConfigPlugin } from "./plugin"
import { ConfigVariable } from "./variable"
import { Npm } from "@opencode-ai/core/npm"
import z from "zod" // kilocode_change - Kilo config compatibility schemas
// kilocode_change start
import { ZodOverride } from "@opencode-ai/core/effect-zod"
import { KilocodeConfig } from "../kilocode/config/config"
import { primaryPaths } from "../kilocode/primary-worktree"
import { Git } from "@/git"
import { KilocodeDefaultPlugins } from "@/kilocode/config/default-plugins"
import { KilocodeGlobalConfigStamp } from "@/kilocode/config/global-stamp"
import { SandboxConfig } from "@/kilocode/sandbox/config"
import type { KilocodeMarkdown } from "@/kilocode/config/markdown"
import {
  IndexingConfig as KiloIndexingConfig,
  IndexingSchema as KiloIndexingSchema,
} from "@kilocode/kilo-indexing/config"
import { unique } from "remeda"
// kilocode_change end
import { withTransientReadRetry } from "@/util/effect-http-client"
import * as Log from "@opencode-ai/core/util/log" // kilocode_change

const log = Log.create({ service: "config" }) // kilocode_change

// Custom merge function that concatenates array fields instead of replacing them
// Keep remeda's deep conditional merge type out of hot config-loading paths; TS profiling showed it dominates here.
function mergeConfig(target: Info, source: Info): Info {
  return mergeDeep(target, source) as Info
}

function mergeConfigConcatArrays(target: Info, source: Info): Info {
  const merged = mergeConfig(target, source)
  if (target.instructions && source.instructions) {
    merged.instructions = Array.from(new Set([...target.instructions, ...source.instructions]))
  }
  return merged
}

function normalizeLoadedConfig(data: unknown, source: string) {
  if (!isRecord(data)) return data
  const copy = KilocodeConfig.retireIndexingFlag({ ...data }, source) // kilocode_change
  const hadLegacy = "theme" in copy || "keybinds" in copy || "tui" in copy
  if (!hadLegacy) return copy
  delete copy.theme
  delete copy.keybinds
  delete copy.tui
  log.warn("tui keys in the main config are deprecated; move them to tui.json", { path: source }) // kilocode_change
  return copy
}

// kilocode_change start
export const Warning = z.object({
  path: z.string(),
  message: z.string(),
  detail: z.string().optional(),
})
export type Warning = z.infer<typeof Warning>

const { caught: caughtWarning } = KilocodeConfig
// kilocode_change end

async function substituteWellKnownRemoteConfig(input: {
  value: unknown
  dir: string
  source: string
  env: Record<string, string>
}) {
  if (!isRecord(input.value) || typeof input.value.url !== "string") return undefined

  const url = await ConfigVariable.substitute({
    text: input.value.url,
    type: "virtual",
    dir: input.dir,
    source: input.source,
    env: input.env,
    trusted: true, // kilocode_change - well-known org config is a trusted source
  })
  const headers = isRecord(input.value.headers)
    ? Object.fromEntries(
        await Promise.all(
          Object.entries(input.value.headers)
            .filter((entry): entry is [string, string] => typeof entry[1] === "string")
            .map(async ([key, value]) => [
              key,
              await ConfigVariable.substitute({
                text: value,
                type: "virtual",
                dir: input.dir,
                source: input.source,
                env: input.env,
                trusted: true, // kilocode_change - well-known org config is a trusted source
              }),
            ]),
        ),
      )
    : undefined

  return { url, headers }
}

async function resolveLoadedPlugins<T extends { plugin?: ConfigPluginV1.Spec[] }>(config: T, filepath: string) {
  if (!config.plugin) return config
  for (let i = 0; i < config.plugin.length; i++) {
    // Normalize path-like plugin specs while we still know which config file declared them.
    // This prevents `./plugin.ts` from being reinterpreted relative to some later merge location.
    config.plugin[i] = await ConfigPlugin.resolvePluginSpec(config.plugin[i], filepath)
  }
  return config
}

export type Info = ConfigV1.Info & {
  // kilocode_change - keep exported so existing Config.Info call sites don't need repo-wide migration to ConfigV1.Info
  // plugin_origins is derived state, not a persisted config field. It keeps each winning plugin spec together
  // with the file and scope it came from so later runtime code can make location-sensitive decisions.
  plugin_origins?: ConfigPlugin.Origin[]
  // kilocode_change start - derived provenance for markdown paths selected by config
  instruction_origins?: Record<string, KilocodeMarkdown.Source>
  skill_path_origins?: Record<string, KilocodeMarkdown.Source>
  // kilocode_change end
}

// kilocode_change - value re-export for the call sites that pass Config.Info as a schema
export const Info = ConfigV1.Info

type State = {
  config: Info
  directories: string[]
  deps: Fiber.Fiber<void>[]
  warnings: Warning[] // kilocode_change
  consoleState: ConsoleState
}

export interface Interface {
  readonly get: () => Effect.Effect<Info>
  readonly getGlobal: () => Effect.Effect<Info>
  readonly getConsoleState: () => Effect.Effect<ConsoleState>
  readonly update: (config: Info) => Effect.Effect<void>
  // kilocode_change start
  readonly updateGlobal: (
    config: Info,
    options?: { dispose?: boolean },
  ) => Effect.Effect<{ info: Info; changed: boolean }>
  // kilocode_change end
  readonly invalidate: () => Effect.Effect<void>
  readonly directories: () => Effect.Effect<string[]>
  readonly waitForDependencies: () => Effect.Effect<void>
  readonly warnings: () => Effect.Effect<Warning[]> // kilocode_change
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Config") {}

export const use = serviceUse(Service)

function globalConfigFile() {
  // kilocode_change start
  const candidates = ["kilo.jsonc", "kilo.json", "opencode.jsonc", "opencode.json", "config.json"].map((file) =>
    // kilocode_change end
    path.join(Global.Path.config, file),
  )
  for (const file of candidates) {
    if (existsSync(file)) return file
  }
  return candidates[0]
}

function patchJsonc(input: string, patch: unknown, path: string[] = []): string {
  if (!isRecord(patch)) {
    const edits = modify(input, path, patch === null ? undefined : patch, {
      // kilocode_change
      formattingOptions: {
        insertSpaces: true,
        tabSize: 2,
      },
    })
    return applyEdits(input, edits)
  }

  // kilocode_change start — when the existing JSONC node at this path is a
  // scalar (e.g. permission.bash is "ask" as a string), jsonc-parser cannot
  // add child keys to it. Detect this case and replace the whole node with
  // the patch object in a single modify() call instead of recursing.
  // For permission keys, promote the scalar to { "*": scalarValue } so the
  // wildcard default is preserved. For other keys, replace directly.
  if (path.length > 0) {
    const tree = parseTree(input)
    const node = tree && findNodeAtLocation(tree, path)
    if (node && node.type !== "object") {
      const isPermissionKey = path[0] === "permission" && path.length === 2
      const replacement = isPermissionKey ? { "*": node.value, ...patch } : patch
      const edits = modify(input, path, replacement, {
        formattingOptions: { insertSpaces: true, tabSize: 2 },
      })
      return applyEdits(input, edits)
    }
  }
  // kilocode_change end

  return Object.entries(patch).reduce((result, [key, value]) => patchJsonc(result, value, [...path, key]), input)
}

function writable(info: Info) {
  // kilocode_change start - derived provenance is runtime-only and must never be persisted
  const {
    plugin_origins: _plugin_origins,
    instruction_origins: _instruction_origins,
    skill_path_origins: _skill_path_origins,
    ...next
  } = info
  // kilocode_change end
  return next
}

function writableGlobal(info: Info) {
  const next = writable(info)
  // When a user changes config from a value back to default in the Desktop app, we don't want to leave a blank `"shell": "",` key
  if ("shell" in next && next.shell === "") return { ...next, shell: undefined }
  return next
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const authSvc = yield* Auth.Service
    const accountSvc = yield* Account.Service
    const env = yield* Env.Service
    const npmSvc = yield* Npm.Service
    const http = yield* HttpClient.HttpClient
    const git = yield* Git.Service // kilocode_change
    const flock = yield* EffectFlock.Service // kilocode_change - serialize global config read-merge-write updates

    const readConfigFile = (filepath: string) => fs.readFileStringSafe(filepath).pipe(Effect.orDie)

    const fetchRemoteJson = Effect.fnUntraced(function* <S extends Schema.Top>(
      url: string,
      headers: Record<string, string> | undefined,
      schema: S,
      loginOrigin: string,
    ) {
      const response = yield* HttpClient.filterStatusOk(withTransientReadRetry(http))
        .execute(
          HttpClientRequest.get(url).pipe(HttpClientRequest.acceptJson, HttpClientRequest.setHeaders(headers ?? {})),
        )
        .pipe(
          Effect.catch((error) => Effect.die(new Error(`failed to fetch remote config from ${url}: ${String(error)}`))),
        )
      const body = yield* response.text.pipe(
        Effect.catch((error) => Effect.die(new Error(`failed to read remote config from ${url}: ${String(error)}`))),
      )
      // An auth proxy can answer with an HTML login page at HTTP 200 (passes filterStatusOk); treat it as a re-auth error, not a decode failure.
      const contentType = (response.headers["content-type"] ?? "").toLowerCase()
      if (contentType.includes("html") || /^\s*<!doctype|^\s*<html/i.test(body)) {
        return yield* Effect.die(new RemoteAuthError({ url: loginOrigin, remote: url }))
      }
      return yield* Schema.decodeEffect(Schema.fromJsonString(schema))(body).pipe(
        Effect.catch((error) => Effect.die(new Error(`failed to decode remote config from ${url}: ${String(error)}`))),
      )
    })

    const loadConfig = Effect.fnUntraced(function* (
      text: string,
      options: { path: string } | { dir: string; source: string },
      env?: Record<string, string>,
      // kilocode_change start - trusted allows {env:}; fileScope confines untrusted {file:} reads to a root
      trusted?: boolean,
      fileScope?: ConfigVariable.FileScope,
      // kilocode_change end
    ) {
      const source = "path" in options ? options.path : options.source
      const expanded = yield* Effect.promise(() =>
        ConfigVariable.substitute(
          "path" in options
            ? { text, type: "path", path: options.path, env, trusted, fileScope } // kilocode_change
            : { text, type: "virtual", ...options, env, trusted, fileScope }, // kilocode_change
        ),
      )
      const parsed = ConfigParse.jsonc(expanded, source)
      const data = ConfigParse.schema(ConfigV1.Info, normalizeLoadedConfig(parsed, source), source)
      if (!("path" in options)) return data

      yield* Effect.promise(() => resolveLoadedPlugins(data, options.path))
      if (!data.$schema) {
        // kilocode_change start
        data.$schema = "https://app.kilo.ai/config.json"
        const updated = text.replace(/^\s*\{/, '{\n  "$schema": "https://app.kilo.ai/config.json",')
        // kilocode_change end
        yield* fs.writeFileString(options.path, updated).pipe(Effect.catch(() => Effect.void))
      }
      return data
    })

    const loadFile = Effect.fnUntraced(function* (
      filepath: string,
      env?: Record<string, string>,
      trusted?: boolean, // kilocode_change
      fileScope?: ConfigVariable.FileScope, // kilocode_change
    ) {
      yield* Effect.logInfo("loading", { path: filepath })
      const text = yield* readConfigFile(filepath)
      if (!text) return {} as Info
      return yield* loadConfig(text, { path: filepath }, env, trusted, fileScope) // kilocode_change
    })

    let globalStamp = "" // kilocode_change

    const loadGlobal = Effect.fnUntraced(function* (env?: Record<string, string>) {
      // kilocode_change start
      yield* Effect.promise(() => KilocodeConfig.migrateBashPermission())
      globalStamp = yield* KilocodeGlobalConfigStamp.read(fs, Global.Path.config)
      // kilocode_change end
      let result: Info = {}
      // Seed the default global config with the schema for editor completion, but avoid writing when the user
      // explicitly routes config through env-provided paths or content.
      if (!Flag.KILO_CONFIG && !Flag.KILO_CONFIG_DIR && !Flag.KILO_CONFIG_CONTENT) {
        const file = globalConfigFile()
        if (!existsSync(file)) {
          yield* fs
            .writeWithDirs(file, JSON.stringify({ $schema: "https://app.kilo.ai/config.json" }, null, 2))
            .pipe(Effect.catch(() => Effect.void))
        }
      }
      // kilocode_change - global config is user-owned and trusted to resolve {file:}/{env:} tokens
      result = mergeConfig(result, yield* loadFile(path.join(Global.Path.config, "config.json"), env, true))
      result = mergeConfig(result, yield* loadFile(path.join(Global.Path.config, "opencode.json"), env, true))
      result = mergeConfig(result, yield* loadFile(path.join(Global.Path.config, "opencode.jsonc"), env, true))
      // kilocode_change start
      result = mergeConfig(result, yield* loadFile(path.join(Global.Path.config, "kilo.json"), env, true))
      result = mergeConfig(result, yield* loadFile(path.join(Global.Path.config, "kilo.jsonc"), env, true))
      // kilocode_change end

      const legacy = path.join(Global.Path.config, "config")
      if (existsSync(legacy)) {
        yield* Effect.promise(() =>
          import(pathToFileURL(legacy).href, { with: { type: "toml" } })
            .then(async (mod) => {
              const { provider, model, ...rest } = mod.default
              if (provider && model) result.model = `${provider}/${model}`
              result["$schema"] = "https://app.kilo.ai/config.json" // kilocode_change
              result = mergeConfig(result, rest)
              await fsNode.writeFile(path.join(Global.Path.config, "config.json"), JSON.stringify(result, null, 2))
              await fsNode.unlink(legacy)
            })
            .catch(() => {}),
        )
      }

      globalStamp = yield* KilocodeGlobalConfigStamp.read(fs, Global.Path.config) // kilocode_change
      return result
    })

    const [cachedGlobal, invalidateGlobal] = yield* Effect.cachedInvalidateWithTTL(
      loadGlobal().pipe(
        Effect.tapError((error) =>
          Effect.logError("failed to load global config, using defaults", { error: String(error) }),
        ),
        Effect.orElseSucceed((): Info => ({})),
      ),
      Duration.infinity,
    )

    // kilocode_change start - detect global config edits made by other Kilo processes
    const refreshGlobal = Effect.fnUntraced(function* () {
      const stamp = yield* KilocodeGlobalConfigStamp.read(fs, Global.Path.config)
      if (!globalStamp || stamp === globalStamp) return false
      // Keep globalStamp tied to config that loadGlobal completed. Advancing it
      // before invalidation reloads can hide a stale cached value from the next check.
      yield* invalidateGlobal
      return true
    })
    // kilocode_change end

    const getGlobal = Effect.fn("Config.getGlobal")(function* () {
      yield* refreshGlobal() // kilocode_change
      return yield* cachedGlobal
    })

    const ensureGitignore = Effect.fn("Config.ensureGitignore")(function* (dir: string) {
      const gitignore = path.join(dir, ".gitignore")
      const hasIgnore = yield* fs.existsSafe(gitignore)
      if (!hasIgnore) {
        yield* fs
          .writeFileString(
            gitignore,
            // kilocode_change start - added pnpm-lock.yaml, yarn.lock, agent-manager.json (not in upstream)
            [
              "node_modules",
              "package.json",
              "package-lock.json",
              "pnpm-lock.yaml",
              "bun.lock",
              "yarn.lock",
              ".gitignore",
              "agent-manager.json",
            ].join("\n"),
            // kilocode_change end
          )
          .pipe(
            Effect.catchIf(
              (e) => e.reason._tag === "PermissionDenied" || e.reason._tag === "NotFound", // kilocode_change - also ignore NotFound (broken symlink/junction on Windows)
              () => Effect.void,
            ),
          )
      }
    })

    const loadInstanceState = Effect.fn("Config.loadInstanceState")(
      function* (ctx: InstanceContext) {
        // kilocode_change start - warning accumulator and legacy Kilo config
        const warnings: Warning[] = []
        // Untrusted project config may only read files inside this root (worktree, or directory for non-git projects).
        const projectRoot = ctx.worktree === "/" ? ctx.directory : ctx.worktree
        const auth = yield* authSvc.all().pipe(Effect.orDie)

        let result: Info = {}
        const legacy = yield* Effect.promise(() =>
          KilocodeConfig.loadLegacyConfigs({
            projectDir: ctx.directory,
            merge: mergeConfigConcatArrays,
          }),
        )
        result = mergeConfigConcatArrays(result, legacy.config)
        // Legacy rules are discovered from fixed global/project directories, so their paths safely identify the
        // source boundary even though the migrator returns them as one merged instruction list.
        result.instruction_origins = Object.fromEntries(
          (legacy.config.instructions ?? []).map((item) => {
            const trusted = !containsPath(item, ctx)
            return [item, { trusted, source: item, root: trusted ? undefined : projectRoot }]
          }),
        )
        warnings.push(...legacy.warnings)

        const orgModes = yield* Effect.promise(() => KilocodeConfig.loadOrganizationModes(auth))
        if (Object.keys(orgModes.agents).length > 0) {
          result = mergeConfigConcatArrays(result, { agent: orgModes.agents })
        }
        warnings.push(...orgModes.warnings)
        // kilocode_change end

        const authEnv: Record<string, string> = {}
        const consoleManagedProviders = new Set<string>()
        let activeOrgName: string | undefined

        const pluginScopeForSource = Effect.fnUntraced(function* (source: string) {
          if (source.startsWith("http://") || source.startsWith("https://")) return "global"
          if (source === "KILO_CONFIG_CONTENT") return "local"
          if (containsPath(source, ctx)) return "local"
          return "global"
        })

        const mergePluginOrigins = Effect.fnUntraced(function* (
          source: string,
          // mergePluginOrigins receives raw Specs from one config source, before provenance for this merge step
          // is attached.
          list: ConfigPluginV1.Spec[] | undefined,
          // Scope can be inferred from the source path, but some callers already know whether the config should
          // behave as global or local and can pass that explicitly.
          kind?: ConfigPlugin.Scope,
        ) {
          if (!list?.length) return
          const hit = kind ?? (yield* pluginScopeForSource(source))
          // Merge newly seen plugin origins with previously collected ones, then dedupe by plugin identity while
          // keeping the winning source/scope metadata for downstream installs, writes, and diagnostics.
          const plugins = ConfigPlugin.deduplicatePluginOrigins([
            ...(result.plugin_origins ?? []),
            ...list.map((spec) => ({ spec, source, scope: hit })),
          ])
          result.plugin = plugins.map((item) => item.spec)
          result.plugin_origins = plugins
        })

        // kilocode_change start
        const origins = (
          prev: Record<string, KilocodeMarkdown.Source> | undefined,
          values: readonly string[],
          trusted: boolean,
          source: string,
        ) => {
          const result = { ...prev }
          for (const value of values) {
            if (result[value]?.trusted) continue
            result[value] = { trusted, source, root: trusted ? undefined : projectRoot }
          }
          return result
        }

        const merge = Effect.fnUntraced(function* (
          source: string,
          next: Info,
          kind?: ConfigPlugin.Scope,
          sourceTrusted?: boolean,
        ) {
          const scope = kind ?? (yield* pluginScopeForSource(source))
          const trusted = sourceTrusted ?? scope === "global"
          const scoped = KilocodeConfig.scopeIndexing(SandboxConfig.scope(next, scope), scope)
          result = mergeConfigConcatArrays(result, scoped)
          if (next.instructions?.length) {
            result.instruction_origins = origins(result.instruction_origins, next.instructions, trusted, source)
          }
          if (next.skills?.paths?.length) {
            result.skill_path_origins = origins(result.skill_path_origins, next.skills.paths, trusted, source)
          }
          return yield* mergePluginOrigins(source, scoped.plugin, scope)
        })
        // kilocode_change end

        for (const [key, value] of Object.entries(auth)) {
          if (value.type === "wellknown") {
            const url = key.replace(/\/+$/, "")
            authEnv[value.key] = value.token
            const wellknownURL = `${url}/.well-known/opencode`
            // kilocode_change start
            const source = wellknownURL
            yield* Effect.gen(function* () {
              yield* Effect.logDebug("fetching remote config", { url: wellknownURL })
              const wellknown = yield* fetchRemoteJson(wellknownURL, undefined, ConfigV1.WellKnown, url)
              const remote = yield* Effect.promise(() =>
                substituteWellKnownRemoteConfig({
                  value: wellknown.remote_config,
                  dir: url,
                  source: wellknownURL,
                  env: authEnv,
                }),
              )
              const fetchedConfig = remote
                ? yield* Effect.gen(function* () {
                    yield* Effect.logDebug("fetching remote config", { url: remote.url })
                    const data = yield* fetchRemoteJson(remote.url, remote.headers, Schema.Json, url)
                    if (isRecord(data) && isRecord(data.config)) return data.config
                    if (isRecord(data)) return data
                    return yield* Effect.die(
                      new Error(`failed to decode remote config from ${remote.url}: expected object`),
                    )
                  })
                : {}
              const remoteConfig = mergeConfig(isRecord(wellknown.config) ? wellknown.config : {}, fetchedConfig)
              if (!remoteConfig.$schema) remoteConfig.$schema = "https://app.kilo.ai/config.json"
              const next = yield* loadConfig(
                JSON.stringify(remoteConfig),
                {
                  dir: path.dirname(source),
                  source,
                },
                authEnv,
                true, // kilocode_change - well-known org config is a trusted source
              )
              yield* merge(source, next, "global")
              yield* Effect.logDebug("loaded remote config from well-known", { url })
            }).pipe(
              Effect.catch((err: unknown) => {
                caughtWarning(warnings, source, err)
                return Effect.logWarning("skipped remote config due to error", { url, err })
              }),
              Effect.catchDefect((err: unknown) => {
                caughtWarning(warnings, source, err)
                return Effect.logWarning("skipped remote config due to error", { url, err })
              }),
            )
            // kilocode_change end
          }
        }

        // kilocode_change start - capture global config failures as warnings
        const global = yield* (Object.keys(authEnv).length ? loadGlobal(authEnv) : getGlobal()).pipe(
          Effect.catchDefect((err: unknown) => {
            caughtWarning(warnings, "global config", err)
            return Effect.succeed({} as Info)
          }),
        )
        // kilocode_change end

        yield* merge(Global.Path.config, global, "global")

        if (Flag.KILO_CONFIG) {
          // kilocode_change start - capture KILO_CONFIG failures as warnings
          yield* merge(
            Flag.KILO_CONFIG,
            // kilocode_change - KILO_CONFIG is an explicit user-provided path, trusted for {file:}/{env:}
            yield* loadFile(Flag.KILO_CONFIG, authEnv, true).pipe(
              Effect.catchDefect((err: unknown) => {
                caughtWarning(warnings, Flag.KILO_CONFIG!, err)
                return Effect.succeed({} as Info)
              }),
            ),
            undefined,
            true,
          )
          // kilocode_change end
          yield* Effect.logDebug("loaded custom config", { path: Flag.KILO_CONFIG })
        }

        if (!Flag.KILO_DISABLE_PROJECT_CONFIG) {
          // kilocode_change start - also discover kilo.json project files
          for (const name of ["opencode", "kilo"] as const) {
            for (const file of yield* ConfigPaths.files(name, ctx.directory, ctx.worktree).pipe(Effect.orDie)) {
              yield* merge(
                file,
                // kilocode_change - project config is untrusted: {env:} rejected, {file:} confined to projectRoot
                yield* loadFile(file, authEnv, false, { root: projectRoot, source: file }).pipe(
                  Effect.catchDefect((err: unknown) => {
                    caughtWarning(warnings, file, err)
                    return Effect.succeed({} as Info)
                  }),
                ),
                "local",
              )
            }
          }
          // kilocode_change end
        }

        result.agent = result.agent || {}
        result.mode = result.mode || {}
        result.plugin = result.plugin || []

        // kilocode_change start - include config directories from the primary checkout
        const directories = yield* ConfigPaths.directories(ctx.directory, ctx.worktree)
        const primary = Flag.KILO_DISABLE_PROJECT_CONFIG
          ? []
          : yield* primaryPaths(ctx.directory, ctx.worktree, [".kilocode", ".kilo"])
        // Load primary fallbacks before active-worktree config, then track them as local.
        directories.splice(1, 0, ...primary)
        const primarySet = new Set(primary)
        // kilocode_change end

        if (Flag.KILO_CONFIG_DIR) {
          yield* Effect.logDebug("loading config from KILO_CONFIG_DIR", { path: Flag.KILO_CONFIG_DIR })
        }

        const deps: Fiber.Fiber<void>[] = []

        // kilocode_change start
        for (const dir of unique(directories)) {
          const scope = primarySet.has(dir) ? "local" : undefined
          // kilocode_change - trust {file:}/{env:} only for global-scoped config dirs, never project ones
          const dirScope = scope ?? (yield* pluginScopeForSource(dir))
          const dirTrusted = dir === Flag.KILO_CONFIG_DIR || dirScope === "global"
          // kilocode_change - untrusted config dirs confine {file:} reads to projectRoot
          const dirFileScope = dirTrusted ? undefined : { root: projectRoot, source: dir }
          const dirSourceScope = dirTrusted
            ? undefined
            : { root: primarySet.has(dir) ? path.dirname(dir) : projectRoot, source: dir }
          if (KilocodeConfig.isConfigDir(dir, Flag.KILO_CONFIG_DIR)) {
            for (const file of KilocodeConfig.ALL_CONFIG_FILES.toReversed()) {
              const source = path.join(dir, file)
              yield* Effect.logDebug(`loading config from ${source}`)
              // kilocode_change - untrusted config dirs confine {file:} reads to projectRoot
              const fileScope = dirTrusted ? undefined : { root: projectRoot, source }
              yield* merge(
                source,
                yield* loadFile(source, authEnv, dirTrusted, fileScope).pipe(
                  // kilocode_change
                  Effect.catchDefect((err: unknown) => {
                    caughtWarning(warnings, source, err)
                    return Effect.succeed({} as Info)
                  }),
                ),
                dirScope,
                dirTrusted,
              )
              result.agent ??= {}
              result.mode ??= {}
              result.plugin ??= []
            }
          }
          // kilocode_change end

          yield* ensureGitignore(dir).pipe(Effect.orDie)

          const dep = yield* npmSvc
            .install(dir, {
              add: [
                {
                  name: "@kilocode/plugin",
                  version: InstallationLocal ? undefined : InstallationVersion,
                },
              ],
            })
            .pipe(
              Effect.exit,
              Effect.tap((exit) =>
                Exit.isFailure(exit)
                  ? Effect.logWarning("background dependency install failed", { dir, error: String(exit.cause) })
                  : Effect.void,
              ),
              Effect.asVoid,
              Effect.forkDetach,
            )
          deps.push(dep)

          // kilocode_change start - propagate parse errors to the Warning accumulator
          result.command = mergeDeep(
            result.command ?? {},
            yield* Effect.promise(() => ConfigCommand.load(dir, warnings, dirTrusted, dirFileScope, dirSourceScope)),
          )
          result.agent = mergeDeep(
            result.agent ?? {},
            yield* Effect.promise(() => ConfigAgent.load(dir, warnings, dirTrusted, dirFileScope, dirSourceScope)),
          )
          result.agent = mergeDeep(
            result.agent ?? {},
            yield* Effect.promise(() => ConfigAgent.loadMode(dir, warnings, dirTrusted, dirFileScope, dirSourceScope)),
          )
          // kilocode_change end
          // kilocode_change - Auto-discovered plugins under config directories are already local files, so ConfigPlugin.load
          // returns normalized Specs and we only need to attach origin metadata here.
          const list = yield* Effect.promise(() => ConfigPlugin.load(dir))
          yield* mergePluginOrigins(dir, list, dirScope) // kilocode_change
        }

        if (process.env.KILO_CONFIG_CONTENT) {
          // kilocode_change start - capture KILO_CONFIG_CONTENT parse failures as warnings
          const source = "KILO_CONFIG_CONTENT"
          yield* merge(
            source,
            yield* loadConfig(
              process.env.KILO_CONFIG_CONTENT,
              {
                dir: ctx.directory,
                source,
              },
              undefined,
              true, // kilocode_change - KILO_CONFIG_CONTENT is user-provided, trusted for {file:}/{env:}
            ).pipe(
              Effect.tap(() => Effect.logDebug("loaded custom config from KILO_CONFIG_CONTENT")),
              Effect.catchDefect((err: unknown) => {
                caughtWarning(warnings, source, err)
                return Effect.succeed({} as Info)
              }),
            ),
            "local",
            true,
          )
          // kilocode_change end
        }

        const activeAccount = Option.getOrUndefined(
          yield* accountSvc.active().pipe(Effect.catch(() => Effect.succeed(Option.none()))),
        )
        if (activeAccount?.active_org_id) {
          const accountID = activeAccount.id
          const orgID = activeAccount.active_org_id
          const url = activeAccount.url
          yield* Effect.gen(function* () {
            const [configOpt, tokenOpt] = yield* Effect.all(
              [accountSvc.config(accountID, orgID), accountSvc.token(accountID)],
              { concurrency: 2 },
            )
            if (Option.isSome(tokenOpt)) {
              process.env["KILO_CONSOLE_TOKEN"] = tokenOpt.value
              yield* env.set("KILO_CONSOLE_TOKEN", tokenOpt.value)
            }

            if (Option.isSome(configOpt)) {
              const source = `${url}/api/config`
              const next = yield* loadConfig(
                JSON.stringify(configOpt.value),
                {
                  dir: path.dirname(source),
                  source,
                },
                undefined,
                true, // kilocode_change - console-managed org config is a trusted source
              )
              for (const providerID of Object.keys(next.provider ?? {})) {
                consoleManagedProviders.add(providerID)
              }
              yield* merge(source, next, "global")
            }
          }).pipe(
            Effect.withSpan("Config.loadActiveOrgConfig"),
            Effect.catch((err) =>
              Effect.logDebug("failed to fetch remote account config", {
                error: err instanceof Error ? err.message : String(err),
              }),
            ),
          )
        }

        const managedDir = ConfigManaged.managedConfigDir()
        // kilocode_change start - include kilo.json/kilo.jsonc in managed dir loading
        if (existsSync(managedDir)) {
          for (const file of KilocodeConfig.ALL_CONFIG_FILES.toReversed()) {
            const source = path.join(managedDir, file)
            // kilocode_change - MDM/enterprise-managed config is a trusted source
            yield* merge(source, yield* loadFile(source, undefined, true), "global")
          }
        }
        // kilocode_change end

        // macOS managed preferences (.mobileconfig deployed via MDM) override everything
        // kilocode_change start
        const managed = yield* Effect.promise(() => ConfigManaged.readManagedPreferences())
        if (managed) {
          yield* merge(
            managed.source,
            yield* loadConfig(
              managed.text,
              {
                dir: path.dirname(managed.source),
                source: managed.source,
              },
              undefined,
              true, // kilocode_change - MDM-managed preferences are a trusted source
            ),
            "global",
          )
        }
        // kilocode_change end

        for (const [name, mode] of Object.entries(result.mode ?? {})) {
          result.agent = mergeDeep(result.agent ?? {}, {
            [name]: {
              ...mode,
              mode: "primary" as const,
            },
          })
        }

        if (Flag.KILO_PERMISSION) {
          try {
            result.permission = mergeDeep(result.permission ?? {}, JSON.parse(Flag.KILO_PERMISSION))
          } catch (err) {
            yield* Effect.logWarning("KILO_PERMISSION contains invalid JSON, skipping", { err })
          }
        }

        if (result.tools) {
          const perms: Record<string, ConfigPermissionV1.Action> = {}
          for (const [tool, enabled] of Object.entries(result.tools)) {
            const action: ConfigPermissionV1.Action = enabled ? "allow" : "deny"
            if (tool === "write" || tool === "edit" || tool === "patch") {
              perms.edit = action
              continue
            }
            perms[tool] = action
          }
          result.permission = mergeDeep(perms, result.permission ?? {})
        }

        if (!result.username) {
          try {
            result.username = os.userInfo().username || "user"
          } catch (err) {
            yield* Effect.logWarning("failed to read system username, using fallback", { err })
            result.username = "user"
          }
        }

        if (result.autoshare === true && !result.share) {
          result.share = "auto"
        }

        if (Flag.KILO_DISABLE_AUTOCOMPACT) {
          result.compaction = { ...result.compaction, auto: false }
        }
        if (Flag.KILO_DISABLE_PRUNE) {
          result.compaction = { ...result.compaction, prune: false }
        }
        // kilocode_change start — inject Kilo default plugins into both plugin list and origins
        KilocodeDefaultPlugins.apply(result, { disabled: Flag.KILO_DISABLE_DEFAULT_PLUGINS, log })
        // kilocode_change end

        return {
          config: result,
          directories,
          deps,
          warnings, // kilocode_change
          consoleState: {
            consoleManagedProviders: Array.from(consoleManagedProviders),
            activeOrgName,
            switchableOrgCount: 0,
          },
        }
      },
      Effect.provideService(FSUtil.Service, fs),
    )

    const state = yield* InstanceState.make<State>(
      Effect.fn("Config.state")(function* (ctx) {
        return yield* loadInstanceState(ctx).pipe(Effect.provideService(Git.Service, git), Effect.orDie) // kilocode_change
      }),
    )

    const get = Effect.fn("Config.get")(function* () {
      // kilocode_change start - reload instance config when global config changed elsewhere
      if (yield* refreshGlobal()) {
        yield* InstanceState.invalidate(state).pipe(Effect.catchCause(() => Effect.void))
      }
      // kilocode_change end
      return yield* InstanceState.use(state, (s) => s.config)
    })

    const directories = Effect.fn("Config.directories")(function* () {
      return yield* InstanceState.use(state, (s) => s.directories)
    })

    const getConsoleState = Effect.fn("Config.getConsoleState")(function* () {
      return yield* InstanceState.use(state, (s) => s.consoleState)
    })

    const waitForDependencies = Effect.fn("Config.waitForDependencies")(function* () {
      yield* InstanceState.useEffect(state, (s) =>
        Effect.forEach(s.deps, Fiber.join, { concurrency: "unbounded" }).pipe(Effect.asVoid),
      )
    })

    const update = Effect.fn("Config.update")(function* (config: Info) {
      // kilocode_change start - delegate Kilo project config update behavior.
      const ctx = yield* InstanceState.context
      yield* KilocodeConfig.updateProjectConfig({
        fs,
        directory: ctx.directory,
        worktree: ctx.worktree,
        config,
        read: readConfigFile,
        parse: (input, file) => ConfigParse.schema(ConfigV1.Info, ConfigParse.jsonc(input, file), file),
        patch: (input, patch) => patchJsonc(input, patch),
        writable,
      })
      yield* InstanceState.invalidate(state)
      yield* Effect.sync(() =>
        GlobalBus.emit("event", {
          directory: ctx.directory,
          payload: {
            type: Event.ConfigUpdated.type,
            properties: {},
          },
        }),
      )
    })

    const warnings = Effect.fn("Config.warnings")(function* () {
      return yield* InstanceState.use(state, (s) => s.warnings)
    })
    // kilocode_change end

    const invalidate = Effect.fn("Config.invalidate")(function* () {
      yield* invalidateGlobal
    })

    // kilocode_change start - add dispose option to skip Instance.disposeAll for permission-only changes
    const updateGlobal = Effect.fn("Config.updateGlobal")(function* (config: Info, options?: { dispose?: boolean }) {
      const dispose = options?.dispose ?? true
      // kilocode_change end
      const file = globalConfigFile()
      // kilocode_change start - serialize read-merge-write so concurrent approvals cannot lose rules
      const result = yield* flock
        .withLock(
          Effect.gen(function* () {
            const before = (yield* readConfigFile(file)) ?? "{}"
            const patch = writableGlobal(config)

            if (!file.endsWith(".jsonc")) {
              const existing = ConfigParse.schema(ConfigV1.Info, ConfigParse.jsonc(before, file), file)
              const next = KilocodeConfig.mergeConfig(writable(existing), patch)
              const serialized = JSON.stringify(next, null, 2)
              const changed = serialized !== before
              if (changed) yield* fs.writeFileString(file, serialized).pipe(Effect.orDie)
              return { next, changed }
            }

            const updated = patchJsonc(before, patch)
            const next = ConfigParse.schema(ConfigV1.Info, ConfigParse.jsonc(updated, file), file)
            const changed = updated !== before
            if (changed) yield* fs.writeFileString(file, updated).pipe(Effect.orDie)
            return { next, changed }
          }),
          `config:global:${path.resolve(Global.Path.config)}`,
        )
        .pipe(Effect.orDie)
      const next = result.next
      const changed = result.changed
      // kilocode_change end

      // kilocode_change start - skip dispose when caller opts out
      if (!dispose) {
        yield* invalidateGlobal
        yield* InstanceState.invalidate(state).pipe(Effect.catchCause(() => Effect.void))
        yield* Effect.sync(() =>
          GlobalBus.emit("event", {
            directory: "global",
            payload: {
              type: Event.ConfigUpdated.type,
              properties: {},
            },
          }),
        ).pipe(Effect.catchCause(() => Effect.void))
        return { info: next, changed }
      }
      // kilocode_change end

      if (changed) yield* invalidate()
      // kilocode_change start - hot-reload global config changes in the active instance
      if (changed) {
        yield* InstanceState.invalidate(state).pipe(Effect.catchCause(() => Effect.void))
        yield* Effect.sync(() =>
          GlobalBus.emit("event", {
            directory: "global",
            payload: {
              type: Event.ConfigUpdated.type,
              properties: {},
            },
          }),
        ).pipe(Effect.catchCause(() => Effect.void))
      }
      // kilocode_change end
      return { info: next, changed }
    })

    return Service.of({
      get,
      getGlobal,
      getConsoleState,
      update,
      updateGlobal,
      invalidate,
      directories,
      waitForDependencies,
      warnings, // kilocode_change
    })
  }),
).pipe(Layer.provide(EffectFlock.defaultLayer)) // kilocode_change - serialize global config updates in every layer

export const defaultLayer = layer.pipe(
  Layer.provide(Git.defaultLayer), // kilocode_change
  Layer.provide(FSUtil.defaultLayer),
  Layer.provide(Env.defaultLayer),
  Layer.provide(Auth.defaultLayer),
  Layer.provide(Account.defaultLayer),
  Layer.provide(Npm.defaultLayer),
  Layer.provide(FetchHttpClient.layer),
)

export const node = LayerNode.make(layer, [
  FSUtil.node,
  Auth.node,
  Account.node,
  Env.node,
  Npm.node,
  httpClient,
  Git.node,
]) // kilocode_change

export * as Config from "./config"
