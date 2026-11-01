// Shared harness for the prompt and lifecycle hook tests: the real session prompt graph (as in
// test/session/prompt.test.ts, with the real MCP service) against a TestLLMServer, hooks written to
// a temporary global config (hooks only load from trusted config), and helpers for marker-file
// hook scripts.
import { afterAll, beforeAll } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { Effect, Layer } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { MemoryService } from "@kilocode/kilo-memory/effect/service"
import { Agent } from "@/agent/agent"
import { BackgroundJob } from "@/background/job"
import { GlobalBus, type GlobalEvent } from "@/bus/global"
import { Command } from "@/command"
import { Config } from "@/config/config"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Env } from "@/env"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Format } from "@/format"
import { Git } from "@/git"
import { Image } from "@/image/image"
import { KiloSessions } from "@/kilo-sessions/kilo-sessions"
import { LSP } from "@/lsp/lsp"
import { MCP } from "@/mcp"
import { Permission } from "@/permission"
import { Plugin } from "@/plugin"
import { Provider } from "@/provider/provider"
import { Question } from "@/question"
import { SessionCompaction } from "@/session/compaction"
import { Instruction } from "@/session/instruction"
import { LLM } from "@/session/llm"
import { MessageV2 } from "@/session/message-v2"
import { SessionProcessor } from "@/session/processor"
import { SessionPrompt } from "@/session/prompt"
import { SessionRevert } from "@/session/revert"
import { SessionRunState } from "@/session/run-state"
import { Session } from "@/session/session"
import { SessionStatus } from "@/session/status"
import { SessionSummary } from "@/session/summary"
import { SystemPrompt } from "@/session/system"
import { Todo } from "@/session/todo"
import { Skill } from "@/skill"
import { Snapshot } from "@/snapshot"
import { ToolRegistry } from "@/tool/registry"
import { Truncate } from "@/tool/truncate"
import { TestInstance } from "../fixture/fixture"
import { TestLLMServer } from "../lib/llm-server"

/** A hook in exec form: the program is spawned directly, without shell quoting. */
export const exec = (code: string) => ({ type: "command" as const, command: process.execPath, args: ["-e", code] })

/** A hook that appends its stdin (one JSON line) to `file`, then runs `extra`. */
export const record = (file: string, extra = "") =>
  exec(
    `const fs = require('fs'); const input = fs.readFileSync(0, 'utf8'); fs.appendFileSync(${JSON.stringify(file)}, input.trim() + '\\n'); ${extra}`,
  )

/** Script code that prints `value` as JSON on stdout. */
export const reply = (value: unknown) => `console.log(${JSON.stringify(JSON.stringify(value))})`

/** Script code that writes its pid to `file`, then sleeps (so a test can kill it). */
export const sleeper = (file: string, seconds: number) =>
  `require('fs').writeFileSync(${JSON.stringify(file)}, String(process.pid)); setTimeout(() => {}, ${seconds * 1000})`

/** The JSON lines a marker file holds. */
export const lines = (file: string) =>
  fs.existsSync(file)
    ? fs
        .readFileSync(file, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>)
    : []

export const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Waits until `check` returns true (or fails after `ms`). */
export const until = (check: () => boolean, ms = 5_000) =>
  Effect.gen(function* () {
    const end = Date.now() + ms
    while (!check()) {
      if (Date.now() > end) return yield* Effect.die(new Error("timed out waiting for a condition"))
      yield* Effect.sleep("20 millis")
    }
  })

export const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), "kilo-hooks-"))

// Hooks load only from trusted config, so the tests write them to a temporary global config.
const global = { dir: "", previous: "" }

/** Points the global config at a temporary directory for this test file. */
export function isolate() {
  beforeAll(() => {
    global.dir = temp()
    global.previous = Global.Path.config
    ;(Global.Path as { config: string }).config = global.dir
  })
  afterAll(() => {
    ;(Global.Path as { config: string }).config = global.previous
    fs.rmSync(global.dir, { recursive: true, force: true })
  })
}

