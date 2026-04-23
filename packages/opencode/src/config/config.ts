import { Log } from "../util"
import path from "path"
import { pathToFileURL } from "url"
import os from "os"
import z from "zod"
import { mergeDeep, pipe } from "remeda"
import { Global } from "../global"
import fsNode from "fs/promises"
import { NamedError } from "@opencode-ai/shared/util/error"
import { Flag } from "../flag/flag"
import { Auth } from "../auth"
import { Env } from "../env"
import { applyEdits, findNodeAtLocation, modify, parseTree } from "jsonc-parser" // kilocode_change - parseTree/findNodeAtLocation used in patchJsonc
import { Instance, type InstanceContext } from "../project/instance"
import * as LSPServer from "../lsp/server"
import { InstallationLocal, InstallationVersion } from "@/installation/version"
import { existsSync } from "fs"
import { GlobalBus } from "@/bus/global"
import { Event } from "../server/event"
import { Account } from "@/account"
import { isRecord } from "@/util/record"
import type { ConsoleState } from "./console-state"
import { AppFileSystem } from "@opencode-ai/shared/filesystem"
import { InstanceState } from "@/effect"
import { Context, Duration, Effect, Exit, Fiber, Layer, Option } from "effect"
import { EffectFlock } from "@opencode-ai/shared/util/effect-flock"
import { InstanceRef } from "@/effect/instance-ref"
import { Npm } from "@opencode-ai/shared/npm"
import { ConfigAgent } from "./agent"
import { ConfigMCP } from "./mcp"
import { ConfigModelID } from "./model-id"
import { ConfigPlugin } from "./plugin"
import { ConfigManaged } from "./managed"
import { ConfigCommand } from "./command"
import { ConfigParse } from "./parse"
import { ConfigPermission } from "./permission"
import { ConfigProvider } from "./provider"
import { ConfigSkills } from "./skills"
import { ConfigPaths } from "./paths"
// kilocode_change start
import { KilocodeConfig } from "../kilocode/config/config"
import { makeRuntime } from "@/effect/run-service"
import { unique } from "remeda"
// kilocode_change end

const log = Log.create({ service: "config" })

// Custom merge function that concatenates array fields instead of replacing them
function mergeConfigConcatArrays(target: Info, source: Info): Info {
  const merged = mergeDeep(target, source)
  if (target.instructions && source.instructions) {
    merged.instructions = Array.from(new Set([...target.instructions, ...source.instructions]))
  }
  return merged
}

function normalizeLoadedConfig(data: unknown, source: string) {
  if (!isRecord(data)) return data
  const copy = { ...data }
  const hadLegacy = "theme" in copy || "keybinds" in copy || "tui" in copy
  if (!hadLegacy) return copy
  delete copy.theme
  delete copy.keybinds
  delete copy.tui
  log.warn("tui keys in opencode config are deprecated; move them to tui.json", { path: source })
  return copy
}

// kilocode_change start
export const Warning = z.object({
  path: z.string(),
  message: z.string(),
  detail: z.string().optional(),
})
export type Warning = z.infer<typeof Warning>

const { toWarning, caught: caughtWarning, handleInvalid } = KilocodeConfig
// kilocode_change end

async function resolveLoadedPlugins<T extends { plugin?: ConfigPlugin.Spec[] }>(config: T, filepath: string) {
  if (!config.plugin) return config
  for (let i = 0; i < config.plugin.length; i++) {
    // Normalize path-like plugin specs while we still know which config file declared them.
    // This prevents `./plugin.ts` from being reinterpreted relative to some later merge location.
    config.plugin[i] = await ConfigPlugin.resolvePluginSpec(config.plugin[i], filepath)
  }
  return config
}

export const Server = z
  .object({
    port: z.number().int().positive().optional().describe("Port to listen on"),
    hostname: z.string().optional().describe("Hostname to listen on"),
    mdns: z.boolean().optional().describe("Enable mDNS service discovery"),
    mdnsDomain: z.string().optional().describe("Custom domain name for mDNS service (default: kilo.local)"), // kilocode_change
    cors: z.array(z.string()).optional().describe("Additional domains to allow for CORS"),
  })
  .strict()
  .meta({
    ref: "ServerConfig",
  })

