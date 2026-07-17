import { afterEach, beforeAll, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import fs from "fs/promises"
import path from "path"
import { Agent } from "../../src/agent/agent"
import { BackgroundJob } from "../../src/background/job"
import { Bus } from "../../src/bus"
import { SessionRunState } from "../../src/session/run-state"
import { SessionStatus } from "../../src/session/status"
import { Config } from "../../src/config/config"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import * as CrossSpawnSpawner from "@opencode-ai/core/cross-spawn-spawner"
import { Global } from "@opencode-ai/core/global"
import { Session } from "../../src/session/session"
import { MessageV2 } from "../../src/session/message-v2"
import type { SessionPrompt } from "../../src/session/prompt"
import { Provider } from "../../src/provider/provider"
import { MessageID, PartID } from "../../src/session/schema"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { TaskTool, type TaskPromptOps } from "../../src/tool/task"
import { Truncate } from "../../src/tool/truncate"
import { ToolRegistry } from "../../src/tool/registry"
import { disposeAllInstances, provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const state = path.join(Global.Path.state, "model.json")

afterEach(async () => {
  process.env.KILO_CLIENT = "cli"
  await fs.rm(state, { force: true }).catch(() => undefined)
  await disposeAllInstances()
})

beforeAll(async () => {
  process.env.KILO_CLIENT = "cli"
  await fs.rm(state, { force: true }).catch(() => undefined)
})

const parent = {
  providerID: ProviderV2.ID.make("test"),
  modelID: ModelV2.ID.make("parent-model"),
}

const saved = {
  providerID: ProviderV2.ID.make("test"),
  modelID: ModelV2.ID.make("saved-model"),
}

const cfg = {
  providerID: ProviderV2.ID.make("test"),
  modelID: ModelV2.ID.make("config-model"),
}

const inherited = "thorough"
const overrideVariant = "full"
const savedVariant = "fast"
const cfgVariant = "balanced"
const sub = {
  providerID: ProviderV2.ID.make("sub-provider"),
  modelID: ModelV2.ID.make("sub-model"),
}
const subVariant = "deep"

function spec(id: string, variants: string[] = []) {
  return {
    id,
    name: id,
    attachment: false,
    reasoning: variants.length > 0,
    temperature: false,
    tool_call: true,
    release_date: "2025-01-01",
    limit: { context: 100_000, output: 10_000 },
    cost: { input: 0, output: 0 },
    options: {},
    variants: Object.fromEntries(variants.map((variant) => [variant, {}])),
  }
}

function custom(id: string, model: string, variants: string[] = []) {
  return {
    name: id,
    id,
    env: [],
    npm: "@ai-sdk/openai-compatible",
    models: {
      [model]: spec(model, variants),
    },
    options: { apiKey: "test-key", baseURL: "http://localhost:1/v1" },
  }
}

const catalog = {
  provider: {
    test: {
      id: "test",
      name: "Test",
      env: [],
      npm: "@ai-sdk/openai-compatible",
      models: {
        "parent-model": spec("parent-model", [inherited, cfgVariant, savedVariant, overrideVariant]),
        "saved-model": spec("saved-model", [cfgVariant, savedVariant, overrideVariant]),
        "config-model": spec("config-model", [cfgVariant, savedVariant, overrideVariant]),
      },
      options: { apiKey: "test-key", baseURL: "http://localhost:1/v1" },
    },
    "sub-provider": custom("sub-provider", "sub-model", [subVariant, overrideVariant]),
  },
}

const it = testEffect(
  Layer.mergeAll(
    Agent.defaultLayer,
    BackgroundJob.defaultLayer,
    Bus.defaultLayer,
    Config.defaultLayer,
    RuntimeFlags.layer(),
    SessionRunState.defaultLayer,
    SessionStatus.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    Session.defaultLayer,
    Truncate.defaultLayer,
    Provider.defaultLayer,
    ToolRegistry.defaultLayer,
    Database.defaultLayer,
  ),
)

const seed = Effect.fn("TaskToolModelTest.seed")(function* (title = "Parent", variant?: string) {
  const session = yield* Session.Service
  const chat = yield* session.create({ title })
  const user = yield* session.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID: chat.id,
    agent: "build",
    model: parent,
    time: { created: Date.now() },
  })
  const assistant: MessageV2.Assistant = {
    id: MessageID.ascending(),
    role: "assistant",
    parentID: user.id,
    sessionID: chat.id,
    mode: "build",
    agent: "build",
    cost: 0,
    path: { cwd: "/tmp", root: "/tmp" },
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: parent.modelID,
    providerID: parent.providerID,
    variant,
    time: { created: Date.now() },
  }
  yield* session.updateMessage(assistant)
  return { chat, assistant }
})

