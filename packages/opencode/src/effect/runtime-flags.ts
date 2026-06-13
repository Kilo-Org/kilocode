import { Config, ConfigProvider, Context, Effect, Layer } from "effect"
import { ConfigService } from "@/effect/config-service"

const bool = (name: string) => Config.boolean(name).pipe(Config.withDefault(false))
const positiveInteger = (name: string) =>
  Config.number(name).pipe(
    Config.map((value) => (Number.isInteger(value) && value > 0 ? value : undefined)),
    Config.orElse(() => Config.succeed(undefined)),
  )
const experimental = bool("KILO_EXPERIMENTAL")
const enabledByExperimental = (name: string) =>
  Config.all({ experimental, enabled: bool(name) }).pipe(Config.map((flags) => flags.experimental || flags.enabled))

export class Service extends ConfigService.Service<Service>()("@opencode/RuntimeFlags", {
  autoShare: bool("KILO_AUTO_SHARE"),
  pure: bool("KILO_PURE"),
  disableDefaultPlugins: bool("KILO_DISABLE_DEFAULT_PLUGINS"),
  disableChannelDb: bool("KILO_DISABLE_CHANNEL_DB"),
  disableEmbeddedWebUi: bool("KILO_DISABLE_EMBEDDED_WEB_UI"),
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
  experimentalBackgroundSubagents: enabledByExperimental("KILO_EXPERIMENTAL_BACKGROUND_SUBAGENTS"),
  experimentalLspTy: bool("KILO_EXPERIMENTAL_LSP_TY"),
  experimentalLspTool: enabledByExperimental("KILO_EXPERIMENTAL_LSP_TOOL"),
  experimentalOxfmt: enabledByExperimental("KILO_EXPERIMENTAL_OXFMT"),
  experimentalPlanMode: enabledByExperimental("KILO_EXPERIMENTAL_PLAN_MODE"),
  experimentalEventSystem: enabledByExperimental("KILO_EXPERIMENTAL_EVENT_SYSTEM"),
  experimentalWorkspaces: enabledByExperimental("KILO_EXPERIMENTAL_WORKSPACES"),
  experimentalIconDiscovery: enabledByExperimental("KILO_EXPERIMENTAL_ICON_DISCOVERY"),
  bashDefaultTimeoutMs: positiveInteger("KILO_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS"),
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

export * as RuntimeFlags from "./runtime-flags"