export const Layout = z.enum(["auto", "stretch"]).meta({
  ref: "LayoutConfig",
})
export type Layout = z.infer<typeof Layout>

export const Info = z
  .object({
    $schema: z.string().optional().describe("JSON schema reference for configuration validation"),
    logLevel: Log.Level.optional().describe("Log level"),
    server: Server.optional().describe("Server configuration for opencode serve and web commands"),
    command: z
      .record(z.string(), ConfigCommand.Info)
      .optional()
      .describe("Command configuration, see https://opencode.ai/docs/commands"),
    skills: ConfigSkills.Info.optional().describe("Additional skill folder paths"),
    watcher: z
      .object({
        ignore: z.array(z.string()).optional(),
      })
      .optional(),
    snapshot: z
      .boolean()
      .optional()
      .describe(
        "Enable or disable snapshot tracking. When false, filesystem snapshots are not recorded and undoing or reverting will not undo/redo file changes. Defaults to true.",
      ),
    // User-facing plugin config is stored as Specs; provenance gets attached later while configs are merged.
    plugin: ConfigPlugin.Spec.array().optional(),
    share: z
      .enum(["manual", "auto", "disabled"])
      .optional()
      .describe(
        "Control sharing behavior:'manual' allows manual sharing via commands, 'auto' enables automatic sharing, 'disabled' disables all sharing",
      ),
    autoshare: z
      .boolean()
      .optional()
      .describe("@deprecated Use 'share' field instead. Share newly created sessions automatically"),
    // kilocode_change start
    // NOTE: Any new kilocode_change key added to Config.Info must also be mirrored in
    // apps/web/src/app/config.json/extras.ts in the cloud repo, otherwise
    // $schema: https://app.kilo.ai/config.json will not recognize it.
    remote_control: z
      .boolean()
      .optional()
      .describe("Enable remote control of sessions via Kilo Cloud. Equivalent to running /remote on startup."),
    // kilocode_change end
    autoupdate: z
      .union([z.boolean(), z.literal("notify")])
      .optional()
      .describe(
        "Automatically update to the latest version. Set to true to auto-update, false to disable, or 'notify' to show update notifications",
      ),
    disabled_providers: z.array(z.string()).optional().describe("Disable providers that are loaded automatically"),
    enabled_providers: z
      .array(z.string())
      .optional()
      .describe("When set, ONLY these providers will be enabled. All other providers will be ignored"),
    // kilocode_change start - nullable for delete sentinel
    model: ConfigModelID.nullable()
      .describe("Model to use in the format of provider/model, eg anthropic/claude-2")
      .optional(),
    small_model: ConfigModelID.nullable()
      .describe("Small model to use for tasks like title generation in the format of provider/model")
      .optional(),
    // kilocode_change end
    // kilocode_change start - renamed from "build" to "code"
    default_agent: z
      .string()
      .optional()
      .describe(
        "Default agent to use when none is specified. Must be a primary agent. Falls back to 'code' if not set or if the specified agent is invalid.",
      ),
    // kilocode_change end
    username: z.string().optional().describe("Custom username to display in conversations instead of system username"),
    mode: z
      .object({
        build: ConfigAgent.Info.optional(),
        plan: ConfigAgent.Info.optional(),
      })
      .catchall(ConfigAgent.Info)
      .optional()
      .describe("@deprecated Use `agent` field instead."),
    agent: z
      .object({
        // primary
        plan: ConfigAgent.Info.optional(),
        build: ConfigAgent.Info.optional(),
        debug: ConfigAgent.Info.optional(), // kilocode_change
        orchestrator: ConfigAgent.Info.optional(), // kilocode_change
        ask: ConfigAgent.Info.optional(), // kilocode_change
        // subagent
        general: ConfigAgent.Info.optional(),
        explore: ConfigAgent.Info.optional(),
        // specialized
        title: ConfigAgent.Info.optional(),
        summary: ConfigAgent.Info.optional(),
        compaction: ConfigAgent.Info.optional(),
      })
      .catchall(ConfigAgent.Info)
      .optional()
      .describe("Agent configuration, see https://opencode.ai/docs/agents"),
    provider: z
      .record(z.string(), ConfigProvider.Info)
      .optional()
      .describe("Custom provider configurations and model overrides"),
    mcp: z
      .record(
        z.string(),
        z.union([
          ConfigMCP.Info,
          z
            .object({
              enabled: z.boolean(),
            })
            .strict(),
        ]),
      )
      .optional()
      .describe("MCP (Model Context Protocol) server configurations"),
    formatter: z
      .union([
        z.literal(false),
        z.record(
          z.string(),
          z.object({
            disabled: z.boolean().optional(),
            command: z.array(z.string()).optional(),
            environment: z.record(z.string(), z.string()).optional(),
            extensions: z.array(z.string()).optional(),
          }),
        ),
      ])
      .optional(),
    lsp: z
      .union([
        z.literal(false),
        z.record(
          z.string(),
          z.union([
            z.object({
              disabled: z.literal(true),
            }),
            z.object({
              command: z.array(z.string()),
              extensions: z.array(z.string()).optional(),
              disabled: z.boolean().optional(),
              env: z.record(z.string(), z.string()).optional(),
              initialization: z.record(z.string(), z.any()).optional(),
            }),
          ]),
        ),
      ])
      .optional()
      .refine(
        (data) => {
          if (!data) return true
          if (typeof data === "boolean") return true
          const serverIds = new Set(Object.values(LSPServer).map((s) => s.id))

          return Object.entries(data).every(([id, config]) => {
            if (config.disabled) return true
            if (serverIds.has(id)) return true
            return Boolean(config.extensions)
          })
        },
        {
          error: "For custom LSP servers, 'extensions' array is required.",
        },
      ),
    instructions: z.array(z.string()).optional().describe("Additional instruction files or patterns to include"),
    layout: Layout.optional().describe("@deprecated Always uses stretch layout."),
    permission: ConfigPermission.Info.optional(),
    tools: z.record(z.string(), z.boolean()).optional(),
    enterprise: z
      .object({
        url: z.string().optional().describe("Enterprise URL"),
      })
      .optional(),
    commit_message: KilocodeConfig.CommitMessageSchema, // kilocode_change
    compaction: z
      .object({
        auto: z.boolean().optional().describe("Enable automatic compaction when context is full (default: true)"),
        prune: z.boolean().optional().describe("Enable pruning of old tool outputs (default: true)"),
        reserved: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Token buffer for compaction. Leaves enough window to avoid overflow during compaction."),
      })
      .optional(),
    experimental: z
      .object({
        disable_paste_summary: z.boolean().optional(),
        batch_tool: z.boolean().optional().describe("Enable the batch tool"),
        codebase_search: z.boolean().optional().describe("Enable AI-powered codebase search"), // kilocode_change
        // kilocode_change start - enable telemetry by default
        openTelemetry: z.boolean().default(true).describe("Enable telemetry. Set to false to opt-out."),
        // kilocode_change end
        primary_tools: z
          .array(z.string())
          .optional()
          .describe("Tools that should only be available to primary agents."),
        continue_loop_on_deny: z.boolean().optional().describe("Continue the agent loop when a tool call is denied"),
        mcp_timeout: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Timeout in milliseconds for model context protocol (MCP) requests"),
      })
      .optional(),
  })
  .strict()
  .meta({
    ref: "Config",
  })

