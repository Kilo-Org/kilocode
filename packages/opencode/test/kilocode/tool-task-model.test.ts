import { afterEach, beforeAll, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import fs from "fs/promises"
import path from "path"
import { Agent } from "../../src/agent/agent"
import { Config } from "../../src/config"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { Global } from "../../src/global"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import type { SessionPrompt } from "../../src/session/prompt"
import { MessageID, PartID } from "../../src/session/schema"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { TaskTool, type TaskPromptOps } from "../../src/tool/task"
import { Truncate } from "../../src/tool"
import { ToolRegistry } from "../../src/tool"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const state = path.join(Global.Path.state, "model.json")

afterEach(async () => {
  process.env.KILO_CLIENT = "cli"
  await fs.rm(state, { force: true }).catch(() => undefined)
  await Instance.disposeAll()
})

beforeAll(async () => {
  process.env.KILO_CLIENT = "cli"
  await fs.rm(state, { force: true }).catch(() => undefined)
})

const parent = {
  providerID: ProviderID.make("parent-provider"),
  modelID: ModelID.make("parent-model"),
}

const saved = {
  providerID: ProviderID.make("saved-provider"),
  modelID: ModelID.make("saved-model"),
}

const cfg = {
  providerID: ProviderID.make("config-provider"),
  modelID: ModelID.make("config-model"),
}

const savedVariant = "fast"
const cfgVariant = "balanced"

const it = testEffect(
  Layer.mergeAll(
    Agent.defaultLayer,
    Config.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    Session.defaultLayer,
    Truncate.defaultLayer,
    ToolRegistry.defaultLayer,
  ),
)

const seed = Effect.fn("TaskToolModelTest.seed")(function* (title = "Parent") {
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
    time: { created: Date.now() },
  }
  yield* session.updateMessage(assistant)
  return { chat, assistant }
})

function stubOps(opts?: { onPrompt?: (input: SessionPrompt.PromptInput) => void; text?: string }): TaskPromptOps {
  return {
    cancel() {},
    resolvePromptParts: (template) => Effect.succeed([{ type: "text" as const, text: template }]),
    prompt: (input) =>
      Effect.sync(() => {
        opts?.onPrompt?.(input)
        return reply(input, opts?.text ?? "done")
      }),
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

function run(input: { agent: "pinned" | "worker"; state?: unknown; client?: string }) {
  return provideTmpdirInstance(
    () =>
      Effect.gen(function* () {
        process.env.KILO_CLIENT = input.client ?? "cli"
        if (input.state) yield* writeState(input.state)

        const { chat, assistant } = yield* seed(input.agent)
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
        agent: {
          worker: { mode: "subagent" },
          pinned: { mode: "subagent", model: "config-provider/config-model", variant: cfgVariant },
        },
      },
    },
  )
}

describe("tool.task model resolution", () => {
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

  it.live("no file and no agent config falls back to parent for worker", () =>
    run({
      agent: "worker",
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