export const globalDir = () => global.dir

/** Writes the hooks (and nothing else) as the global config and drops cached config. */
export const hooks = (value: Config.Info["hooks"]) =>
  Effect.gen(function* () {
    fs.writeFileSync(path.join(global.dir, "kilo.json"), JSON.stringify({ hooks: value }))
    yield* (yield* Config.Service).invalidate()
  })

/** Admission errors (hook notices and rejections) published on the global bus. */
export function errors() {
  const items: { sessionID: string; message: string; phase?: string }[] = []
  const handler = (event: GlobalEvent) => {
    const payload = event.payload
    if (payload?.type !== "session.error") return
    const error = payload.properties?.error
    items.push({
      sessionID: payload.properties?.sessionID,
      message: error?.data?.message ?? "",
      phase: payload.metadata?.phase,
    })
  }
  GlobalBus.on("event", handler)
  return { items, stop: () => GlobalBus.off("event", handler) }
}

const summary = Layer.succeed(
  SessionSummary.Service,
  SessionSummary.Service.of({
    summarize: () => Effect.void,
    diff: () => Effect.succeed([]),
    computeDiff: () => Effect.succeed([]),
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

const memory = LayerNode.make({ service: MemoryService.Service, layer: MemoryService.layer, deps: [] })
const server = LayerNode.make({ service: TestLLMServer, layer: TestLLMServer.layer, deps: [] })

const root = LayerNode.group([
  SessionPrompt.node,
  Session.node,
  SessionProjector.node,
  MessageV2.node,
  Snapshot.node,
  LLM.node,
  Env.node,
  Agent.node,
  Command.node,
  Permission.node,
  Plugin.node,
  Config.node,
  Provider.node,
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
  memory,
  server,
])

/** The real session prompt graph (one compiled graph, so one database) plus the LLM server. */
export const layer = LayerNode.compile(root, [
  [SessionSummary.node, summary],
  [LSP.node, lsp],
  [RuntimeFlags.node, RuntimeFlags.layer({ experimentalEventSystem: true })],
  [KiloSessions.node, KiloSessions.testLayer],
])

const model = (id: string) => ({
  id,
  name: id,
  attachment: false,
  reasoning: false,
  temperature: false,
  tool_call: true,
  release_date: "2025-01-01",
  limit: { context: 100_000, output: 10_000 },
  cost: { input: 0, output: 0 },
  options: {},
})

/** Provider `test` with models `test-model` and `other-model`, pointed at the LLM server. */
export function provider(url: string, extra: Record<string, unknown> = {}) {
  return {
    $schema: "https://app.kilo.ai/config.json",
    formatter: false,
    lsp: false,
    model: "test/test-model",
    provider: {
      test: {
        name: "Test",
        id: "test",
        env: [],
        npm: "@ai-sdk/openai-compatible",
        models: { "test-model": model("test-model"), "other-model": model("other-model") },
        options: { apiKey: "test-key", baseURL: url },
      },
    },
    ...extra,
  }
}

/** Writes the project config (provider, plus `extra`) and returns the instance directory and LLM server. */
export const project = (extra: Record<string, unknown> = {}) =>
  Effect.gen(function* () {
    const { directory } = yield* TestInstance
    const llm = yield* TestLLMServer
    fs.writeFileSync(path.join(directory, "opencode.json"), JSON.stringify(provider(llm.url, extra)))
    return { directory, llm }
  })

export const allow = [{ permission: "*", pattern: "*", action: "allow" as const }]

export const ref = { providerID: "test", modelID: "test-model" }
export const other = { providerID: "test", modelID: "other-model" }

/** Text of every part of the session's messages, for "the content never got in" checks. */
export const texts = (messages: readonly { parts: readonly { type: string; text?: string }[] }[]) =>
  messages.flatMap((msg) => msg.parts.flatMap((part) => (part.type === "text" && part.text ? [part.text] : [])))
