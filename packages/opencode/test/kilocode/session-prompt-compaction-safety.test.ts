// Regressions for SessionPrompt.runLoop compaction-history safety.
// Ensures Kilo's post-filterCompacted trim and post-summary media strip are
// applied before messages are serialized for the provider request.

import { NodeFileSystem } from "@effect/platform-node"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { Agent as AgentSvc } from "../../src/agent/agent"
import { Bus } from "../../src/bus"
import { Command } from "../../src/command"
import { Config } from "../../src/config"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { Env } from "../../src/env"
import { Ripgrep } from "../../src/file/ripgrep"
import { AppFileSystem } from "@opencode-ai/shared/filesystem"
import { Format } from "../../src/format"
import { LSP } from "../../src/lsp"
import { MCP } from "../../src/mcp"
import { Permission } from "../../src/permission"
import { Plugin } from "../../src/plugin"
import { Provider as ProviderSvc } from "../../src/provider"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Question } from "../../src/question"
import { Session } from "../../src/session"
import { SessionCompaction } from "../../src/session/compaction"
import { Instruction } from "../../src/session/instruction"
import { LLM } from "../../src/session/llm"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionProcessor } from "../../src/session/processor"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionRevert } from "../../src/session/revert"
import { SessionRunState } from "../../src/session/run-state"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { SessionStatus } from "../../src/session/status"
import { SystemPrompt } from "../../src/session/system"
import { SessionSummary } from "../../src/session/summary"
import { Todo } from "../../src/session/todo"
import { Skill } from "../../src/skill"
import { Snapshot } from "../../src/snapshot"
import { ToolRegistry, Truncate } from "../../src/tool"
import { Log } from "../../src/util"
import { provideTmpdirServer } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { TestLLMServer } from "../lib/llm-server"

Log.init({ print: false })

const ref = {
  providerID: ProviderID.make("test"),
  modelID: ModelID.make("test-model"),
}

const summary = Layer.succeed(
  SessionSummary.Service,
  SessionSummary.Service.of({
    summarize: () => Effect.void,
    diff: () => Effect.succeed([]),
    computeDiff: () => Effect.succeed([]),
  }),
)

const plugin = Layer.mock(Plugin.Service)({
  trigger: <Name extends string, Input, Output>(_name: Name, _input: Input, output: Output) => Effect.succeed(output),
  list: () => Effect.succeed([]),
  init: () => Effect.void,
})

const mcp = Layer.succeed(
  MCP.Service,
  MCP.Service.of({
    status: () => Effect.succeed({}),
    clients: () => Effect.succeed({}),
    tools: () => Effect.succeed({}),
    prompts: () => Effect.succeed({}),
    resources: () => Effect.succeed({}),
    add: () => Effect.succeed({ status: { status: "disabled" as const } }),
    connect: () => Effect.void,
    disconnect: () => Effect.void,
    getPrompt: () => Effect.succeed(undefined),
    readResource: () => Effect.succeed(undefined),
    startAuth: () => Effect.die("unexpected MCP auth in prompt safety tests"),
    authenticate: () => Effect.die("unexpected MCP auth in prompt safety tests"),
    finishAuth: () => Effect.die("unexpected MCP auth in prompt safety tests"),
    removeAuth: () => Effect.void,
    supportsOAuth: () => Effect.succeed(false),
    hasStoredTokens: () => Effect.succeed(false),
    getAuthStatus: () => Effect.succeed("not_authenticated" as const),
  }),
)

const lsp = Layer.succeed(
  LSP.Service,
  LSP.Service.of({
    init: () => Effect.void,
    status: () => Effect.succeed([]),
    hasClients: () => Effect.succeed(false),
    touchFile: () => Effect.void,
    diagnostics: () => Effect.succeed({}),
    hover: () => Effect.succeed(undefined),
    definition: () => Effect.succeed([]),
    references: () => Effect.succeed([]),
    implementation: () => Effect.succeed([]),
    documentSymbol: () => Effect.succeed([]),
    workspaceSymbol: () => Effect.succeed([]),
    prepareCallHierarchy: () => Effect.succeed([]),
    incomingCalls: () => Effect.succeed([]),
    outgoingCalls: () => Effect.succeed([]),
  }),
)

const status = SessionStatus.layer.pipe(Layer.provideMerge(Bus.layer))
const run = SessionRunState.layer.pipe(Layer.provide(status))
const infra = Layer.mergeAll(NodeFileSystem.layer, CrossSpawnSpawner.defaultLayer)

