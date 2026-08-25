// Regressions for SessionPrompt.runLoop compaction-history safety.
// Ensures Kilo's post-filterCompacted trim and post-summary media strip are
// applied before messages are serialized for the provider request.

import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { Agent as AgentSvc } from "../../src/agent/agent"
import { BackgroundJob } from "../../src/background/job"
import { Bus } from "../../src/bus"
import { Command } from "../../src/command"
import { Config } from "../../src/config/config"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import * as CrossSpawnSpawner from "@opencode-ai/core/cross-spawn-spawner"
import { Env } from "../../src/env"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Format } from "../../src/format"
import { Git } from "../../src/git"
import { Image } from "../../src/image/image"
import { LSP } from "../../src/lsp/lsp"
import { MCP } from "../../src/mcp"
import { Permission } from "../../src/permission"
import { Plugin } from "../../src/plugin"
import { Provider as ProviderSvc } from "../../src/provider/provider"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { Question } from "../../src/question"
import { Session } from "../../src/session/session"
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
import { ToolRegistry } from "../../src/tool/registry"
import { Truncate } from "../../src/tool/truncate"
import { KiloSessions } from "../../src/kilo-sessions/kilo-sessions"
import * as Log from "@opencode-ai/core/util/log"
import { MemoryService } from "@kilocode/kilo-memory/effect/service"
import { provideTmpdirServer } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { reply, TestLLMServer } from "../lib/llm-server"

Log.init({ print: false })

