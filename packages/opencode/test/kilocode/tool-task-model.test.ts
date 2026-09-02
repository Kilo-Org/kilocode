import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { afterEach, beforeAll, describe, expect } from "bun:test"
import { Cause, Deferred, Effect, Exit } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import fs from "fs/promises"
import path from "path"
import { Agent } from "../../src/agent/agent"
import { BackgroundJob } from "../../src/background/job"
import { Bus } from "../../src/bus"
import { SessionRunState } from "../../src/session/run-state"
import { SessionStatus } from "../../src/session/status"
import { SessionDrain } from "@/kilocode/session/drain"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Config } from "../../src/config/config"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import * as CrossSpawnSpawner from "@opencode-ai/core/cross-spawn-spawner"
import { Global } from "@opencode-ai/core/global"
import { Instance } from "../../src/kilocode/instance"
import { Session } from "../../src/session/session"
import { MessageV2 } from "../../src/session/message-v2"
import type { SessionPrompt } from "../../src/session/prompt"
import { MessageID, PartID } from "../../src/session/schema"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { Provider } from "../../src/provider/provider"
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
  providerID: ProviderV2.ID.make("parent-provider"),
  modelID: ModelV2.ID.make("parent-model"),
}

const saved = {
  providerID: ProviderV2.ID.make("saved-provider"),
  modelID: ModelV2.ID.make("saved-model"),
}