function makeHttp() {
  const deps = Layer.mergeAll(
    Session.defaultLayer,
    Snapshot.defaultLayer,
    LLM.defaultLayer,
    Env.defaultLayer,
    AgentSvc.defaultLayer,
    Command.defaultLayer,
    Permission.defaultLayer,
    plugin,
    Config.defaultLayer,
    ProviderSvc.defaultLayer,
    lsp,
    mcp,
    AppFileSystem.defaultLayer,
    status,
  ).pipe(Layer.provideMerge(infra))
  const question = Question.layer.pipe(Layer.provideMerge(deps))
  const todo = Todo.layer.pipe(Layer.provideMerge(deps))
  const registry = ToolRegistry.layer.pipe(
    Layer.provide(Skill.defaultLayer),
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(CrossSpawnSpawner.defaultLayer),
    Layer.provide(Ripgrep.defaultLayer),
    Layer.provide(Format.defaultLayer),
    Layer.provideMerge(todo),
    Layer.provideMerge(question),
    Layer.provideMerge(deps),
  )
  const trunc = Truncate.layer.pipe(Layer.provideMerge(deps))
  const proc = SessionProcessor.layer.pipe(Layer.provide(summary), Layer.provideMerge(deps))
  const compact = SessionCompaction.layer.pipe(Layer.provideMerge(proc), Layer.provideMerge(deps))
  return Layer.mergeAll(
    TestLLMServer.layer,
    SessionPrompt.layer.pipe(
      Layer.provide(SessionRevert.defaultLayer),
      Layer.provide(summary),
      Layer.provideMerge(run),
      Layer.provideMerge(compact),
      Layer.provideMerge(proc),
      Layer.provideMerge(registry),
      Layer.provideMerge(trunc),
      Layer.provide(Instruction.defaultLayer),
      Layer.provide(SystemPrompt.defaultLayer),
      Layer.provideMerge(deps),
    ),
  ).pipe(Layer.provide(summary))
}

const it = testEffect(makeHttp())

const cfg = {
  provider: {
    test: {
      name: "Test",
      id: "test",
      env: [],
      npm: "@ai-sdk/openai-compatible",
      models: {
        "test-model": {
          id: "test-model",
          name: "Test Model",
          attachment: true,
          reasoning: false,
          temperature: false,
          tool_call: true,
          release_date: "2025-01-01",
          modalities: { input: ["text" as const, "image" as const, "pdf" as const], output: ["text" as const] },
          limit: { context: 100000, output: 10000 },
          cost: { input: 0, output: 0 },
          options: {},
        },
      },
      options: {
        apiKey: "test-key",
        baseURL: "http://localhost:1/v1",
      },
    },
  },
}

function providerCfg(url: string) {
  return {
    ...cfg,
    provider: {
      ...cfg.provider,
      test: {
        ...cfg.provider.test,
        options: {
          ...cfg.provider.test.options,
          baseURL: url,
        },
      },
    },
  }
}

const user = Effect.fn("prompt-safety.user")(function* (
  sessionID: SessionID,
  text: string,
  input?: { synthetic?: boolean; editorContext?: MessageV2.User["editorContext"] },
) {
  const sessions = yield* Session.Service
  const msg = yield* sessions.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID,
    agent: "code",
    model: ref,
    time: { created: Date.now() },
    tools: {},
    editorContext: input?.editorContext,
  } satisfies MessageV2.User)
  yield* sessions.updatePart({
    id: PartID.ascending(),
    messageID: msg.id,
    sessionID,
    type: "text",
    text,
    synthetic: input?.synthetic,
  } satisfies MessageV2.TextPart)
  return msg
})