const ref = {
  providerID: ProviderV2.ID.make("test"),
  modelID: ModelV2.ID.make("test-model"),
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
    instructions: () => Effect.succeed([]),
    resourceTemplates: () => Effect.succeed({}),
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

const memoryNode = LayerNode.make({ service: MemoryService.Service, layer: MemoryService.layer, deps: [] })
const serverNode = LayerNode.make({ service: TestLLMServer, layer: TestLLMServer.layer, deps: [] })
const root = LayerNode.group([
  SessionPrompt.node,
  Session.node,
  SessionProjector.node,
  MessageV2.node,
  Snapshot.node,
  LLM.node,
  Env.node,
  AgentSvc.node,
  Command.node,
  Permission.node,
  Plugin.node,
  Config.node,
  ProviderSvc.node,
  LSP.node,
  MCP.node,
  FSUtil.node,
  BackgroundJob.node,
  SessionStatus.node,
  SessionRunState.node,
  Database.node,
  EventV2Bridge.node,
  Question.node,
  Todo.node,
  ToolRegistry.node,
  Skill.node,
  Git.node,
  Ripgrep.node,
  Format.node,
  Truncate.node,
  SessionProcessor.node,
  Image.node,
  SessionCompaction.node,
  SessionRevert.node,
  Instruction.node,
  SystemPrompt.node,
  CrossSpawnSpawner.node,
  RuntimeFlags.node,
  memoryNode,
  serverNode,
])

function makeHttp() {
  return LayerNode.compile(root, [
    [SessionSummary.node, summary],
    [Plugin.node, plugin],
    [LSP.node, lsp],
    [MCP.node, mcp],
    [RuntimeFlags.node, RuntimeFlags.layer()],
    [KiloSessions.node, KiloSessions.testLayer],
  ])
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
  input?: { text?: string; summary?: boolean; tokens?: MessageV2.Assistant["tokens"] },
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
    tokens: input?.tokens ?? { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
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

const dangling = Effect.fn("prompt-safety.dangling")(function* (sessionID: SessionID, parentID: MessageID) {
  const sessions = yield* Session.Service
  return yield* sessions.updateMessage({
    id: MessageID.ascending(),
    role: "assistant",
    parentID,
    sessionID,
    mode: "build",
    agent: "build",
    path: { cwd: "/tmp", root: "/tmp" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: ref.modelID,
    providerID: ref.providerID,
    time: { created: Date.now() },
  } satisfies MessageV2.Assistant)
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
  it.live("compacts estimated outgoing context before the provider request", () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* ({ llm }) {
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const chat = yield* sessions.create({
          title: "Preflight compaction",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        })

        const old = yield* user(chat.id, "x".repeat(240_000))
        yield* assistant(chat.id, old.id, { text: "old answer" })
        const current = yield* user(chat.id, "continue")
        yield* file(chat.id, current.id, { mime: "image/png", name: "current.png", body: "CURRENTIMAGE" })
        yield* llm.text("compacted history")
        yield* llm.text("final answer")

        const result = yield* prompt.loop({ sessionID: chat.id })

        expect(yield* llm.calls).toBe(2)
        expect(result.parts.some((part) => part.type === "text" && part.text === "final answer")).toBe(true)
        const inputs = yield* llm.inputs
        expect(JSON.stringify(inputs.at(-1)?.messages)).toContain("CURRENTIMAGE")
        const msgs = yield* sessions.messages({ sessionID: chat.id })
        expect(msgs.some((msg) => msg.info.role === "assistant" && msg.info.summary === true)).toBe(true)
        const marker = msgs.flatMap((msg) => msg.parts).find((part) => part.type === "compaction")
        expect(marker?.type).toBe("compaction")
        if (marker?.type === "compaction") expect(marker.overflow).toBe(false)
      }),
      {
        git: true,
        config: (url) => ({
          ...providerCfg(url),
          compaction: {
            auto: true,
            threshold_percent: 70,
            tail_turns: 0,
            preserve_recent_tokens: 0,
          },
        }),
      },
    ),
  )

  it.live(
    "answers a pending turn once after prior usage triggers compaction",
    () =>
      provideTmpdirServer(
        Effect.fnUntraced(function* ({ llm }) {
          const prompt = yield* SessionPrompt.Service
          const sessions = yield* Session.Service
          const chat = yield* sessions.create({
            title: "Pending turn compaction",
            permission: [{ permission: "*", pattern: "*", action: "allow" }],
          })

          const old = yield* user(chat.id, "old prompt")
          yield* assistant(chat.id, old.id, {
            text: "old answer",
            tokens: { input: 95_000, output: 100, reasoning: 0, cache: { read: 0, write: 0 } },
          })
          const editor = { activeFile: "src/app.ts", openTabs: ["src/app.ts", "src/lib.ts"] }
          const pending = yield* user(chat.id, "pending request", { editorContext: editor })
          yield* file(chat.id, pending.id, { mime: "image/png", name: "pending.png", body: "PENDINGIMAGE" })
          yield* llm.text("summary")
          yield* llm.text("pending answer")

          const result = yield* prompt.loop({ sessionID: chat.id })

          expect(yield* llm.calls).toBe(2)
          expect(result.parts.some((part) => part.type === "text" && part.text === "pending answer")).toBe(true)
          const body = JSON.stringify((yield* llm.inputs).at(-1)?.messages)
          expect(body).toContain("pending request")
          expect(body).toContain("PENDINGIMAGE")

          const msgs = yield* sessions.messages({ sessionID: chat.id })
          expect(
            msgs.filter(
              (msg) =>
                msg.info.role === "user" &&
                msg.parts.some((part) => part.type === "text" && part.text === "pending request"),
            ),
          ).toHaveLength(1)
          expect(
            msgs
              .flatMap((msg) => msg.parts)
              .some(
                (part) =>
                  part.type === "text" && part.synthetic && part.text.includes("Continue if you have next steps"),
              ),
          ).toBe(false)
          const continuation = msgs.find(
            (msg) =>
              msg.info.role === "user" &&
              msg.info.id !== pending.id &&
              msg.parts.some((part) => part.type === "text" && part.text.includes("Continue the pending user request")),
          )
          expect(continuation?.info.role === "user" ? continuation.info.editorContext : undefined).toEqual(editor)
        }),
        { git: true, config: providerCfg },
      ),
    30_000,
  )

  it.live(
    "compacts an oversized first request instead of dropping it",
    () =>
      provideTmpdirServer(
        Effect.fnUntraced(function* ({ llm }) {
          const prompt = yield* SessionPrompt.Service
          const sessions = yield* Session.Service
          const chat = yield* sessions.create({
            title: "Oversized first request",
            permission: [{ permission: "*", pattern: "*", action: "allow" }],
          })

          yield* user(chat.id, "first request " + "x".repeat(240_000))
          yield* llm.text("history summary")
          yield* llm.text("request summary")
          yield* llm.text("final answer")

          const result = yield* prompt.loop({ sessionID: chat.id })

          expect(yield* llm.calls).toBe(3)
          expect(result.parts.some((part) => part.type === "text" && part.text === "final answer")).toBe(true)
          const body = JSON.stringify((yield* llm.inputs).at(-1)?.messages)
          expect(body).toContain("compacted representation")
          expect(body).toContain("request summary")
          const msgs = yield* sessions.messages({ sessionID: chat.id })
          expect(
            msgs.filter(
              (msg) =>
                msg.info.role === "user" &&
                msg.parts.some((part) => part.type === "text" && part.text.startsWith("first request")),
            ),
          ).toHaveLength(1)
        }),
        {
          git: true,
          config: (url) => ({
            ...providerCfg(url),
            compaction: { auto: true, threshold_percent: 70, tail_turns: 0, preserve_recent_tokens: 0 },
          }),
        },
      ),
    30_000,
  )

  it.live(
    "does not compact or replay a completed turn after a terminal response",
    () =>
      provideTmpdirServer(
        Effect.fnUntraced(function* ({ llm }) {
          const prompt = yield* SessionPrompt.Service
          const sessions = yield* Session.Service
          const chat = yield* sessions.create({
            title: "Completed turn compaction",
            permission: [{ permission: "*", pattern: "*", action: "allow" }],
          })

          yield* llm.text("completed answer", { usage: { input: 95_000, output: 100 } })
          yield* prompt.prompt({
            sessionID: chat.id,
            agent: "code",
            noReply: true,
            parts: [{ type: "text", text: "complete this once" }],
          })

          const result = yield* prompt.loop({ sessionID: chat.id })

          expect(yield* llm.calls).toBe(1)
          expect(result.parts.some((part) => part.type === "text" && part.text === "completed answer")).toBe(true)
          const msgs = yield* sessions.messages({ sessionID: chat.id })
          expect(msgs.flatMap((msg) => msg.parts).some((part) => part.type === "compaction")).toBe(false)
          expect(
            msgs.filter(
              (msg) =>
                msg.info.role === "user" &&
                msg.parts.some((part) => part.type === "text" && part.text === "complete this once"),
            ),
          ).toHaveLength(1)
        }),
        { git: true, config: providerCfg },
      ),
    30_000,
  )

  it.live(
    "discards a persisted completed-turn preflight marker without replaying",
    () =>
      provideTmpdirServer(
        Effect.fnUntraced(function* ({ llm }) {
          const prompt = yield* SessionPrompt.Service
          const sessions = yield* Session.Service
          const compaction = yield* SessionCompaction.Service
          const chat = yield* sessions.create({
            title: "Persisted compaction marker",
            permission: [{ permission: "*", pattern: "*", action: "allow" }],
          })

          const request = yield* user(chat.id, "already completed")
          yield* assistant(chat.id, request.id, { text: "completed answer" })
          yield* compaction.create({ sessionID: chat.id, agent: "code", model: ref, auto: true, overflow: false })
          yield* user(chat.id, "later queued request")
          yield* llm.text("later answer")
          const before = yield* sessions.messages({ sessionID: chat.id })
          const marker = before.find((msg) => msg.parts.some((part) => part.type === "compaction"))

          const result = yield* prompt.loop({ sessionID: chat.id })

          expect(yield* llm.calls).toBe(1)
          expect(result.parts.some((part) => part.type === "text" && part.text === "later answer")).toBe(true)
          const msgs = yield* sessions.messages({ sessionID: chat.id })
          expect(msgs.some((msg) => msg.info.id === marker?.info.id)).toBe(false)
          expect(
            msgs.filter(
              (msg) =>
                msg.info.role === "user" &&
                msg.parts.some((part) => part.type === "text" && part.text === "already completed"),
            ),
          ).toHaveLength(1)
        }),
        { git: true, config: providerCfg },
      ),
    30_000,
  )

  it.live(
    "resumes the persisted preflight request when a later prompt exists after restart",
    () =>
      provideTmpdirServer(
        Effect.fnUntraced(function* ({ llm }) {
          const prompt = yield* SessionPrompt.Service
          const sessions = yield* Session.Service
          const compaction = yield* SessionCompaction.Service
          const chat = yield* sessions.create({
            title: "Persisted pending request",
            permission: [{ permission: "*", pattern: "*", action: "allow" }],
          })

          const old = yield* user(chat.id, "old prompt")
          yield* assistant(chat.id, old.id, {
            text: "old answer",
            tokens: { input: 95_000, output: 100, reasoning: 0, cache: { read: 0, write: 0 } },
          })
          const pending = yield* user(chat.id, "pending request")
          yield* compaction.create({
            sessionID: chat.id,
            agent: "code",
            model: ref,
            auto: true,
            overflow: false,
            pending_user_id: pending.id,
          })
          const stored = yield* sessions.messages({ sessionID: chat.id })
          const part = stored
            .flatMap((msg) => msg.parts)
            .find((item): item is MessageV2.CompactionPart => item.type === "compaction")
          expect(part?.pending_user_id).toBe(pending.id)
          yield* user(chat.id, "later queued request")
          yield* llm.text("pending summary")
          yield* llm.text("pending answer")
          yield* llm.text("later answer")

          const result = yield* prompt.loop({ sessionID: chat.id })

          expect(yield* llm.calls).toBe(3)
          expect(result.parts.some((part) => part.type === "text" && part.text === "later answer")).toBe(true)
          const msgs = yield* sessions.messages({ sessionID: chat.id })
          expect(
            msgs.filter(
              (msg) =>
                msg.info.role === "user" &&
                msg.parts.some((part) => part.type === "text" && part.text === "pending request"),
            ),
          ).toHaveLength(1)
          expect(
            msgs.filter(
              (msg) =>
                msg.info.role === "user" &&
                msg.parts.some((part) => part.type === "text" && part.text === "later queued request"),
            ),
          ).toHaveLength(1)
        }),
        { git: true, config: providerCfg },
      ),
    30_000,
  )

  it.live(
    "does not replay a user request after a completed tool step triggers compaction",
    () =>
      provideTmpdirServer(
        Effect.fnUntraced(function* ({ llm }) {
          const prompt = yield* SessionPrompt.Service
          const sessions = yield* Session.Service
          const chat = yield* sessions.create({
            title: "Tool step compaction",
            permission: [{ permission: "*", pattern: "*", action: "allow" }],
          })

          const old = yield* user(chat.id, "old prompt")
          yield* assistant(chat.id, old.id, { text: "old answer" })
          yield* user(chat.id, "find files once")
          yield* llm.push(reply().tool("glob", { pattern: "**/*.txt" }).usage({ input: 95_000, output: 100 }))
          yield* llm.text("tool progress summary")
          yield* llm.text("final answer")

          const result = yield* prompt.loop({ sessionID: chat.id })

          expect(yield* llm.calls).toBe(3)
          expect(result.parts.some((part) => part.type === "text" && part.text === "final answer")).toBe(true)
          const msgs = yield* sessions.messages({ sessionID: chat.id })
          expect(
            msgs.filter(
              (msg) =>
                msg.info.role === "user" &&
                msg.parts.some((part) => part.type === "text" && part.text === "find files once"),
            ),
          ).toHaveLength(1)
          expect(
            msgs.flatMap((msg) => msg.parts).filter((part) => part.type === "tool" && part.tool === "glob"),
          ).toHaveLength(1)
        }),
        { git: true, config: providerCfg },
      ),
    30_000,
  )

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

describe("SessionPrompt recovery", () => {
  it.live("recovers from a dangling assistant row before replying", () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* ({ llm }) {
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const chat = yield* sessions.create({ title: "Prompt tail recovery" })
        const first = yield* user(chat.id, "Before the crash")
        const stale = yield* dangling(chat.id, first.id)

        yield* llm.text("recovered")

        const result = yield* prompt.prompt({
          sessionID: chat.id,
          agent: "build",
          parts: [{ type: "text", text: "Continue after the dangling assistant" }],
        })

        expect(result.info.role).toBe("assistant")
        expect(result.info.id).not.toBe(stale.id)
        expect(result.parts.some((part) => part.type === "text" && part.text === "recovered")).toBe(true)
        expect(yield* llm.calls).toBe(1)

        const msgs = yield* sessions.messages({ sessionID: chat.id })
        const empty = msgs.filter(
          (msg) => msg.info.role === "assistant" && msg.parts.length === 0 && !msg.info.finish && !msg.info.error,
        )
        expect(empty).toHaveLength(0)
        expect(msgs.some((msg) => msg.info.id === stale.id)).toBe(false)
      }),
      { git: true, config: providerCfg },
    ),
  )

  it.live("recovers from persisted provider finish errors before replying", () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* ({ llm }) {
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const chat = yield* sessions.create({ title: "Provider finish error recovery" })
        const first = yield* user(chat.id, "before provider finish error")
        const stale = yield* sessions.updateMessage({
          id: MessageID.ascending(),
          role: "assistant",
          parentID: first.id,
          sessionID: chat.id,
          mode: "code",
          agent: "code",
          path: { cwd: "/tmp", root: "/tmp" },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          modelID: ref.modelID,
          providerID: ref.providerID,
          time: { created: Date.now() },
          finish: "error",
        } satisfies MessageV2.Assistant)
        yield* sessions.updatePart({
          id: PartID.ascending(),
          messageID: stale.id,
          sessionID: chat.id,
          type: "step-start",
        } satisfies MessageV2.StepStartPart)
        yield* sessions.updatePart({
          id: PartID.ascending(),
          messageID: stale.id,
          sessionID: chat.id,
          type: "step-finish",
          reason: "error",
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        } satisfies MessageV2.StepFinishPart)
        yield* llm.text("recovered")

        const result = yield* prompt.prompt({
          sessionID: chat.id,
          agent: "code",
          parts: [{ type: "text", text: "continue after provider finish error" }],
        })

        expect(result.info.role).toBe("assistant")
        expect(result.info.id).not.toBe(stale.id)
        expect(result.parts.some((part) => part.type === "text" && part.text === "recovered")).toBe(true)
        const msgs = yield* sessions.messages({ sessionID: chat.id })
        expect(msgs.some((msg) => msg.info.id === stale.id)).toBe(false)
      }),
      { git: true, config: providerCfg },
    ),
  )
})