const cfg = {
  providerID: ProviderV2.ID.make("config-provider"),
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

function custom(id: string, model: string, variants: string[] = []) {
  return {
    name: id,
    id,
    env: [],
    npm: "@ai-sdk/openai-compatible",
    models: {
      [model]: {
        id: model,
        name: model,
        attachment: false,
        reasoning: variants.length > 0,
        temperature: false,
        tool_call: true,
        release_date: "2025-01-01",
        limit: { context: 100_000, output: 10_000 },
        cost: { input: 0, output: 0 },
        options: {},
        variants: Object.fromEntries(variants.map((variant) => [variant, {}])),
      },
    },
    options: { apiKey: "test-key", baseURL: "http://localhost:1/v1" },
  }
}

const catalog = {
  provider: {
    "parent-provider": custom("parent-provider", "parent-model", [inherited, overrideVariant]),
    "saved-provider": custom("saved-provider", "saved-model", [savedVariant, overrideVariant]),
    "config-provider": custom("config-provider", "config-model", [cfgVariant, overrideVariant]),
    "sub-provider": custom("sub-provider", "sub-model", [subVariant, overrideVariant]),
  },
}

const it = testEffect(
  LayerNode.compile(
    LayerNode.group([
      Agent.node,
      BackgroundJob.node,
      Bus.node,
      Config.node,
      RuntimeFlags.node,
      SessionRunState.node,
      SessionStatus.node,
      SessionDrain.node,
      EventV2Bridge.node,
      CrossSpawnSpawner.node,
      Session.node,
      SessionProjector.node,
      Truncate.node,
      Provider.node,
      ToolRegistry.node,
      Database.node,
    ]),
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
  enabled?: boolean
  selection?: { model?: string | null; provider?: string | null; variant?: string | null }
  resume?: Session.Info["model"]
}) {
  return provideTmpdirInstance(
    () =>
      Effect.gen(function* () {
        process.env.KILO_CLIENT = input.client ?? "cli"
        if (input.state) yield* writeState(input.state)

        const { chat, assistant } = yield* seed(input.agent, input.variant)
        const sessions = yield* Session.Service
        const child = input.resume ? yield* sessions.create({ parentID: chat.id, model: input.resume }) : undefined
        const tool = yield* TaskTool
        const def = yield* tool.init()
        let seen: SessionPrompt.PromptInput | undefined
        const promptOps = stubOps({ onPrompt: (value) => (seen = value) })

        const result = yield* def
          .execute(
            {
              description: `run ${input.agent}`,
              prompt: "inspect resolution",
              subagent_type: input.agent,
              task_id: child?.id,
              ...input.selection,
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
          .pipe(
            Effect.onError(() =>
              Effect.gen(function* () {
                expect(seen).toBeUndefined()
                expect(yield* sessions.children(chat.id)).toHaveLength(child ? 1 : 0)
              }),
            ),
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
        experimental: { task_model_selection: input.enabled ?? false },
        agent: {
          worker: { mode: "subagent" },
          pinned: { mode: "subagent", model: "config-provider/config-model", variant: cfgVariant },
        },
      },
    },
  )
}

describe("tool.task model resolution", () => {
  for (const example of [
    { selection: { model: "sub-provider/sub-model", variant: subVariant }, model: sub, variant: subVariant },
    { selection: { model: "SUB model", provider: "sub-provider" }, model: sub, variant: undefined },
    { selection: { variant: overrideVariant }, model: cfg, variant: overrideVariant },
    { selection: {}, model: cfg, variant: cfgVariant },
    { selection: { model: null, provider: null, variant: null }, model: cfg, variant: cfgVariant },
    { selection: { model: "sub-model", provider: null, variant: null }, model: sub, variant: undefined },
    { selection: { model: null, provider: null, variant: overrideVariant }, model: cfg, variant: overrideVariant },
  ]) {
    it.live(`selects ${JSON.stringify(example.selection)} when enabled`, () =>
      run({ agent: "pinned", enabled: true, selection: example.selection, variant: inherited }).pipe(
        Effect.tap((result) =>
          Effect.sync(() => {
            expect(result.prompt).toEqual(example.model)
            expect(result.variant).toEqual(example.variant)
            expect(result.model).toEqual(example.model)
            expect(result.metadataVariant).toEqual(example.variant)
          }),
        ),
      ),
    )
  }

  for (const example of [
    { enabled: false, selection: { model: "sub-model" }, error: "experimental.task_model_selection=true" },
    { enabled: false, selection: { variant: "full" }, error: "experimental.task_model_selection=true" },
    { enabled: true, selection: { provider: "sub-provider" }, error: "provider requires a model" },
    { enabled: true, selection: { model: "missing" }, error: "model is not available" },
    { enabled: true, selection: { model: "model" }, error: "is ambiguous" },
    { enabled: true, selection: { model: "sub-model", provider: "missing" }, error: "provider is not available" },
    { enabled: true, selection: { model: "sub-model", variant: "missing" }, error: "Available variants:" },
    { enabled: true, selection: { variant: "missing" }, error: "Available variants:" },
    { enabled: true, selection: { model: " " }, error: "must not be empty" },
    { enabled: true, selection: { variant: "__proto__" }, error: "Available variants:" },
  ]) {
    it.live(`rejects ${JSON.stringify(example.selection)} with selection ${example.enabled}`, () =>
      run({ agent: "worker", enabled: example.enabled, selection: example.selection }).pipe(
        Effect.exit,
        Effect.tap((result) =>
          Effect.sync(() => {
            expect(Exit.isFailure(result)).toBe(true)
            if (Exit.isFailure(result)) expect(Cause.pretty(result.cause)).toContain(example.error)
          }),
        ),
      ),
    )
  }

  for (const enabled of [false, true]) {
    for (const selection of [undefined, { model: null, provider: null, variant: null }]) {
      it.live(
        `inherits parent model and reasoning with selection ${JSON.stringify(selection)} and enabled ${enabled}`,
        () =>
          run({ agent: "worker", enabled, selection, variant: inherited }).pipe(
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

      it.live(
        `uses ${enabled ? "persisted" : "normal"} defaults on resume with selection ${JSON.stringify(selection)}`,
        () =>
          run({
            agent: "pinned",
            enabled,
            selection,
            resume: { id: sub.modelID, providerID: sub.providerID, variant: subVariant },
          }).pipe(
            Effect.tap((result) =>
              Effect.sync(() => {
                expect(result.prompt).toEqual(enabled ? sub : cfg)
                expect(result.variant).toEqual(enabled ? subVariant : cfgVariant)
              }),
            ),
          ),
      )
    }
  }

  it.live("allows a reasoning override on a resumed model", () =>
    run({
      agent: "pinned",
      enabled: true,
      resume: { id: sub.modelID, providerID: sub.providerID, variant: subVariant },
      selection: { variant: overrideVariant },
    }).pipe(
      Effect.tap((result) =>
        Effect.sync(() => {
          expect(result.prompt).toEqual(sub)
          expect(result.variant).toEqual(overrideVariant)
        }),
      ),
    ),
  )

  for (const enabled of [undefined, false, true]) {
    for (const background of [false, true]) {
      it.live(`advertises selection ${enabled} independently of background ${background}`, () =>
        provideTmpdirInstance(
          () =>
            Effect.gen(function* () {
              const tool = yield* TaskTool.pipe(
                Effect.provide(RuntimeFlags.layer({ experimentalBackgroundSubagents: background })),
              )
              const def = yield* tool.init()
              const fields = def.jsonSchema?.properties ?? {}
              for (const field of ["model", "provider", "variant"]) {
                expect(field in fields).toBe(enabled === true)
                expect(def.jsonSchema?.required).not.toContain(field)
                if (enabled) expect(fields[field]).toMatchObject({ anyOf: [{ type: "string" }, { type: "null" }] })
              }
              expect("background" in fields).toBe(background)
              expect(def.description.includes("Experimental subagent model selection is enabled")).toBe(
                enabled === true,
              )
              if (enabled) {
                expect(def.description).toContain(
                  "Only override model, provider, or variant when the user explicitly requests it",
                )
                expect(def.description).toContain("Omit these fields, or send null")
              }
            }),
          { config: { experimental: { task_model_selection: enabled } } },
        ),
      )
    }
  }

  for (const enabled of [false, true]) {
    for (const example of [
      { state: "completed", model: { ...cfg, variant: cfgVariant } },
      { state: "error", model: { ...cfg, variant: cfgVariant } },
      { state: "completed", model: { ...cfg, variant: undefined } },
      { state: "completed", model: undefined },
    ]) {
      it.live(
        `keeps parent selection ${JSON.stringify(example.model)} on background ${example.state} with selection ${enabled}`,
        () =>
          provideTmpdirInstance(
            () =>
              Effect.gen(function* () {
                const { chat, assistant } = yield* seed("background", inherited)
                const sessions = yield* Session.Service
                const notified = yield* Deferred.make<SessionPrompt.PromptInput>()
                const calls: SessionPrompt.PromptInput[] = []
                const tool = yield* TaskTool.pipe(
                  Effect.provide(RuntimeFlags.layer({ experimentalBackgroundSubagents: true })),
                )
                const def = yield* tool.init()
                const promptOps: TaskPromptOps = {
                  ...stubOps(),
                  prompt: (input) =>
                    Effect.gen(function* () {
                      calls.push(input)
                      if (input.sessionID === chat.id) {
                        yield* Deferred.succeed(notified, input)
                        return reply(input, "done")
                      }
                      if (example.model) {
                        yield* sessions.setAgentModel({
                          sessionID: chat.id,
                          agent: "build",
                          model: {
                            id: example.model.modelID,
                            providerID: example.model.providerID,
                            variant: example.model.variant,
                          },
                          time: Date.now(),
                        })
                      }
                      if (example.state === "error") return yield* Effect.die(new Error("task failed"))
                      return reply(input, "done")
                    }),
                }
                const result = yield* def.execute(
                  {
                    description: "background selection",
                    prompt: "inspect selection",
                    subagent_type: "general",
                    background: true,
                    ...(enabled ? { model: "sub-model", provider: "sub-provider", variant: subVariant } : {}),
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
                const notice = yield* Deferred.await(notified).pipe(Effect.timeout("5 seconds"))
                expect(result.metadata.model).toEqual(sub)
                expect(result.metadata.variant).toEqual(subVariant)
                expect(calls.at(0)?.model).toEqual(sub)
                expect(calls.at(0)?.variant).toEqual(subVariant)
                expect(notice.model).toEqual(example.model ? cfg : parent)
                expect(notice.variant).toEqual(example.model ? example.model.variant : inherited)
                expect(notice.parts).toEqual([
                  expect.objectContaining({
                    type: "text",
                    synthetic: true,
                    text: expect.stringContaining(`state="${example.state}"`),
                  }),
                ])
              }),
            {
              config: {
                ...catalog,
                ...(!enabled ? { subagent_model: "sub-provider/sub-model", subagent_variant: subVariant } : {}),
                experimental: { task_model_selection: enabled },
              },
            },
          ),
      )
    }
  }

  it.live("saved model beats agent config for pinned", () =>
    run({
      agent: "pinned",
      state: { model: { pinned: saved }, variant: { "saved-provider/saved-model": savedVariant } },
    }).pipe(
      Effect.tap((result) =>
        Effect.sync(() => {
          expect(result.prompt).toEqual(saved)
          expect(result.variant).toEqual(savedVariant)
          expect(result.model).toMatchObject({ ...saved, variant: savedVariant })
          expect(result.metadataVariant).toEqual(savedVariant)
        }),
      ),
    ),
  )

  it.live("saved model beats parent for worker", () =>
    run({
      agent: "worker",
      state: { model: { worker: saved }, variant: { "saved-provider/saved-model": savedVariant } },
    }).pipe(
      Effect.tap((result) =>
        Effect.sync(() => {
          expect(result.prompt).toEqual(saved)
          expect(result.variant).toEqual(savedVariant)
          expect(result.model).toMatchObject({ ...saved, variant: savedVariant })
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
      config: { subagent_variant_overrides: { "parent-provider/parent-model": overrideVariant } },
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
      config: { subagent_variant_overrides: { "config-provider/config-model": overrideVariant } },
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
      state: { model: { worker: saved }, variant: { "saved-provider/saved-model": savedVariant } },
      config: { subagent_variant_overrides: { "saved-provider/saved-model": overrideVariant } },
    }).pipe(
      Effect.tap((result) =>
        Effect.sync(() => {
          expect(result.prompt).toEqual(saved)
          expect(result.variant).toEqual(overrideVariant)
          expect(result.model).toMatchObject({ ...saved, variant: overrideVariant })
          expect(result.metadataVariant).toEqual(overrideVariant)
        }),
      ),
    ),
  )

  it.live("stale model-specific override preserves the resolved variant", () =>
    run({
      agent: "pinned",
      variant: inherited,
      config: { subagent_variant_overrides: { "config-provider/config-model": "gone" } },
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
        subagent_variant_overrides: { "parent-provider/parent-model": overrideVariant },
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
            pinned: { mode: "subagent", model: "config-provider/config-model", variant: cfgVariant },
          },
        },
      },
    ),
  )

  it.live("non-CLI client gate ignores saved worker model and uses parent", () =>
    run({
      agent: "worker",
      client: "vscode",
      state: { model: { worker: saved }, variant: { "saved-provider/saved-model": savedVariant } },
    }).pipe(
      Effect.tap((result) =>
        Effect.sync(() => {
          expect(result.prompt).toEqual(parent)
          expect(result.variant).toBeUndefined()
          expect(result.model).toEqual(parent)
          expect(result.metadataVariant).toBeUndefined()
        }),
      ),
    ),
  )
})