function stubOps(opts?: { onPrompt?: (input: SessionPrompt.PromptInput) => void; text?: string }): TaskPromptOps {
  const prompt = (input: SessionPrompt.PromptInput) =>
    Effect.sync(() => {
      opts?.onPrompt?.(input)
      return reply(input, opts?.text ?? "done")
    })
  return {
    cancel: () => Effect.void,
    resolvePromptParts: (template) => Effect.succeed([{ type: "text" as const, text: template }]),
    prompt,
  }
}

function reply(input: SessionPrompt.PromptInput, text: string): MessageV2.WithParts {
  const id = MessageID.ascending()
  return {
    info: {
      id,
      role: "assistant",
      parentID: input.messageID ?? MessageID.ascending(),
      sessionID: input.sessionID,
      mode: input.agent ?? "general",
      agent: input.agent ?? "general",
      cost: 0,
      path: { cwd: "/tmp", root: "/tmp" },
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      modelID: input.model?.modelID ?? parent.modelID,
      providerID: input.model?.providerID ?? parent.providerID,
      time: { created: Date.now() },
      finish: "stop",
    },
    parts: [
      {
        id: PartID.ascending(),
        messageID: id,
        sessionID: input.sessionID,
        type: "text",
        text,
      },
    ],
  }
}

function writeState(input: unknown) {
  return Effect.promise(async () => {
    await fs.mkdir(Global.Path.state, { recursive: true })
    await fs.writeFile(state, JSON.stringify(input))
  })
}

function run(input: {
  agent: "pinned" | "worker"
  state?: unknown
  client?: string
  variant?: string
  config?: Pick<Config.Info, "subagent_model" | "subagent_variant" | "subagent_variant_overrides">
  workerVariant?: string
}) {
  return provideTmpdirInstance(
    () =>
      Effect.gen(function* () {
        process.env.KILO_CLIENT = input.client ?? "cli"
        if (input.state) yield* writeState(input.state)

        const { chat, assistant } = yield* seed(input.agent, input.variant)
        const tool = yield* TaskTool
        const def = yield* tool.init()
        let seen: SessionPrompt.PromptInput | undefined
        const promptOps = stubOps({ onPrompt: (value) => (seen = value) })

        const result = yield* def.execute(
          {
            description: `run ${input.agent}`,
            prompt: "inspect resolution",
            subagent_type: input.agent,
          },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "build",
            abort: new AbortController().signal,
            extra: { promptOps, bypassAgentCheck: true },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )

        return {
          prompt: seen?.model,
          variant: seen?.variant,
          model: result.metadata.model,
          metadataVariant: result.metadata.variant,
        }
      }),
    {
      config: {
        ...catalog,
        ...input.config,
        agent: {
          worker: { mode: "subagent", ...(input.workerVariant ? { variant: input.workerVariant } : {}) },
          pinned: { mode: "subagent", model: "test/config-model", variant: cfgVariant },
        },
      },
    },
  )
}

