import { describe, expect } from "bun:test"
import { ConfigProvider, Effect, Layer } from "effect"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { it } from "../lib/effect"

const fromConfig = (input: Record<string, unknown>) =>
  RuntimeFlags.defaultLayer.pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(input))))

const readFlags = RuntimeFlags.Service.useSync((flags) => flags)

describe("RuntimeFlags", () => {
  it.effect("defaultLayer defaults autoShare to false", () =>
    Effect.gen(function* () {
      const flags = yield* readFlags.pipe(Effect.provide(fromConfig({})))

      expect(flags.autoShare).toBe(false)
    }),
  )

  it.effect("defaultLayer parses plugin flags from the active ConfigProvider", () =>
    Effect.gen(function* () {
      const flags = yield* readFlags.pipe(
        Effect.provide(
          fromConfig({
            KILO_PURE: "true",
            KILO_DISABLE_DEFAULT_PLUGINS: "true",
            KILO_DISABLE_CHANNEL_DB: "true",
            KILO_AUTO_SHARE: "true",
            KILO_DISABLE_EMBEDDED_WEB_UI: "true",
            KILO_DISABLE_EXTERNAL_SKILLS: "true",
            KILO_DISABLE_LSP_DOWNLOAD: "true",
            KILO_SKIP_MIGRATIONS: "true",
            KILO_EXPERIMENTAL: "true",
            KILO_ENABLE_EXA: "true",
            KILO_ENABLE_PARALLEL: "true",
            KILO_ENABLE_EXPERIMENTAL_MODELS: "true",
            KILO_ENABLE_QUESTION_TOOL: "true",
            KILO_CLIENT: "desktop",
          }),
        ),
      )

      expect(flags.pure).toBe(true)
      expect(flags.autoShare).toBe(true)
      expect(flags.disableDefaultPlugins).toBe(true)
      expect(flags.disableChannelDb).toBe(true)
      expect(flags.disableEmbeddedWebUi).toBe(true)
      expect(flags.disableExternalSkills).toBe(true)
      expect(flags.disableLspDownload).toBe(true)
      expect(flags.skipMigrations).toBe(true)
      expect(flags.disableClaudeCodePrompt).toBe(false)
      expect(flags.enableExa).toBe(true)
      expect(flags.enableParallel).toBe(true)
      expect(flags.enableExperimentalModels).toBe(true)
      expect(flags.enableQuestionTool).toBe(true)
      expect(flags.experimentalScout).toBe(true)
      expect(flags.experimentalBackgroundSubagents).toBe(true)
      expect(flags.experimentalLspTy).toBe(false)
      expect(flags.experimentalLspTool).toBe(true)
      expect(flags.experimentalOxfmt).toBe(true)
      expect(flags.experimentalPlanMode).toBe(true)
      expect(flags.experimentalEventSystem).toBe(true)
      expect(flags.experimentalWorkspaces).toBe(true)
      expect(flags.experimentalIconDiscovery).toBe(true)
      expect(flags.experimentalNativeLlm).toBe(false)
      expect(flags.experimentalWebSockets).toBe(false)
      expect(flags.client).toBe("desktop")
    }),
  )

  it.effect("defaultLayer parses KILO_EXPERIMENTAL_LSP_TY", () =>
    Effect.gen(function* () {
      const flags = yield* readFlags.pipe(
        Effect.provide(
          fromConfig({
            KILO_EXPERIMENTAL_LSP_TY: "true",
          }),
        ),
      )

      expect(flags.experimentalLspTy).toBe(true)
    }),
  )

  it.effect("enables native LLM via dedicated flag only", () =>
    Effect.gen(function* () {
      const explicit = yield* readFlags.pipe(Effect.provide(fromConfig({ KILO_EXPERIMENTAL_NATIVE_LLM: "true" })))
      const umbrella = yield* readFlags.pipe(Effect.provide(fromConfig({ KILO_EXPERIMENTAL: "true" })))

      expect(explicit.experimentalNativeLlm).toBe(true)
      expect(umbrella.experimentalNativeLlm).toBe(false)
    }),
  )

  it.effect("enables WebSockets via dedicated flag only", () =>
    Effect.gen(function* () {
      const explicit = yield* readFlags.pipe(Effect.provide(fromConfig({ KILO_EXPERIMENTAL_WEBSOCKETS: "true" })))
      const umbrella = yield* readFlags.pipe(Effect.provide(fromConfig({ KILO_EXPERIMENTAL: "true" })))

      expect(explicit.experimentalWebSockets).toBe(true)
      expect(umbrella.experimentalWebSockets).toBe(false)
    }),
  )

  it.effect("layer accepts partial test overrides and fills defaults from Config definitions", () =>
    Effect.gen(function* () {
      const flags = yield* readFlags.pipe(
        Effect.provide(RuntimeFlags.layer({ disableDefaultPlugins: true, bashDefaultTimeoutMs: 1_000 })),
      )

      expect(flags.pure).toBe(false)
      expect(flags.autoShare).toBe(false)
      expect(flags.disableDefaultPlugins).toBe(true)
      expect(flags.disableChannelDb).toBe(false)
      expect(flags.disableEmbeddedWebUi).toBe(false)
      expect(flags.disableExternalSkills).toBe(false)
      expect(flags.disableLspDownload).toBe(false)
      expect(flags.skipMigrations).toBe(false)
      expect(flags.disableClaudeCodePrompt).toBe(false)
      expect(flags.disableClaudeCodeSkills).toBe(false)
      expect(flags.enableExa).toBe(false)
      expect(flags.experimentalIconDiscovery).toBe(false)
      expect(flags.experimentalOxfmt).toBe(false)
      expect(flags.outputTokenMax).toBeUndefined()
      expect(flags.bashDefaultTimeoutMs).toBe(1_000)
      expect(flags.enableExperimentalModels).toBe(false)
      expect(flags.client).toBe("cli")
    }),
  )

  it.effect("experimentalIconDiscovery defaults to false", () =>
    Effect.gen(function* () {
      const flags = yield* readFlags.pipe(Effect.provide(fromConfig({})))

      expect(flags.experimentalIconDiscovery).toBe(false)
    }),
  )

  it.effect("disableExternalSkills defaults to false", () =>
    Effect.gen(function* () {
      const flags = yield* readFlags.pipe(Effect.provide(fromConfig({})))

      expect(flags.disableExternalSkills).toBe(false)
    }),
  )

  it.effect("disableExternalSkills reads KILO_DISABLE_EXTERNAL_SKILLS", () =>
    Effect.gen(function* () {
      const flags = yield* readFlags.pipe(Effect.provide(fromConfig({ KILO_DISABLE_EXTERNAL_SKILLS: "true" })))

      expect(flags.disableExternalSkills).toBe(true)
    }),
  )

  it.effect("disableLspDownload defaults to false", () =>
    Effect.gen(function* () {
      const flags = yield* readFlags.pipe(Effect.provide(fromConfig({})))

      expect(flags.disableLspDownload).toBe(false)
    }),
  )

  it.effect("disableLspDownload reads KILO_DISABLE_LSP_DOWNLOAD", () =>
    Effect.gen(function* () {
      const flags = yield* readFlags.pipe(Effect.provide(fromConfig({ KILO_DISABLE_LSP_DOWNLOAD: "true" })))

      expect(flags.disableLspDownload).toBe(true)
    }),
  )

  it.effect("skipMigrations defaults to false", () =>
    Effect.gen(function* () {
      const flags = yield* readFlags.pipe(Effect.provide(fromConfig({})))

      expect(flags.skipMigrations).toBe(false)
    }),
  )

  it.effect("skipMigrations reads KILO_SKIP_MIGRATIONS", () =>
    Effect.gen(function* () {
      const flags = yield* readFlags.pipe(Effect.provide(fromConfig({ KILO_SKIP_MIGRATIONS: "true" })))

      expect(flags.skipMigrations).toBe(true)
    }),
  )

  it.effect("disableClaudeCodePrompt defaults to false", () =>
    Effect.gen(function* () {
      const flags = yield* readFlags.pipe(Effect.provide(fromConfig({})))

      expect(flags.disableClaudeCodePrompt).toBe(false)
    }),
  )

  it.effect("disableClaudeCodePrompt reads KILO_DISABLE_CLAUDE_CODE_PROMPT", () =>
    Effect.gen(function* () {
      const flags = yield* readFlags.pipe(Effect.provide(fromConfig({ KILO_DISABLE_CLAUDE_CODE_PROMPT: "true" })))

      expect(flags.disableClaudeCodePrompt).toBe(true)
    }),
  )

  it.effect("disableClaudeCodePrompt inherits KILO_DISABLE_CLAUDE_CODE", () =>
    Effect.gen(function* () {
      const flags = yield* readFlags.pipe(Effect.provide(fromConfig({ KILO_DISABLE_CLAUDE_CODE: "true" })))

      expect(flags.disableClaudeCodePrompt).toBe(true)
    }),
  )

  it.effect("experimentalIconDiscovery reads KILO_EXPERIMENTAL_ICON_DISCOVERY", () =>
    Effect.gen(function* () {
      const flags = yield* readFlags.pipe(Effect.provide(fromConfig({ KILO_EXPERIMENTAL_ICON_DISCOVERY: "true" })))

      expect(flags.experimentalIconDiscovery).toBe(true)
    }),
  )

  it.effect("experimentalIconDiscovery inherits KILO_EXPERIMENTAL", () =>
    Effect.gen(function* () {
      const flags = yield* readFlags.pipe(Effect.provide(fromConfig({ KILO_EXPERIMENTAL: "true" })))

      expect(flags.experimentalIconDiscovery).toBe(true)
    }),
  )

  it.effect("specific experimental flags override KILO_EXPERIMENTAL", () =>
    Effect.gen(function* () {
      const flags = yield* readFlags.pipe(
        Effect.provide(
          fromConfig({
            KILO_EXPERIMENTAL: "true",
            KILO_EXPERIMENTAL_ICON_DISCOVERY: "false",
          }),
        ),
      )

      expect(flags.experimentalIconDiscovery).toBe(false)
    }),
  )

  it.effect("experimentalOxfmt defaults to false", () =>
    Effect.gen(function* () {
      const flags = yield* readFlags.pipe(Effect.provide(fromConfig({})))

      expect(flags.experimentalOxfmt).toBe(false)
    }),
  )

  it.effect("experimentalOxfmt is enabled by KILO_EXPERIMENTAL_OXFMT", () =>
    Effect.gen(function* () {
      const flags = yield* readFlags.pipe(
        Effect.provide(
          fromConfig({
            KILO_EXPERIMENTAL_OXFMT: "true",
          }),
        ),
      )

      expect(flags.experimentalOxfmt).toBe(true)
    }),
  )

  it.effect("experimentalOxfmt inherits KILO_EXPERIMENTAL", () =>
    Effect.gen(function* () {
      const flags = yield* readFlags.pipe(
        Effect.provide(
          fromConfig({
            KILO_EXPERIMENTAL: "true",
          }),
        ),
      )

      expect(flags.experimentalOxfmt).toBe(true)
    }),
  )

  for (const input of [
    { name: "absent", config: {}, expected: undefined },
    {
      name: "valid positive integer",
      config: { KILO_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS: "1234" },
      expected: 1234,
    },
    {
      name: "invalid string",
      config: { KILO_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS: "nope" },
      expected: undefined,
    },
    { name: "zero", config: { KILO_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS: "0" }, expected: undefined },
    { name: "negative", config: { KILO_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS: "-1" }, expected: undefined },
    {
      name: "non-integer",
      config: { KILO_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS: "1.5" },
      expected: undefined,
    },
  ]) {
    it.effect(`parses bashDefaultTimeoutMs from config: ${input.name}`, () =>
      Effect.gen(function* () {
        const flags = yield* readFlags.pipe(Effect.provide(fromConfig(input.config)))

        expect(flags.bashDefaultTimeoutMs).toBe(input.expected)
      }),
    )
  }

  for (const input of [
    { name: "absent", config: {}, expected: undefined },
    {
      name: "valid positive integer",
      config: { KILO_EXPERIMENTAL_OUTPUT_TOKEN_MAX: "1234" },
      expected: 1234,
    },
    {
      name: "invalid string",
      config: { KILO_EXPERIMENTAL_OUTPUT_TOKEN_MAX: "nope" },
      expected: undefined,
    },
    { name: "zero", config: { KILO_EXPERIMENTAL_OUTPUT_TOKEN_MAX: "0" }, expected: undefined },
    { name: "negative", config: { KILO_EXPERIMENTAL_OUTPUT_TOKEN_MAX: "-1" }, expected: undefined },
    {
      name: "non-integer",
      config: { KILO_EXPERIMENTAL_OUTPUT_TOKEN_MAX: "1.5" },
      expected: undefined,
    },
  ]) {
    it.effect(`parses outputTokenMax from config: ${input.name}`, () =>
      Effect.gen(function* () {
        const flags = yield* readFlags.pipe(Effect.provide(fromConfig(input.config)))

        expect(flags.outputTokenMax).toBe(input.expected)
      }),
    )
  }

  it.effect("layer ignores the active ConfigProvider for omitted test overrides", () =>
    Effect.gen(function* () {
      const flags = yield* readFlags.pipe(
        Effect.provide(RuntimeFlags.layer()),
        Effect.provide(
          ConfigProvider.layer(
            ConfigProvider.fromUnknown({
              KILO_PURE: "true",
              KILO_DISABLE_DEFAULT_PLUGINS: "true",
              KILO_DISABLE_EXTERNAL_SKILLS: "true",
              KILO_DISABLE_LSP_DOWNLOAD: "true",
              KILO_SKIP_MIGRATIONS: "true",
              KILO_EXPERIMENTAL: "true",
              KILO_ENABLE_EXA: "true",
              KILO_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS: "1234",
              KILO_CLIENT: "desktop",
            }),
          ),
        ),
      )

      expect(flags.pure).toBe(false)
      expect(flags.disableDefaultPlugins).toBe(false)
      expect(flags.disableChannelDb).toBe(false)
      expect(flags.disableEmbeddedWebUi).toBe(false)
      expect(flags.disableExternalSkills).toBe(false)
      expect(flags.disableLspDownload).toBe(false)
      expect(flags.skipMigrations).toBe(false)
      expect(flags.disableClaudeCodePrompt).toBe(false)
      expect(flags.disableClaudeCodeSkills).toBe(false)
      expect(flags.enableExa).toBe(false)
      expect(flags.experimentalIconDiscovery).toBe(false)
      expect(flags.experimentalOxfmt).toBe(false)
      expect(flags.outputTokenMax).toBeUndefined()
      expect(flags.bashDefaultTimeoutMs).toBeUndefined()
      expect(flags.client).toBe("cli")
    }),
  )

  it.effect("disableClaudeCodeSkills defaults to false", () =>
    Effect.gen(function* () {
      const flags = yield* readFlags.pipe(Effect.provide(fromConfig({})))

      expect(flags.disableClaudeCodeSkills).toBe(false)
    }),
  )

  it.effect("disableClaudeCodeSkills reads KILO_DISABLE_CLAUDE_CODE_SKILLS", () =>
    Effect.gen(function* () {
      const flags = yield* readFlags.pipe(Effect.provide(fromConfig({ KILO_DISABLE_CLAUDE_CODE_SKILLS: "true" })))

      expect(flags.disableClaudeCodeSkills).toBe(true)
    }),
  )

  it.effect("disableClaudeCodeSkills inherits KILO_DISABLE_CLAUDE_CODE", () =>
    Effect.gen(function* () {
      const flags = yield* readFlags.pipe(Effect.provide(fromConfig({ KILO_DISABLE_CLAUDE_CODE: "true" })))

      expect(flags.disableClaudeCodeSkills).toBe(true)
    }),
  )
})
