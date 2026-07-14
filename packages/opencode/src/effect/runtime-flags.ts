import { Config, ConfigProvider, Context, Effect, Layer, Option } from "effect"
import { ConfigService } from "@/effect/config-service"

const bool = (name: string) => Config.boolean(name).pipe(Config.withDefault(false))
const positiveInteger = (name: string) =>
  Config.number(name).pipe(
    Config.map((value) => (Number.isInteger(value) && value > 0 ? value : undefined)),
    Config.orElse(() => Config.succeed(undefined)),
  )
const experimental = bool("KILO_EXPERIMENTAL")
const enabledByExperimental = (name: string) =>
  Config.all({ experimental, enabled: Config.boolean(name).pipe(Config.option) }).pipe(
    Config.map((flags) => Option.getOrElse(flags.enabled, () => flags.experimental)),
  )

export class Service extends ConfigService.Service<Service>()("@opencode/RuntimeFlags", {
  autoShare: bool("KILO_AUTO_SHARE"),
  pure: bool("KILO_PURE"),
  disableDefaultPlugins: bool("KILO_DISABLE_DEFAULT_PLUGINS"),
  disableChannelDb: bool("KILO_DISABLE_CHANNEL_DB"), // kilocode_change
  disableEmbeddedWebUi: bool("KILO_DISABLE_EMBEDDED_WEB_UI"),
  disableExternalSkills: bool("KILO_DISABLE_EXTERNAL_SKILLS"),
  disableLspDownload: bool("KILO_DISABLE_LSP_DOWNLOAD"),
  skipMigrations: bool("KILO_SKIP_MIGRATIONS"), // kilocode_change
  disableClaudeCodePrompt: Config.all({
    broad: bool("KILO_DISABLE_CLAUDE_CODE"),
    direct: bool("KILO_DISABLE_CLAUDE_CODE_PROMPT"),
  }).pipe(Config.map((flags) => flags.broad || flags.direct)),
  disableClaudeCodeSkills: Config.all({
    broad: bool("KILO_DISABLE_CLAUDE_CODE"),
    direct: bool("KILO_DISABLE_CLAUDE_CODE_SKILLS"),
  }).pipe(Config.map((flags) => flags.broad || flags.direct)),
  enableExa: Config.all({
    experimental,
    enabled: bool("KILO_ENABLE_EXA"),
    legacy: bool("KILO_EXPERIMENTAL_EXA"),
  }).pipe(Config.map((flags) => flags.experimental || flags.enabled || flags.legacy)),
  enableParallel: Config.all({
    enabled: bool("KILO_ENABLE_PARALLEL"),
    legacy: bool("KILO_EXPERIMENTAL_PARALLEL"),
  }).pipe(Config.map((flags) => flags.enabled || flags.legacy)),
  enableExperimentalModels: bool("KILO_ENABLE_EXPERIMENTAL_MODELS"),
  enableQuestionTool: bool("KILO_ENABLE_QUESTION_TOOL"),
  experimentalScout: enabledByExperimental("KILO_EXPERIMENTAL_SCOUT"),
  experimentalReferences: enabledByExperimental("KILO_EXPERIMENTAL_REFERENCES"),
  experimentalBackgroundSubagents: enabledByExperimental("KILO_EXPERIMENTAL_BACKGROUND_SUBAGENTS"),
  experimentalLspTy: bool("KILO_EXPERIMENTAL_LSP_TY"),
  experimentalLspTool: enabledByExperimental("KILO_EXPERIMENTAL_LSP_TOOL"),
  experimentalOxfmt: enabledByExperimental("KILO_EXPERIMENTAL_OXFMT"),
  experimentalPlanMode: enabledByExperimental("KILO_EXPERIMENTAL_PLAN_MODE"),
  experimentalEventSystem: enabledByExperimental("KILO_EXPERIMENTAL_EVENT_SYSTEM"),
  experimentalWorkspaces: enabledByExperimental("KILO_EXPERIMENTAL_WORKSPACES"),
  experimentalIconDiscovery: enabledByExperimental("KILO_EXPERIMENTAL_ICON_DISCOVERY"),
  outputTokenMax: positiveInteger("KILO_EXPERIMENTAL_OUTPUT_TOKEN_MAX"),
  bashDefaultTimeoutMs: positiveInteger("KILO_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS"),
  experimentalNativeLlm: bool("KILO_EXPERIMENTAL_NATIVE_LLM"),
  experimentalWebSockets: bool("KILO_EXPERIMENTAL_WEBSOCKETS"),
  client: Config.string("KILO_CLIENT").pipe(Config.withDefault("cli")),
}) {}

export type Info = Context.Service.Shape<typeof Service>

const emptyConfigLayer = Service.defaultLayer.pipe(
  Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({}))),
  Layer.orDie,
)

export const layer = (overrides: Partial<Info> = {}) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const flags = yield* Service
      return Service.of({ ...flags, ...overrides })
    }),
  ).pipe(Layer.provide(emptyConfigLayer))

export const defaultLayer = Service.defaultLayer.pipe(Layer.orDie)

export const node = LayerNode.make(defaultLayer, [])

export * as RuntimeFlags from "./runtime-flags"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