describe("tool.task model resolution", () => {
  it.live("legacy saved variant follows saved model for pinned", () =>
    run({
      agent: "pinned",
      state: { model: { pinned: saved }, variant: { "test/saved-model": savedVariant } },
    }).pipe(
      Effect.tap((result) =>
        Effect.sync(() => {
          expect(result.prompt).toEqual(saved)
          expect(result.variant).toEqual(savedVariant)
          expect(result.model).toEqual(saved)
          expect(result.metadataVariant).toEqual(savedVariant)
        }),
      ),
    ),
  )

  it.live("legacy saved variant beats agent variant for saved worker model", () =>
    run({
      agent: "worker",
      workerVariant: cfgVariant,
      state: { model: { worker: saved }, variant: { "test/saved-model": savedVariant } },
    }).pipe(
      Effect.tap((result) =>
        Effect.sync(() => {
          expect(result.prompt).toEqual(saved)
          expect(result.variant).toEqual(savedVariant)
          expect(result.model).toEqual(saved)
          expect(result.metadataVariant).toEqual(savedVariant)
        }),
      ),
    ),
  )

  it.live("saved model without variant leaves variant undefined", () =>
    run({
      agent: "worker",
      variant: inherited,
      state: { model: { worker: saved } },
    }).pipe(
      Effect.tap((result) =>
        Effect.sync(() => {
          expect(result.prompt).toEqual(saved)
          expect(result.variant).toBeUndefined()
          expect(result.model).toEqual(saved)
          expect(result.metadataVariant).toBeUndefined()
        }),
      ),
    ),
  )

  it.live("unrelated saved variant key ignored", () =>
    run({
      agent: "worker",
      state: { model: { worker: saved }, variant: { "other-provider/other-model": savedVariant } },
    }).pipe(
      Effect.tap((result) =>
        Effect.sync(() => {
          expect(result.prompt).toEqual(saved)
          expect(result.variant).toBeUndefined()
          expect(result.model).toEqual(saved)
          expect(result.metadataVariant).toBeUndefined()
        }),
      ),
    ),
  )

  it.live("stale legacy saved variant preserves the saved model", () =>
    run({
      agent: "worker",
      state: { model: { worker: saved }, variant: { "test/saved-model": "gone" } },
    }).pipe(
      Effect.tap((result) =>
        Effect.sync(() => {
          expect(result.prompt).toEqual(saved)
          expect(result.variant).toBeUndefined()
          expect(result.model).toEqual(saved)
          expect(result.metadataVariant).toBeUndefined()
        }),
      ),
    ),
  )

  it.live("missing saved entry falls back to agent config for pinned", () =>
    run({
      agent: "pinned",
      state: { model: { worker: saved } },
    }).pipe(
      Effect.tap((result) =>
        Effect.sync(() => {
          expect(result.prompt).toEqual(cfg)
          expect(result.variant).toEqual(cfgVariant)
          expect(result.model).toEqual(cfg)
          expect(result.metadataVariant).toEqual(cfgVariant)
        }),
      ),
    ),
  )

  it.live("configured subagent default model and variant apply to task workers", () =>
    run({
      agent: "worker",
      variant: inherited,
      config: { subagent_model: "sub-provider/sub-model", subagent_variant: subVariant },
    }).pipe(
      Effect.tap((result) =>
        Effect.sync(() => {
          expect(result.prompt).toEqual(sub)
          expect(result.variant).toEqual(subVariant)
          expect(result.model).toEqual(sub)
          expect(result.metadataVariant).toEqual(subVariant)
        }),
      ),
    ),
  )

  it.live("per-agent task model remains above the configured subagent default", () =>
    run({
      agent: "pinned",
      variant: inherited,
      config: { subagent_model: "sub-provider/sub-model", subagent_variant: subVariant },
    }).pipe(
      Effect.tap((result) =>
        Effect.sync(() => {
          expect(result.prompt).toEqual(cfg)
          expect(result.variant).toEqual(cfgVariant)
          expect(result.model).toEqual(cfg)
          expect(result.metadataVariant).toEqual(cfgVariant)
        }),
      ),
    ),
  )

  it.live("model-specific override replaces an inherited parent variant", () =>
    run({
      agent: "worker",
      variant: inherited,
      config: { subagent_variant_overrides: { "test/parent-model": overrideVariant } },
    }).pipe(
      Effect.tap((result) =>
        Effect.sync(() => {
          expect(result.prompt).toEqual(parent)
          expect(result.variant).toEqual(overrideVariant)
          expect(result.model).toEqual(parent)
          expect(result.metadataVariant).toEqual(overrideVariant)
        }),
      ),
    ),
  )

  it.live("model-specific override applies to a custom subagent model and variant", () =>
    run({
      agent: "pinned",
      variant: inherited,
      config: { subagent_variant_overrides: { "test/config-model": overrideVariant } },
    }).pipe(
      Effect.tap((result) =>
        Effect.sync(() => {
          expect(result.prompt).toEqual(cfg)
          expect(result.variant).toEqual(overrideVariant)
          expect(result.model).toEqual(cfg)
          expect(result.metadataVariant).toEqual(overrideVariant)
        }),
      ),
    ),
  )

  it.live("model-specific override follows a saved custom subagent model", () =>
    run({
      agent: "worker",
      state: { model: { worker: saved }, variant: { "test/saved-model": savedVariant } },
      config: { subagent_variant_overrides: { "test/saved-model": overrideVariant } },
    }).pipe(
      Effect.tap((result) =>
        Effect.sync(() => {
          expect(result.prompt).toEqual(saved)
          expect(result.variant).toEqual(overrideVariant)
          expect(result.model).toEqual(saved)
          expect(result.metadataVariant).toEqual(overrideVariant)
        }),
      ),
    ),
  )

  it.live("stale model-specific override preserves the resolved variant", () =>
    run({
      agent: "pinned",
      variant: inherited,
      config: { subagent_variant_overrides: { "test/config-model": "gone" } },
    }).pipe(
      Effect.tap((result) =>
        Effect.sync(() => {
          expect(result.prompt).toEqual(cfg)
          expect(result.variant).toEqual(cfgVariant)
          expect(result.model).toEqual(cfg)
          expect(result.metadataVariant).toEqual(cfgVariant)
        }),
      ),
    ),
  )

  it.live("unavailable configured subagent model falls back to the parent model override", () =>
    run({
      agent: "worker",
      variant: inherited,
      config: {
        subagent_model: "missing-provider/missing-model",
        subagent_variant: subVariant,
        subagent_variant_overrides: { "test/parent-model": overrideVariant },
      },
    }).pipe(
      Effect.tap((result) =>
        Effect.sync(() => {
          expect(result.prompt).toEqual(parent)
          expect(result.variant).toEqual(overrideVariant)
          expect(result.model).toEqual(parent)
          expect(result.metadataVariant).toEqual(overrideVariant)
        }),
      ),
    ),
  )

  it.live("unavailable configured subagent model falls back to the parent model", () =>
    run({
      agent: "worker",
      variant: inherited,
      config: { subagent_model: "missing-provider/missing-model", subagent_variant: subVariant },
    }).pipe(
      Effect.tap((result) =>
        Effect.sync(() => {
          expect(result.prompt).toEqual(parent)
          expect(result.variant).toEqual(inherited)
          expect(result.model).toEqual(parent)
          expect(result.metadataVariant).toEqual(inherited)
        }),
      ),
    ),
  )

  it.live("stale configured subagent variant is ignored without dropping its model", () =>
    run({
      agent: "worker",
      config: { subagent_model: "sub-provider/sub-model", subagent_variant: "gone" },
    }).pipe(
      Effect.tap((result) =>
        Effect.sync(() => {
          expect(result.prompt).toEqual(sub)
          expect(result.variant).toBeUndefined()
          expect(result.model).toEqual(sub)
          expect(result.metadataVariant).toBeUndefined()
        }),
      ),
    ),
  )

  it.live("no file and no agent config inherits the parent model and variant", () =>
    run({
      agent: "worker",
      variant: inherited,
    }).pipe(
      Effect.tap((result) =>
        Effect.sync(() => {
          expect(result.prompt).toEqual(parent)
          expect(result.variant).toEqual(inherited)
          expect(result.model).toEqual(parent)
          expect(result.metadataVariant).toEqual(inherited)
        }),
      ),
    ),
  )

  it.live("worker config variant applies to parent model when agent model is unset", () =>
    run({
      agent: "worker",
      workerVariant: cfgVariant,
    }).pipe(
      Effect.tap((result) =>
        Effect.sync(() => {
          expect(result.prompt).toEqual(parent)
          expect(result.variant).toEqual(cfgVariant)
          expect(result.model).toEqual(parent)
          expect(result.metadataVariant).toEqual(cfgVariant)
        }),
      ),
    ),
  )

  it.live("worker default variant intentionally inherits the parent variant", () =>
    run({
      agent: "worker",
      variant: inherited,
      workerVariant: "default",
    }).pipe(
      Effect.tap((result) =>
        Effect.sync(() => {
          expect(result.prompt).toEqual(parent)
          expect(result.variant).toEqual(inherited)
          expect(result.model).toEqual(parent)
          expect(result.metadataVariant).toEqual(inherited)
        }),
      ),
    ),
  )

  it.live("malformed file ignored and falls back to agent config for pinned", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          process.env.KILO_CLIENT = "cli"
          yield* Effect.promise(async () => {
            await fs.mkdir(Global.Path.state, { recursive: true })
            await fs.writeFile(state, "{bad json")
          })

          const { chat, assistant } = yield* seed("pinned")
          const tool = yield* TaskTool
          const def = yield* tool.init()
          let seen: SessionPrompt.PromptInput | undefined
          const promptOps = stubOps({ onPrompt: (value) => (seen = value) })

          const result = yield* def.execute(
            {
              description: "run pinned",
              prompt: "inspect resolution",
              subagent_type: "pinned",
            },
            {
              sessionID: chat.id,
              messageID: assistant.id,
              agent: "build",
              abort: new AbortController().signal,
              extra: { promptOps, bypassAgentCheck: true },
              messages: [],
              metadata: () => Effect.void,
              ask: () => Effect.void,
            },
          )

          expect(seen?.model).toEqual(cfg)
          expect(seen?.variant).toEqual(cfgVariant)
          expect(result.metadata.model).toEqual(cfg)
          expect(result.metadata.variant).toEqual(cfgVariant)
        }),
      {
        config: {
          ...catalog,
          agent: {
            worker: { mode: "subagent" },
            pinned: { mode: "subagent", model: "test/config-model", variant: cfgVariant },
          },
        },
      },
    ),
  )

  it.live("non-CLI client gate ignores saved worker model and uses parent", () =>
    run({
      agent: "worker",
      client: "vscode",
      workerVariant: cfgVariant,
      state: { model: { worker: saved }, variant: { "test/saved-model": savedVariant } },
    }).pipe(
      Effect.tap((result) =>
        Effect.sync(() => {
          expect(result.prompt).toEqual(parent)
          expect(result.variant).toEqual(cfgVariant)
          expect(result.model).toEqual(parent)
          expect(result.metadataVariant).toEqual(cfgVariant)
        }),
      ),
    ),
  )
})