export type Info = z.output<typeof Info> & {
  // plugin_origins is derived state, not a persisted config field. It keeps each winning plugin spec together
  // with the file and scope it came from so later runtime code can make location-sensitive decisions.
  plugin_origins?: ConfigPlugin.Origin[]
}

type State = {
  config: Info
  directories: string[]
  deps: Fiber.Fiber<void, never>[]
  warnings: Warning[] // kilocode_change
  consoleState: ConsoleState
}

export interface Interface {
  readonly get: () => Effect.Effect<Info>
  readonly getGlobal: () => Effect.Effect<Info>
  readonly getConsoleState: () => Effect.Effect<ConsoleState>
  readonly update: (config: Info) => Effect.Effect<void>
  readonly updateGlobal: (config: Info, options?: { dispose?: boolean }) => Effect.Effect<Info> // kilocode_change
  readonly invalidate: (wait?: boolean) => Effect.Effect<void>
  readonly directories: () => Effect.Effect<string[]>
  readonly waitForDependencies: () => Effect.Effect<void>
  readonly warnings: () => Effect.Effect<Warning[]> // kilocode_change
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Config") {}

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
    // kilocode_change - null means "delete this key" — pass undefined to jsonc-parser's modify()
    const edits = modify(input, path, patch === null ? undefined : patch, {
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

  return Object.entries(patch).reduce((result, [key, value]) => {
    if (value === undefined) return result
    return patchJsonc(result, value, [...path, key])
  }, input)
}

function writable(info: Info) {
  const { plugin_origins: _plugin_origins, ...next } = info
  return next
}

export const ConfigDirectoryTypoError = NamedError.create(
  "ConfigDirectoryTypoError",
  z.object({
    path: z.string(),
    dir: z.string(),
    suggestion: z.string(),
  }),
)

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    const authSvc = yield* Auth.Service
    const accountSvc = yield* Account.Service
    const env = yield* Env.Service
    const npmSvc = yield* Npm.Service

    const readConfigFile = Effect.fnUntraced(function* (filepath: string) {
      return yield* fs.readFileString(filepath).pipe(
        Effect.catchIf(
          (e) => e.reason._tag === "NotFound",
          () => Effect.succeed(undefined),
        ),
        Effect.orDie,
      )
    })

    const loadConfig = Effect.fnUntraced(function* (
      text: string,
      options: { path: string } | { dir: string; source: string },
    ) {
      if (!("path" in options)) {
        return yield* Effect.promise(() =>
          ConfigParse.load(Info, text, {
            type: "virtual",
            dir: options.dir,
            source: options.source,
            normalize: normalizeLoadedConfig,
          }),
        )
      }

      const data = yield* Effect.promise(() =>
        ConfigParse.load(Info, text, {
          type: "path",
          path: options.path,
          normalize: normalizeLoadedConfig,
        }),
      )
      yield* Effect.promise(() => resolveLoadedPlugins(data, options.path))
      if (!data.$schema) {
        data.$schema = "https://app.kilo.ai/config.json" // kilocode_change
        const updated = text.replace(/^\s*\{/, '{\n  "$schema": "https://app.kilo.ai/config.json",') // kilocode_change
        yield* fs.writeFileString(options.path, updated).pipe(Effect.catch(() => Effect.void))
      }
      return data
    })

    const loadFile = Effect.fnUntraced(function* (filepath: string) {
      log.info("loading", { path: filepath })
      const text = yield* readConfigFile(filepath)
      if (!text) return {} as Info
      return yield* loadConfig(text, { path: filepath })
    })

    const loadGlobal = Effect.fnUntraced(function* () {
      yield* Effect.promise(() => KilocodeConfig.migrateBashPermission()) // kilocode_change
      let result: Info = pipe(
        {},
        mergeDeep(yield* loadFile(path.join(Global.Path.config, "config.json"))),
        // kilocode_change start
        mergeDeep(yield* loadFile(path.join(Global.Path.config, "kilo.json"))),
        mergeDeep(yield* loadFile(path.join(Global.Path.config, "kilo.jsonc"))),
        // kilocode_change end
        mergeDeep(yield* loadFile(path.join(Global.Path.config, "opencode.json"))),
        mergeDeep(yield* loadFile(path.join(Global.Path.config, "opencode.jsonc"))),
      )

      const legacy = path.join(Global.Path.config, "config")
      if (existsSync(legacy)) {
        yield* Effect.promise(() =>
          import(pathToFileURL(legacy).href, { with: { type: "toml" } })
            .then(async (mod) => {
              const { provider, model, ...rest } = mod.default
              if (provider && model) result.model = `${provider}/${model}`
              result["$schema"] = "https://app.kilo.ai/config.json" // kilocode_change
              result = mergeDeep(result, rest)
              await fsNode.writeFile(path.join(Global.Path.config, "config.json"), JSON.stringify(result, null, 2))
              await fsNode.unlink(legacy)
            })
            .catch(() => {}),
        )
      }

      return result
    })

    const [cachedGlobal, invalidateGlobal] = yield* Effect.cachedInvalidateWithTTL(
      loadGlobal().pipe(
        Effect.tapError((error) =>
          Effect.sync(() => log.error("failed to load global config, using defaults", { error: String(error) })),
        ),
        Effect.orElseSucceed((): Info => ({})),
      ),
      Duration.infinity,
    )

    const getGlobal = Effect.fn("Config.getGlobal")(function* () {
      return yield* cachedGlobal
    })

    const ensureGitignore = Effect.fn("Config.ensureGitignore")(function* (dir: string) {
      const gitignore = path.join(dir, ".gitignore")
      const hasIgnore = yield* fs.existsSafe(gitignore)
      if (!hasIgnore) {
        yield* fs
          .writeFileString(
            gitignore,
            // kilocode_change start - added pnpm-lock.yaml and yarn.lock (not in upstream)
            [
              "node_modules",
              "package.json",
              "package-lock.json",
              "pnpm-lock.yaml",
              "bun.lock",
              "yarn.lock",
              ".gitignore",
            ].join("\n"),
            // kilocode_change end
          )
          .pipe(
            Effect.catchIf(
              (e) => e.reason._tag === "PermissionDenied",
              () => Effect.void,
            ),
          )
      }
    })

    const loadInstanceState = Effect.fn("Config.loadInstanceState")(function* (ctx: InstanceContext) {
      // kilocode_change start - warning accumulator and legacy Kilo config
      const warnings: Warning[] = []
      const auth = yield* authSvc.all().pipe(Effect.orDie)

      let result: Info = {}
      const legacy = yield* Effect.promise(() =>
        KilocodeConfig.loadLegacyConfigs({
          projectDir: ctx.directory,
          merge: mergeConfigConcatArrays,
        }),
      )
      result = mergeConfigConcatArrays(result, legacy.config)
      warnings.push(...legacy.warnings)

      const orgModes = yield* Effect.promise(() => KilocodeConfig.loadOrganizationModes(auth))
      if (Object.keys(orgModes.agents).length > 0) {
        result = mergeConfigConcatArrays(result, { agent: orgModes.agents })
      }
      warnings.push(...orgModes.warnings)
      // kilocode_change end

      const consoleManagedProviders = new Set<string>()
      let activeOrgName: string | undefined

      const pluginScopeForSource = Effect.fnUntraced(function* (source: string) {
        if (source.startsWith("http://") || source.startsWith("https://")) return "global"
        if (source === "KILO_CONFIG_CONTENT") return "local"
        if (yield* InstanceRef.use((ctx) => Effect.succeed(Instance.containsPath(source, ctx)))) return "local"
        return "global"
      })

      const mergePluginOrigins = Effect.fnUntraced(function* (
        source: string,
        // mergePluginOrigins receives raw Specs from one config source, before provenance for this merge step
        // is attached.
        list: ConfigPlugin.Spec[] | undefined,
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

      const merge = (source: string, next: Info, kind?: ConfigPlugin.Scope) => {
        result = mergeConfigConcatArrays(result, next)
        return mergePluginOrigins(source, next.plugin, kind)
      }

      for (const [key, value] of Object.entries(auth)) {
        if (value.type === "wellknown") {
          const url = key.replace(/\/+$/, "")
          const source = `${url}/.well-known/opencode`
          process.env[value.key] = value.token
          log.debug("fetching remote config", { url: source })
          // kilocode_change start - warn instead of fail on wellknown errors
          const next = yield* Effect.tryPromise({
            try: async () => {
              const response = await fetch(source)
              if (!response.ok) {
                throw new Error(`failed to fetch remote config from ${url}: ${response.status}`)
              }
              const wellknown = (await response.json()) as { config?: Record<string, unknown> }
              const remoteConfig = wellknown.config ?? {}
              if (!remoteConfig.$schema) remoteConfig.$schema = "https://app.kilo.ai/config.json"
              return remoteConfig
            },
            catch: (err) => err,
          }).pipe(
            Effect.flatMap((remoteConfig) =>
              loadConfig(JSON.stringify(remoteConfig), {
                dir: path.dirname(source),
                source,
              }),
            ),
            Effect.tap(() => Effect.sync(() => log.debug("loaded remote config from well-known", { url }))),
            Effect.catch((err: unknown) => {
              caughtWarning(warnings, source, err)
              log.warn("skipped remote config due to error", { url, err })
              return Effect.succeed({} as Info)
            }),
            Effect.catchDefect((err: unknown) => {
              caughtWarning(warnings, source, err)
              log.warn("skipped remote config due to error", { url, err })
              return Effect.succeed({} as Info)
            }),
          )
          yield* merge(source, next, "global")
          // kilocode_change end
        }
      }

      const global = yield* getGlobal().pipe(
        // kilocode_change start - capture global config failures as warnings
        Effect.catchDefect((err: unknown) => {
          caughtWarning(warnings, "global config", err)
          return Effect.succeed({} as Info)
        }),
        // kilocode_change end
      )
      yield* merge(Global.Path.config, global, "global")

      if (Flag.KILO_CONFIG) {
        // kilocode_change start - capture KILO_CONFIG failures as warnings
        yield* merge(
          Flag.KILO_CONFIG,
          yield* loadFile(Flag.KILO_CONFIG).pipe(
            Effect.catchDefect((err: unknown) => {
              caughtWarning(warnings, Flag.KILO_CONFIG!, err)
              return Effect.succeed({} as Info)
            }),
          ),
        )
        // kilocode_change end
        log.debug("loaded custom config", { path: Flag.KILO_CONFIG })
      }

      if (!Flag.KILO_DISABLE_PROJECT_CONFIG) {
        // kilocode_change start - also discover kilo.json project files
        for (const name of ["kilo", "opencode"] as const) {
          for (const file of yield* Effect.promise(() => ConfigPaths.projectFiles(name, ctx.directory, ctx.worktree))) {
            yield* merge(
              file,
              yield* loadFile(file).pipe(
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

      const directories = yield* Effect.promise(() => ConfigPaths.directories(ctx.directory, ctx.worktree))

      if (Flag.KILO_CONFIG_DIR) {
        log.debug("loading config from KILO_CONFIG_DIR", { path: Flag.KILO_CONFIG_DIR })
      }

      const deps: Fiber.Fiber<void, never>[] = []

      for (const dir of unique(directories)) {
        // kilocode_change start - accept .kilo/.kilocode config dirs and all kilo/opencode filenames
        if (KilocodeConfig.isConfigDir(dir, Flag.KILO_CONFIG_DIR)) {
          for (const file of KilocodeConfig.ALL_CONFIG_FILES) {
            const source = path.join(dir, file)
            log.debug(`loading config from ${source}`)
            yield* merge(
              source,
              yield* loadFile(source).pipe(
                Effect.catchDefect((err: unknown) => {
                  caughtWarning(warnings, source, err)
                  return Effect.succeed({} as Info)
                }),
              ),
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
            add: ["@kilocode/plugin" + (InstallationLocal ? "" : "@" + InstallationVersion)],
          })
          .pipe(
            Effect.exit,
            Effect.tap((exit) =>
              Exit.isFailure(exit)
                ? Effect.sync(() => {
                    log.warn("background dependency install failed", { dir, error: String(exit.cause) })
                  })
                : Effect.void,
            ),
            Effect.asVoid,
            Effect.forkDetach,
          )
        deps.push(dep)

        // kilocode_change start - propagate parse errors to the Warning accumulator
        result.command = mergeDeep(result.command ?? {}, yield* Effect.promise(() => ConfigCommand.load(dir, warnings)))
        result.agent = mergeDeep(result.agent ?? {}, yield* Effect.promise(() => ConfigAgent.load(dir, warnings)))
        result.agent = mergeDeep(result.agent ?? {}, yield* Effect.promise(() => ConfigAgent.loadMode(dir, warnings)))
        // kilocode_change end
        // Auto-discovered plugins under `.opencode/plugin(s)` are already local files, so ConfigPlugin.load
        // returns normalized Specs and we only need to attach origin metadata here.
        const list = yield* Effect.promise(() => ConfigPlugin.load(dir))
        yield* mergePluginOrigins(dir, list)
      }

      if (process.env.KILO_CONFIG_CONTENT) {
        // kilocode_change start - capture KILO_CONFIG_CONTENT parse failures as warnings
        const source = "KILO_CONFIG_CONTENT"
        yield* merge(
          source,
          yield* loadConfig(process.env.KILO_CONFIG_CONTENT, {
            dir: ctx.directory,
            source,
          }).pipe(
            Effect.tap(() => Effect.sync(() => log.debug("loaded custom config from KILO_CONFIG_CONTENT"))),
            Effect.catchDefect((err: unknown) => {
              caughtWarning(warnings, source, err)
              return Effect.succeed({} as Info)
            }),
          ),
          "local",
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
            const next = yield* loadConfig(JSON.stringify(configOpt.value), {
              dir: path.dirname(source),
              source,
            })
            for (const providerID of Object.keys(next.provider ?? {})) {
              consoleManagedProviders.add(providerID)
            }
            yield* merge(source, next, "global")
          }
        }).pipe(
          Effect.withSpan("Config.loadActiveOrgConfig"),
          Effect.catch((err) => {
            log.debug("failed to fetch remote account config", {
              error: err instanceof Error ? err.message : String(err),
            })
            return Effect.void
          }),
        )
      }

      const managedDir = ConfigManaged.managedConfigDir()
      // kilocode_change start - include kilo.json/kilo.jsonc in managed dir loading
      if (existsSync(managedDir)) {
        for (const file of KilocodeConfig.ALL_CONFIG_FILES) {
          const source = path.join(managedDir, file)
          yield* merge(source, yield* loadFile(source), "global")
        }
      }
      // kilocode_change end

      // macOS managed preferences (.mobileconfig deployed via MDM) override everything
      const managed = yield* Effect.promise(() => ConfigManaged.readManagedPreferences())
      if (managed) {
        result = mergeConfigConcatArrays(
          result,
          yield* loadConfig(managed.text, {
            dir: path.dirname(managed.source),
            source: managed.source,
          }),
        )
      }

      for (const [name, mode] of Object.entries(result.mode ?? {})) {
        result.agent = mergeDeep(result.agent ?? {}, {
          [name]: {
            ...mode,
            mode: "primary" as const,
          },
        })
      }

      if (Flag.KILO_PERMISSION) {
        result.permission = mergeDeep(result.permission ?? {}, JSON.parse(Flag.KILO_PERMISSION))
      }

      if (result.tools) {
        const perms: Record<string, ConfigPermission.Action> = {}
        for (const [tool, enabled] of Object.entries(result.tools)) {
          const action: ConfigPermission.Action = enabled ? "allow" : "deny"
          if (tool === "write" || tool === "edit" || tool === "patch" || tool === "multiedit") {
            perms.edit = action
            continue
          }
          perms[tool] = action
        }
        result.permission = mergeDeep(perms, result.permission ?? {})
      }

      if (!result.username) result.username = os.userInfo().username

      if (result.autoshare === true && !result.share) {
        result.share = "auto"
      }

      if (Flag.KILO_DISABLE_AUTOCOMPACT) {
        result.compaction = { ...result.compaction, auto: false }
      }
      if (Flag.KILO_DISABLE_PRUNE) {
        result.compaction = { ...result.compaction, prune: false }
      }

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
    })

    const state = yield* InstanceState.make<State>(
      Effect.fn("Config.state")(function* (ctx) {
        return yield* loadInstanceState(ctx)
      }),
    )

    const get = Effect.fn("Config.get")(function* () {
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

    // kilocode_change start
    const warnings = Effect.fn("Config.warnings")(function* () {
      return yield* InstanceState.use(state, (s) => s.warnings)
    })
    // kilocode_change end

    const update = Effect.fn("Config.update")(function* (config: Info) {
      const dir = yield* InstanceState.directory
      const file = path.join(dir, "config.json")
      const existing = yield* loadFile(file)
      yield* fs
        .writeFileString(
          file,
          JSON.stringify(KilocodeConfig.mergeConfig(writable(existing), writable(config)), null, 2),
        )
        .pipe(Effect.orDie) // kilocode_change
      yield* Effect.promise(() => Instance.dispose())
    })

    const invalidate = Effect.fn("Config.invalidate")(function* (wait?: boolean) {
      yield* invalidateGlobal
      const task = Instance.disposeAll()
        .catch(() => undefined)
        .finally(() =>
          GlobalBus.emit("event", {
            directory: "global",
            payload: {
              type: Event.Disposed.type,
              properties: {},
            },
          }),
        )
      if (wait) yield* Effect.promise(() => task)
      else void task
    })

    // kilocode_change start - add dispose option to skip Instance.disposeAll for permission-only changes
    const updateGlobal = Effect.fn("Config.updateGlobal")(function* (config: Info, options?: { dispose?: boolean }) {
      const dispose = options?.dispose ?? true
      // kilocode_change end
      const file = globalConfigFile()
      const before = (yield* readConfigFile(file)) ?? "{}"
      const input = writable(config)

      let next: Info
      if (!file.endsWith(".jsonc")) {
        const existing = ConfigParse.parse(Info, before, file)
        const merged = KilocodeConfig.mergeConfig(writable(existing), input) // kilocode_change
        yield* fs.writeFileString(file, JSON.stringify(merged, null, 2)).pipe(Effect.orDie)
        next = merged
      } else {
        const updated = patchJsonc(before, input)
        next = ConfigParse.parse(Info, updated, file)
        yield* fs.writeFileString(file, updated).pipe(Effect.orDie)
      }

      // kilocode_change start - skip dispose when caller opts out
      if (!dispose) {
        yield* invalidateGlobal
        yield* InstanceState.invalidate(state)
        yield* Effect.sync(() =>
          GlobalBus.emit("event", {
            directory: "global",
            payload: {
              type: Event.ConfigUpdated.type,
              properties: {},
            },
          }),
        )
        return next
      }
      // kilocode_change end

      yield* invalidate()
      return next
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
)

export const defaultLayer = layer.pipe(
  Layer.provide(EffectFlock.defaultLayer),
  Layer.provide(AppFileSystem.defaultLayer),
  Layer.provide(Env.defaultLayer),
  Layer.provide(Auth.defaultLayer),
  Layer.provide(Account.defaultLayer),
  Layer.provide(Npm.defaultLayer),
)

// kilocode_change start - keep async wrappers for Kilo callsites during Effect migration
const { runPromise } = makeRuntime(Service, defaultLayer)

export async function get() {
  return runPromise((svc) => svc.get())
}

export async function getGlobal() {
  return runPromise((svc) => svc.getGlobal())
}

export async function getConsoleState() {
  return runPromise((svc) => svc.getConsoleState())
}

export async function update(config: Info) {
  return runPromise((svc) => svc.update(config))
}

export async function updateGlobal(config: Info, options?: { dispose?: boolean }) {
  return runPromise((svc) => svc.updateGlobal(config, options))
}

export async function invalidate(wait = false) {
  return runPromise((svc) => svc.invalidate(wait))
}

export async function directories() {
  return runPromise((svc) => svc.directories())
}

export async function waitForDependencies() {
  return runPromise((svc) => svc.waitForDependencies())
}

export async function warnings() {
  return runPromise((svc) => svc.warnings())
}
// kilocode_change end