const assistant = Effect.fn("prompt-safety.assistant")(function* (
  sessionID: SessionID,
  parentID: MessageID,
  input?: { text?: string; summary?: boolean },
) {
  const sessions = yield* Session.Service
  const msg = yield* sessions.updateMessage({
    id: MessageID.ascending(),
    role: "assistant",
    parentID,
    sessionID,
    mode: "code",
    agent: "code",
    path: { cwd: "/tmp", root: "/tmp" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: ref.modelID,
    providerID: ref.providerID,
    time: { created: Date.now() },
    finish: "end_turn",
    summary: input?.summary,
  } satisfies MessageV2.Assistant)
  yield* sessions.updatePart({
    id: PartID.ascending(),
    messageID: msg.id,
    sessionID,
    type: "text",
    text: input?.text ?? "done",
  } satisfies MessageV2.TextPart)
  return msg
})

const file = Effect.fn("prompt-safety.file")(function* (
  sessionID: SessionID,
  messageID: MessageID,
  input: { mime: string; name: string; body: string },
) {
  const sessions = yield* Session.Service
  return yield* sessions.updatePart({
    id: PartID.ascending(),
    messageID,
    sessionID,
    type: "file",
    mime: input.mime,
    filename: input.name,
    url: `data:${input.mime};base64,${input.body}`,
  } satisfies MessageV2.FilePart)
})

describe("SessionPrompt compaction safety", () => {
  it.live("trims plain-text summary history before provider request", () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* ({ llm }) {
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const chat = yield* sessions.create({
          title: "Prompt safety",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        })

        const early = yield* user(chat.id, "old prompt with image")
        yield* file(chat.id, early.id, { mime: "image/png", name: "old.png", body: "OLDPAYLOAD" })
        yield* assistant(chat.id, early.id, { text: "old answer" })
        const status = yield* user(chat.id, "status?")
        yield* assistant(chat.id, status.id, { text: "summary body", summary: true })
        yield* user(chat.id, "new prompt")
        yield* llm.text("final answer")

        yield* prompt.loop({ sessionID: chat.id })

        const inputs = yield* llm.inputs
        const body = JSON.stringify(inputs.at(-1)?.messages)
        expect(body).toContain("status?")
        expect(body).toContain("summary body")
        expect(body).toContain("new prompt")
        expect(body).not.toContain("old prompt with image")
        expect(body).not.toContain("OLDPAYLOAD")
      }),
      { git: true, config: providerCfg },
    ),
  )

  it.live("strips historical media before provider request", () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* ({ llm }) {
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const chat = yield* sessions.create({
          title: "Prompt media safety",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        })

        const status = yield* user(chat.id, "status?")
        yield* assistant(chat.id, status.id, { text: "summary body", summary: true })
        const hist = yield* user(chat.id, "historical media")
        yield* file(chat.id, hist.id, { mime: "image/png", name: "hist.png", body: "HISTIMAGE" })
        yield* file(chat.id, hist.id, { mime: "application/pdf", name: "hist.pdf", body: "HISTPDF" })
        yield* user(chat.id, "current prompt")
        yield* llm.text("final answer")

        yield* prompt.loop({ sessionID: chat.id })

        const inputs = yield* llm.inputs
        const body = JSON.stringify(inputs.at(-1)?.messages)
        expect(body).toContain("[Attached image/png: hist.png]")
        expect(body).toContain("[Attached application/pdf: hist.pdf]")
        expect(body).toContain("current prompt")
        expect(body).not.toContain("HISTIMAGE")
        expect(body).not.toContain("HISTPDF")
      }),
      { git: true, config: providerCfg },
    ),
  )

  it.live("preserves current media before synthetic handoff with editor context", () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* ({ llm }) {
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const chat = yield* sessions.create({
          title: "Prompt handoff safety",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        })

        const status = yield* user(chat.id, "status?")
        yield* assistant(chat.id, status.id, { text: "summary body", summary: true })
        const hist = yield* user(chat.id, "older image")
        yield* file(chat.id, hist.id, { mime: "image/png", name: "old.png", body: "OLDIMAGE" })
        const current = yield* user(chat.id, "check this image")
        yield* file(chat.id, current.id, { mime: "image/png", name: "current.png", body: "CURRENTIMAGE" })
        yield* assistant(chat.id, current.id, { text: "handoff", summary: false })
        yield* user(chat.id, "Summarize the task tool output above and continue with your task.", {
          synthetic: true,
          editorContext: { activeFile: "src/app.ts" },
        })
        yield* llm.text("final answer")

        yield* prompt.loop({ sessionID: chat.id })

        const inputs = yield* llm.inputs
        const body = JSON.stringify(inputs.at(-1)?.messages)
        expect(body).toContain("[Attached image/png: old.png]")
        expect(body).toContain("CURRENTIMAGE")
        expect(body).toContain("src/app.ts")
        expect(body).not.toContain("OLDIMAGE")
        expect(body).not.toContain("[Attached image/png: current.png]")
      }),
      { git: true, config: providerCfg },
    ),
  )
})
