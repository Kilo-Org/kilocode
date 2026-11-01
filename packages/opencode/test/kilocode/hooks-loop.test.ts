// Agent loop and compaction hook events through the real prompt loop: PostToolBatch, tool-hook
// `continue: false`, Stop / SubagentStop with their loop caps, SubagentStart, PreCompact and
// PostCompact. Hooks are real processes (bun scripts) from the global config; model turns come from
// the real TestLLMServer.

import os from "os"
import path from "path"
import { mkdtemp, rm } from "fs/promises"
import { describe, expect, test } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { Database } from "@opencode-ai/core/database/database"
import * as CrossSpawnSpawner from "@opencode-ai/core/cross-spawn-spawner"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import * as Log from "@opencode-ai/core/util/log"
import { MemoryService } from "@kilocode/kilo-memory/effect/service"
import { Deferred, Effect, Fiber, Layer } from "effect"
import { Agent as AgentSvc } from "../../src/agent/agent"
import { BackgroundJob } from "../../src/background/job"
import { Bus } from "../../src/bus"
import { Command } from "../../src/command"
import { Config } from "../../src/config/config"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { Env } from "../../src/env"
import { Format } from "../../src/format"
import { Git } from "../../src/git"
import { Image } from "../../src/image/image"
import { KiloHookCode } from "../../src/kilocode/hooks/code"
import { KiloHookCompact } from "../../src/kilocode/hooks/compact"
import { KiloHookLoop } from "../../src/kilocode/hooks/loop"
import { KiloSession } from "../../src/kilocode/session"
import { Wakeup } from "../../src/kilocode/wakeup"
import { CompactTool } from "../../src/kilocode/tool/context"
import { KiloSessions } from "../../src/kilo-sessions/kilo-sessions"
import { RemoteCommand } from "../../src/kilo-sessions/remote-command"
import { LSP } from "../../src/lsp/lsp"
import { MCP } from "../../src/mcp"
import { Permission } from "../../src/permission"
import { Plugin } from "../../src/plugin"
import { Provider as ProviderSvc } from "../../src/provider/provider"
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
import { MessageID, SessionID } from "../../src/session/schema"
import { SessionStatus } from "../../src/session/status"
import { SystemPrompt } from "../../src/session/system"
import { SessionSummary } from "../../src/session/summary"
import { Todo } from "../../src/session/todo"
import { Skill } from "../../src/skill"
import { Snapshot } from "../../src/snapshot"
import { Tool } from "../../src/tool/tool"
import { ToolRegistry } from "../../src/tool/registry"
import { Truncate } from "../../src/tool/truncate"
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
    remove: () => Effect.void,
    getPrompt: () => Effect.succeed(undefined),
    readResource: () => Effect.succeed(undefined),
    startAuth: () => Effect.die("unexpected MCP auth in hook loop tests"),
    authenticate: () => Effect.die("unexpected MCP auth in hook loop tests"),
    finishAuth: () => Effect.die("unexpected MCP auth in hook loop tests"),
    removeAuth: () => Effect.void,
    cancelAuth: () => Effect.void,
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
  SessionCompaction.node,
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
  SessionRevert.node,
  Instruction.node,
  SystemPrompt.node,
  CrossSpawnSpawner.node,
  RuntimeFlags.node,
  memoryNode,
  serverNode,
])

const replacements = [
  [SessionSummary.node, summary],
  [Plugin.node, plugin],
  [LSP.node, lsp],
  [MCP.node, mcp],
  [RuntimeFlags.node, RuntimeFlags.layer()],
  [KiloSessions.node, KiloSessions.testLayer],
] as const

const it = testEffect(LayerNode.compile(root, replacements))
// The same graph with the wakeup service, whose pending wakeups Stop hooks receive as `session_crons`.
const timed = testEffect(LayerNode.compile(LayerNode.group([root, Wakeup.node]), replacements))

const providerCfg = (url: string, limit = { context: 100_000, output: 10_000 }) => ({
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
          attachment: false,
          reasoning: false,
          temperature: false,
          tool_call: true,
          release_date: "2025-01-01",
          limit,
          cost: { input: 0, output: 0 },
          options: {},
        },
      },
      options: { apiKey: "test-key", baseURL: url },
    },
  },
})

// Hooks only load from trusted config: write them to the global config for one test.
const configured = (hooks: Config.Info["hooks"]) => {
  const file = path.join(Global.Path.config, "config.json")
  return Effect.acquireRelease(
    Effect.promise(() => Bun.write(file, JSON.stringify({ hooks }))),
    () => Effect.promise(() => rm(file, { force: true })),
  )
}

// Exec-form hooks: bun scripts that append their stdin to `file`, then run `tail`.
const hook = (file: string, tail = "") => ({
  type: "command" as const,
  command: process.execPath,
  args: [
    "-e",
    `const fs = require('fs'); const input = fs.readFileSync(0, 'utf8'); fs.appendFileSync(${JSON.stringify(file)}, input + '\\n'); ${tail}`,
  ],
})
const block = (reason: string) => `process.stderr.write(${JSON.stringify(reason)}); process.exit(2)`
const print = (value: unknown) => `console.log(${JSON.stringify(JSON.stringify(value))})`
// Blocks the first time only: a flag file next to the marker remembers the first run.
const once = (file: string, reason: string) =>
  hook(
    file,
    `if (!fs.existsSync(${JSON.stringify(file + ".flag")})) { fs.writeFileSync(${JSON.stringify(file + ".flag")}, '1'); ${block(reason)} }`,
  )

const lines = (file: string) =>
  Effect.promise(async () =>
    (await Bun.file(file).exists())
      ? (await Bun.file(file).text())
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line) as Record<string, unknown>)
      : [],
  )

// Waits for a detached hook's runs, then a little longer to catch runs nobody expected.
const settle = (file: string, count: number) =>
  Effect.gen(function* () {
    while ((yield* lines(file)).length < count) yield* Effect.sleep("20 millis")
    yield* Effect.sleep("300 millis")
    return yield* lines(file)
  }).pipe(Effect.timeoutOrElse({ duration: "10 seconds", orElse: () => lines(file) }))

const create = Effect.gen(function* () {
  return yield* (yield* Session.Service).create({
    title: "Hook loop",
    permission: [{ permission: "*", pattern: "*", action: "allow" }],
  })
})

const ask = (sessionID: SessionID, text: string, extra: Partial<SessionPrompt.PromptInput> = {}) =>
  Effect.gen(function* () {
    yield* (yield* SessionPrompt.Service).prompt({
      sessionID,
      agent: "code",
      model: ref,
      noReply: true,
      parts: [{ type: "text", text }],
      ...extra,
    })
    return yield* (yield* SessionPrompt.Service).loop({ sessionID })
  })

// The reason the session's next turn closes with.
const closing = (sessionID: SessionID) =>
  Effect.gen(function* () {
    const done = yield* Deferred.make<KiloSession.CloseReason>()
    const off = Bus.subscribe(KiloSession.Event.TurnClose, (evt) => {
      if (evt.properties.sessionID === sessionID) Deferred.doneUnsafe(done, Effect.succeed(evt.properties.reason))
    })
    yield* Effect.addFinalizer(() => Effect.sync(off))
    return done
  })

// The session error messages published while the test runs (hook notices are admission errors).
const errors = (sessionID: SessionID) =>
  Effect.gen(function* () {
    const seen: string[] = []
    const off = yield* (yield* EventV2Bridge.Service).listen((evt) =>
      Effect.sync(() => {
        if (evt.type !== Session.Event.Error.type) return
        const data = evt.data as typeof Session.Event.Error.data.Type
        const error = data.error
        if (data.sessionID === sessionID && error && "data" in error && "message" in error.data)
          seen.push(String(error.data.message))
      }),
    )
    yield* Effect.addFinalizer(() => off)
    return seen
  })

const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM"
  }
}

const continuations = (messages: MessageV2.WithParts[]) =>
  messages.filter(
    (msg) =>
      msg.info.role === "user" &&
      msg.parts.some((part) => part.type === "text" && part.metadata?.hook?.event !== undefined),
  )

const toolParts = (messages: MessageV2.WithParts[]) =>
  messages.flatMap((msg) => msg.parts).filter((part): part is MessageV2.ToolPart => part.type === "tool")

const system = (body: Record<string, unknown>) =>
  JSON.stringify((body.messages as { role: string }[]).filter((item) => item.role === "system"))

describe("PostToolBatch", () => {
  it.live(
    "adds hook context next to the step's tool results for the next model call",
    () =>
      provideTmpdirServer(
        Effect.fnUntraced(function* ({ dir, llm }) {
          const marker = path.join(dir, "batch")
          yield* configured({
            PostToolBatch: [
              { hooks: [hook(marker, print({ hookSpecificOutput: { additionalContext: "lint before you go on" } }))] },
            ],
          })
          const chat = yield* create
          yield* llm.tool("glob", { pattern: "*.md" })
          yield* llm.text("done")
          yield* ask(chat.id, "look around")
          const inputs = yield* llm.inputs
          expect(inputs).toHaveLength(2)
          expect(JSON.stringify(inputs[1])).toContain("lint before you go on")
          const [input] = yield* lines(marker)
          expect(input).toMatchObject({ hook_event_name: "PostToolBatch", session_id: chat.id })
          expect(input?.tool_calls).toMatchObject([{ tool_name: "Glob", tool_input: { pattern: "*.md" } }])
          const [part] = toolParts(yield* (yield* Session.Service).messages({ sessionID: chat.id }))
          expect(part?.state.status === "completed" && part.state.output).toContain(
            '<hook_feedback event="PostToolBatch">',
          )
        }),
        { git: true, config: (url) => providerCfg(url) },
      ),
    30_000,
  )

  it.live(
    "a block ends the turn after the step and tells the user and the goal runner why",
    () =>
      provideTmpdirServer(
        Effect.fnUntraced(function* ({ dir, llm }) {
          const marker = path.join(dir, "batch")
          yield* configured({ PostToolBatch: [{ hooks: [hook(marker, block("budget exhausted"))] }] })
          const chat = yield* create
          const closed = yield* closing(chat.id)
          const seen = yield* errors(chat.id)
          yield* llm.tool("glob", { pattern: "*.md" })
          yield* llm.text("never sent")
          yield* ask(chat.id, "look around")
          expect(yield* llm.calls).toBe(1)
          expect(yield* Deferred.await(closed).pipe(Effect.timeout("2 seconds"))).toBe("completed")
          expect(seen).toContain("PostToolBatch hook stopped the turn: budget exhausted")
          expect(KiloHookLoop.stopped(chat.id)).toBe("PostToolBatch hook stopped the turn: budget exhausted")
          expect(KiloHookLoop.stopped(chat.id)).toBeUndefined()
        }),
        { git: true, config: (url) => providerCfg(url) },
      ),
    30_000,
  )
})

describe("tool hook continue: false", () => {
  it.live(
    "a PreToolUse stop blocks the call and ends the turn without another model call",
    () =>
      provideTmpdirServer(
        Effect.fnUntraced(function* ({ llm }) {
          yield* configured({
            PreToolUse: [
              {
                matcher: "Glob",
                hooks: [
                  {
                    type: "command",
                    command: process.execPath,
                    args: ["-e", print({ continue: false, stopReason: "enough" })],
                  },
                ],
              },
            ],
          })
          const chat = yield* create
          const seen = yield* errors(chat.id)
          yield* llm.tool("glob", { pattern: "*.md" })
          yield* llm.text("never sent")
          yield* ask(chat.id, "look around")
          expect(yield* llm.calls).toBe(1)
          const [part] = toolParts(yield* (yield* Session.Service).messages({ sessionID: chat.id }))
          expect(part?.state.status === "error" && part.state.error).toContain(
            "A PreToolUse hook stopped the turn: enough",
          )
          expect(seen).toContain("A PreToolUse hook stopped the turn: enough")
        }),
        { git: true, config: (url) => providerCfg(url) },
      ),
    30_000,
  )

  it.live(
    "a PostToolUse stop keeps the tool output and ends the turn after the step",
    () =>
      provideTmpdirServer(
        Effect.fnUntraced(function* ({ llm }) {
          yield* configured({
            PostToolUse: [
              {
                matcher: "Glob",
                hooks: [{ type: "command", command: process.execPath, args: ["-e", print({ continue: false })] }],
              },
            ],
          })
          const chat = yield* create
          yield* llm.tool("glob", { pattern: "*.md" })
          yield* llm.text("never sent")
          yield* ask(chat.id, "look around")
          expect(yield* llm.calls).toBe(1)
          const [part] = toolParts(yield* (yield* Session.Service).messages({ sessionID: chat.id }))
          expect(part?.state.status).toBe("completed")
        }),
        { git: true, config: (url) => providerCfg(url) },
      ),
    30_000,
  )
})

describe("code-mode child calls", () => {
  it.live(
    "a child call's stop from a turn that ended early does not end the next turn",
    () =>
      provideTmpdirServer(
        Effect.fnUntraced(function* ({ dir, llm }) {
          const marker = path.join(dir, "child")
          const chat = yield* create
          yield* llm.text("first")
          yield* ask(chat.id, "start")
          const messages = yield* (yield* Session.Service).messages({ sessionID: chat.id })
          const [prompt] = messages.filter((msg) => msg.info.role === "user")
          // A child call of the first turn whose PostToolUse hook stops the turn, in a step that ended
          // before the PostToolBatch site could act on it.
          yield* KiloHookCode.after(
            {
              entry: {
                key: "srv_tool",
                server: "srv",
                tool: { clientName: "srv", def: { name: "tool" } } as unknown as MCP.McpTool,
              },
              args: {},
              callID: "call_child",
              ctx: {
                sessionID: chat.id,
                messageID: MessageID.ascending(),
                agent: "code",
                abort: new AbortController().signal,
                messages,
                metadata: () => Effect.void,
                ask: () => Effect.void,
                extra: {
                  hooks: {
                    PostToolUse: [
                      {
                        matcher: "mcp__srv__tool",
                        hooks: [hook(marker, print({ continue: false, stopReason: "child done" }))],
                      },
                    ],
                  },
                },
              },
            },
            { content: [{ type: "text", text: "ok" }] },
          )
          const [input] = yield* lines(marker)
          expect(input).toMatchObject({
            hook_event_name: "PostToolUse",
            tool_name: "mcp__srv__tool",
            session_id: chat.id,
            prompt_id: prompt?.info.id,
            permission_mode: "bypassPermissions",
            cwd: dir,
          })
          // That stop belongs to the first turn: the next turn's tool step goes on to its answer.
          yield* llm.tool("glob", { pattern: "*.md" })
          yield* llm.text("second")
          const result = yield* ask(chat.id, "go on")
          expect(yield* llm.calls).toBe(3)
          expect(result.parts.some((part) => part.type === "text" && part.text === "second")).toBe(true)
        }),
        { git: true, config: (url) => providerCfg(url) },
      ),
    30_000,
  )
})

describe("Stop", () => {
  it.live(
    "a hook that blocks once makes the agent continue with its feedback and the same system prompt",
    () =>
      provideTmpdirServer(
        Effect.fnUntraced(function* ({ dir, llm }) {
          const marker = path.join(dir, "stop")
          yield* configured({ Stop: [{ hooks: [once(marker, "run the tests first")] }] })
          const chat = yield* create
          yield* llm.text("first answer")
          yield* llm.text("second answer")
          const result = yield* ask(chat.id, "fix it", { system: "Follow the house style." })
          expect(result.parts.some((part) => part.type === "text" && part.text === "second answer")).toBe(true)
          const inputs = yield* llm.inputs
          expect(inputs).toHaveLength(2)
          expect(JSON.stringify(inputs[1])).toContain("Stop hook feedback:\\nrun the tests first")
          expect(system(inputs[1]!)).toBe(system(inputs[0]!))
          expect(system(inputs[1]!)).toContain("Follow the house style.")
          const runs = yield* lines(marker)
          expect(runs.map((item) => [item.stop_hook_active, item.last_assistant_message])).toEqual([
            [false, "first answer"],
            [true, "second answer"],
          ])
          expect(runs[0]).toMatchObject({ hook_event_name: "Stop", session_id: chat.id, cwd: dir })
          const [next] = continuations(yield* (yield* Session.Service).messages({ sessionID: chat.id }))
          expect(next?.info.role === "user" && next.info.system).toBe("Follow the house style.")
          expect(next?.parts[0]?.type === "text" && next.parts[0].metadata?.hook).toEqual({ event: "Stop", streak: 1 })
        }),
        { git: true, config: (url) => providerCfg(url) },
      ),
    30_000,
  )

  it.live(
    "an always-blocking hook continues at most 8 times in a row",
    () =>
      provideTmpdirServer(
        Effect.fnUntraced(function* ({ dir, llm }) {
          const marker = path.join(dir, "stop")
          yield* configured({ Stop: [{ hooks: [hook(marker, block("keep going"))] }] })
          const chat = yield* create
          const seen = yield* errors(chat.id)
          yield* ask(chat.id, "fix it")
          expect(yield* llm.calls).toBe(9)
          expect(continuations(yield* (yield* Session.Service).messages({ sessionID: chat.id }))).toHaveLength(8)
          expect(seen).toContain("Stop hook kept the turn going 8 times; Kilo ended the turn.")
        }),
        { git: true, config: (url) => providerCfg(url) },
      ),
    60_000,
  )

  it.live(
    "the per-turn ceiling stops a blocking hook while the model keeps calling tools",
    () =>
      provideTmpdirServer(
        Effect.fnUntraced(function* ({ dir, llm }) {
          const marker = path.join(dir, "stop")
          yield* configured({ Stop: [{ hooks: [hook(marker, block("keep going"))] }] })
          const chat = yield* create
          const seen = yield* errors(chat.id)
          // Every round calls a tool (which resets the consecutive count) before answering.
          for (const index of Array.from({ length: 25 }, (_, i) => i)) {
            yield* llm.tool("glob", { pattern: "*.md" })
            yield* llm.text(`answer ${index}`)
          }
          yield* ask(chat.id, "fix it")
          expect(continuations(yield* (yield* Session.Service).messages({ sessionID: chat.id }))).toHaveLength(24)
          expect(yield* llm.calls).toBe(50)
          expect(seen).toContain("Stop hook kept the turn going 24 times; Kilo ended the turn.")
        }),
        { git: true, config: (url) => providerCfg(url) },
      ),
    120_000,
  )

  it.live(
    "on an unattended turn a blocking hook continues at most twice",
    () =>
      provideTmpdirServer(
        Effect.fnUntraced(function* ({ dir, llm }) {
          const marker = path.join(dir, "stop")
          yield* configured({ Stop: [{ hooks: [hook(marker, block("keep going"))] }] })
          const chat = yield* create
          yield* (yield* SessionPrompt.Service).prompt({
            sessionID: chat.id,
            agent: "code",
            model: ref,
            noReply: true,
            parts: [{ type: "text", text: "goal tick", synthetic: true, metadata: { background: true } }],
          })
          yield* (yield* SessionPrompt.Service).loop({ sessionID: chat.id })
          expect(yield* llm.calls).toBe(3)
          expect(continuations(yield* (yield* Session.Service).messages({ sessionID: chat.id }))).toHaveLength(2)
        }),
        { git: true, config: (url) => providerCfg(url) },
      ),
    30_000,
  )

  timed.live(
    "sends the session's pending wakeups as session_crons",
    () =>
      provideTmpdirServer(
        Effect.fnUntraced(function* ({ dir, llm }) {
          const marker = path.join(dir, "stop")
          yield* configured({ Stop: [{ hooks: [hook(marker)] }] })
          const chat = yield* create
          const wakeup = yield* (yield* Wakeup.Service).schedule({
            sessionID: chat.id,
            directory: dir,
            prompt: "check the deploy",
            delay: "1h",
          })
          yield* llm.text("answer")
          yield* ask(chat.id, "start")
          const [input] = yield* lines(marker)
          expect(input?.session_crons).toEqual([
            {
              id: wakeup.id,
              schedule: new Date(wakeup.dueAt).toISOString(),
              recurring: false,
              prompt: "check the deploy",
            },
          ])
          yield* (yield* Wakeup.Service).cancelSession(chat.id)
        }),
        { git: true, config: (url) => providerCfg(url) },
      ),
    30_000,
  )

  it.live(
    "a hook whose script is missing does not make the agent continue",
    () =>
      provideTmpdirServer(
        Effect.fnUntraced(function* ({ dir, llm }) {
          const marker = path.join(dir, "stop")
          yield* configured({
            Stop: [
              {
                hooks: [
                  hook(
                    marker,
                    block("python3: can't open file '/nonexistent.py': [Errno 2] No such file or directory"),
                  ),
                ],
              },
            ],
          })
          const chat = yield* create
          yield* ask(chat.id, "fix it")
          expect(yield* llm.calls).toBe(1)
          expect(yield* lines(marker)).toHaveLength(1)
        }),
        { git: true, config: (url) => providerCfg(url) },
      ),
    30_000,
  )

  it.live(
    "compaction runs neither Stop nor a continuation, and PostCompact gets the summary",
    () =>
      provideTmpdirServer(
        Effect.fnUntraced(function* ({ dir, llm }) {
          const stop = path.join(dir, "stop")
          const post = path.join(dir, "post")
          yield* configured({
            Stop: [{ hooks: [hook(stop)] }],
            PostCompact: [{ matcher: "manual", hooks: [hook(post)] }],
          })
          const chat = yield* create
          yield* llm.text("first answer")
          yield* ask(chat.id, "fix it")
          expect(yield* lines(stop)).toHaveLength(1)
          yield* llm.text("the summary")
          yield* (yield* SessionCompaction.Service).create({
            sessionID: chat.id,
            agent: "code",
            model: ref,
            auto: false,
          })
          yield* (yield* SessionPrompt.Service).loop({ sessionID: chat.id })
          expect(yield* lines(stop)).toHaveLength(1)
          const [input] = yield* settle(post, 1)
          expect(input).toMatchObject({
            hook_event_name: "PostCompact",
            session_id: chat.id,
            trigger: "manual",
            compact_summary: "the summary",
          })
        }),
        { git: true, config: (url) => providerCfg(url) },
      ),
    30_000,
  )

  it.live(
    "cancelling while the hook runs kills it and writes no continuation",
    () =>
      provideTmpdirServer(
        Effect.fnUntraced(function* ({ dir, llm }) {
          const marker = path.join(dir, "stop")
          const pid = path.join(dir, "pid")
          yield* configured({
            Stop: [
              {
                hooks: [
                  hook(
                    marker,
                    `fs.writeFileSync(${JSON.stringify(pid)}, String(process.pid)); setTimeout(() => { ${block("late")} }, 30000)`,
                  ),
                ],
              },
            ],
          })
          const chat = yield* create
          const prompt = yield* SessionPrompt.Service
          yield* llm.text("answer")
          const fiber = yield* ask(chat.id, "fix it").pipe(Effect.forkScoped)
          while (!(yield* Effect.promise(() => Bun.file(pid).exists()))) yield* Effect.sleep("20 millis")
          const child = Number(yield* Effect.promise(() => Bun.file(pid).text()))
          yield* prompt.cancel(chat.id)
          yield* Fiber.await(fiber)
          expect(continuations(yield* (yield* Session.Service).messages({ sessionID: chat.id }))).toEqual([])
          while (alive(child)) yield* Effect.sleep("20 millis")
          expect(yield* llm.calls).toBe(1)
        }),
        { git: true, config: (url) => providerCfg(url) },
      ),
    30_000,
  )
})

describe("subagents", () => {
  it.live(
    "SubagentStop continues a task child, whose continued answer becomes the task result",
    () =>
      provideTmpdirServer(
        Effect.fnUntraced(function* ({ dir, llm }) {
          const marker = path.join(dir, "subagent")
          yield* configured({ SubagentStop: [{ matcher: "general-purpose", hooks: [once(marker, "double check")] }] })
          const chat = yield* create
          yield* llm.tool("task", { description: "inspect", prompt: "look into the cache", subagent_type: "general" })
          yield* llm.text("draft answer")
          yield* llm.text("final answer")
          yield* llm.text("done")
          yield* ask(chat.id, "delegate it")
          const sessions = yield* Session.Service
          const [part] = toolParts(yield* sessions.messages({ sessionID: chat.id }))
          expect(part?.state.status === "completed" && part.state.output).toContain("final answer")
          const [child] = yield* sessions.children(chat.id)
          if (!child) throw new Error("no subagent session")
          const [next] = continuations(yield* sessions.messages({ sessionID: child.id }))
          expect(next?.info.role === "user" && next.info.tools?.question).toBe(false)
          const [input] = yield* lines(marker)
          expect(input).toMatchObject({
            hook_event_name: "SubagentStop",
            session_id: chat.id,
            agent_id: child.id,
            agent_type: "general-purpose",
            kilo_agent_type: "general",
            stop_hook_active: false,
            last_assistant_message: "draft answer",
          })
        }),
        { git: true, config: (url) => providerCfg(url) },
      ),
    30_000,
  )

  it.live(
    "SubagentStart context reaches the subagent's first prompt, matched by Claude agent types",
    () =>
      provideTmpdirServer(
        Effect.fnUntraced(function* ({ dir, llm }) {
          const marker = path.join(dir, "start")
          const context = (text: string) => print({ hookSpecificOutput: { additionalContext: text } })
          yield* configured({
            SubagentStart: [
              { matcher: "Explore", hooks: [hook(marker, context("explore notes"))] },
              { matcher: "general-purpose", hooks: [hook(marker, context("general notes"))] },
            ],
          })
          const chat = yield* create
          yield* llm.tool("task", { description: "map", prompt: "map the repo", subagent_type: "explore" })
          yield* llm.text("mapped")
          yield* llm.tool("task", { description: "fix", prompt: "fix the bug", subagent_type: "general" })
          yield* llm.text("fixed")
          yield* llm.text("done")
          yield* ask(chat.id, "delegate it")
          const sessions = yield* Session.Service
          const children = yield* sessions.children(chat.id)
          const first = yield* Effect.forEach(children, (child) =>
            sessions.messages({ sessionID: child.id }).pipe(
              Effect.map((messages) => ({
                agent: child.agent,
                parts: messages.find((msg) => msg.info.role === "user")?.parts ?? [],
              })),
            ),
          )
          const note = (agent: string) =>
            first
              .find((item) => item.agent === agent)
              ?.parts.find(
                (part): part is MessageV2.TextPart =>
                  part.type === "text" && part.metadata?.hook?.event === "SubagentStart",
              )
          expect(note("explore")?.synthetic).toBe(true)
          expect(JSON.stringify(note("explore"))).toContain("explore notes")
          expect(JSON.stringify(note("general"))).toContain("general notes")
          expect(JSON.stringify(note("general"))).not.toContain("explore notes")
          const runs = yield* lines(marker)
          expect(runs.map((item) => [item.agent_type, item.kilo_agent_type, item.session_id])).toEqual([
            ["Explore", "explore", chat.id],
            ["general-purpose", "general", chat.id],
          ])
        }),
        { git: true, config: (url) => providerCfg(url) },
      ),
    30_000,
  )
})

describe("SubagentStart for command subtasks", () => {
  it.live(
    "a command with subtask: true runs SubagentStart and its context reaches the subagent's first prompt",
    () =>
      provideTmpdirServer(
        Effect.fnUntraced(function* ({ dir, llm }) {
          const marker = path.join(dir, "start")
          yield* configured({
            SubagentStart: [
              {
                matcher: "Explore",
                hooks: [hook(marker, print({ hookSpecificOutput: { additionalContext: "subtask notes" } }))],
              },
            ],
          })
          const chat = yield* create
          yield* llm.text("mapped")
          yield* llm.text("done")
          yield* (yield* SessionPrompt.Service).command({
            sessionID: chat.id,
            command: "map",
            arguments: "the repo",
            model: `${ref.providerID}/${ref.modelID}`,
          })
          const sessions = yield* Session.Service
          const children = yield* sessions.children(chat.id)
          expect(children.map((child) => child.agent)).toEqual(["explore"])
          const messages = yield* sessions.messages({ sessionID: children[0]!.id })
          const note = messages
            .find((msg) => msg.info.role === "user")
            ?.parts.find(
              (part): part is MessageV2.TextPart =>
                part.type === "text" && part.metadata?.hook?.event === "SubagentStart",
            )
          expect(note?.synthetic).toBe(true)
          expect(JSON.stringify(note)).toContain("subtask notes")
          const runs = yield* lines(marker)
          expect(runs.map((item) => [item.agent_type, item.session_id])).toEqual([["Explore", chat.id]])
        }),
        {
          git: true,
          config: (url) => ({
            ...providerCfg(url),
            command: { map: { template: "Map $ARGUMENTS", subtask: true, agent: "explore" } },
          }),
        },
      ),
    30_000,
  )
})

describe("PreCompact", () => {
  const overflow = { type: "error", error: { code: "context_length_exceeded" } }

  it.live(
    "a blocked manual compaction is refused and the user is told why",
    () =>
      provideTmpdirServer(
        Effect.fnUntraced(function* ({ dir }) {
          const marker = path.join(dir, "compact")
          yield* configured({ PreCompact: [{ matcher: "manual", hooks: [hook(marker, block("keep the history"))] }] })
          const chat = yield* create
          const seen = yield* errors(chat.id)
          const allowed = yield* KiloHookCompact.allow({
            sessionID: chat.id,
            trigger: "manual",
            manual: true,
            config: yield* Config.Service,
            database: yield* Database.Service,
            events: yield* EventV2Bridge.Service,
          })
          expect(allowed).toBe(false)
          expect(seen).toContain("PreCompact hook blocked compaction: keep the history")
          const [input] = yield* lines(marker)
          expect(input).toMatchObject({
            hook_event_name: "PreCompact",
            session_id: chat.id,
            trigger: "manual",
            custom_instructions: null,
          })
          // An auto compaction is not matched by a manual-only hook.
          expect(
            yield* KiloHookCompact.allow({
              sessionID: chat.id,
              trigger: "auto",
              config: yield* Config.Service,
              database: yield* Database.Service,
            }),
          ).toBe(true)
          expect(yield* lines(marker)).toHaveLength(1)
        }),
        { git: true, config: (url) => providerCfg(url) },
      ),
    30_000,
  )

  it.live(
    "a blocked preflight compaction runs the model uncompacted",
    () =>
      provideTmpdirServer(
        Effect.fnUntraced(function* ({ dir, llm }) {
          const marker = path.join(dir, "compact")
          yield* configured({ PreCompact: [{ matcher: "auto", hooks: [hook(marker, block("not now"))] }] })
          const chat = yield* create
          yield* llm.push(reply().text("first").stop().usage({ input: 45_000, output: 10 }))
          yield* ask(chat.id, "start")
          yield* llm.text("second")
          const result = yield* ask(chat.id, "go on")
          expect(result.parts.some((part) => part.type === "text" && part.text === "second")).toBe(true)
          expect(yield* llm.calls).toBe(2)
          expect(yield* lines(marker)).toMatchObject([{ trigger: "auto" }])
          const messages = yield* (yield* Session.Service).messages({ sessionID: chat.id })
          expect(messages.some((msg) => msg.info.role === "assistant" && msg.info.summary)).toBe(false)
          expect(messages.flatMap((msg) => msg.parts).some((part) => part.type === "compaction")).toBe(false)
        }),
        { git: true, config: (url) => providerCfg(url, { context: 50_000, output: 10_000 }) },
      ),
    30_000,
  )

  it.live(
    "a preflight veto holds for the turn: a tool step at the threshold goes on uncompacted",
    () =>
      provideTmpdirServer(
        Effect.fnUntraced(function* ({ dir, llm }) {
          const marker = path.join(dir, "compact")
          const batch = path.join(dir, "batch")
          yield* configured({
            PreCompact: [{ matcher: "auto", hooks: [hook(marker, block("not now"))] }],
            PostToolBatch: [{ hooks: [hook(batch)] }],
          })
          const chat = yield* create
          const big = { input: 45_000, output: 10 }
          yield* llm.push(reply().text("first").stop().usage(big))
          yield* ask(chat.id, "start")
          const closed = yield* closing(chat.id)
          // The tool step itself reaches the threshold, so the loop wants to compact before the next call.
          yield* llm.push(reply().tool("glob", { pattern: "*.md" }).usage(big))
          yield* llm.text("done uncompacted")
          const result = yield* ask(chat.id, "go on")
          expect(yield* Deferred.await(closed).pipe(Effect.timeout("2 seconds"))).toBe("completed")
          expect(result.parts.some((part) => part.type === "text" && part.text === "done uncompacted")).toBe(true)
          expect(yield* llm.calls).toBe(3)
          expect(yield* lines(marker)).toHaveLength(1)
          // The vetoed step goes on like any other step that ran tools.
          expect(yield* lines(batch)).toHaveLength(1)
          const messages = yield* (yield* Session.Service).messages({ sessionID: chat.id })
          expect(messages.some((msg) => msg.info.role === "assistant" && msg.info.summary)).toBe(false)
          expect(messages.flatMap((msg) => msg.parts).some((part) => part.type === "compaction")).toBe(false)
        }),
        { git: true, config: (url) => providerCfg(url, { context: 50_000, output: 10_000 }) },
      ),
    30_000,
  )

  it.live(
    "after a veto, a real provider overflow ends the turn with the hook's reason",
    () =>
      provideTmpdirServer(
        Effect.fnUntraced(function* ({ dir, llm }) {
          const marker = path.join(dir, "compact")
          yield* configured({ PreCompact: [{ matcher: "auto", hooks: [hook(marker, block("not now"))] }] })
          const chat = yield* create
          const big = { input: 45_000, output: 10 }
          yield* llm.push(reply().text("first").stop().usage(big))
          yield* ask(chat.id, "start")
          const closed = yield* closing(chat.id)
          yield* llm.push(reply().tool("glob", { pattern: "*.md" }).usage(big))
          yield* llm.error(400, overflow)
          yield* llm.text("never sent")
          const result = yield* ask(chat.id, "go on")
          expect(yield* Deferred.await(closed).pipe(Effect.timeout("2 seconds"))).toBe("error")
          expect(yield* llm.calls).toBe(3)
          expect(yield* lines(marker)).toHaveLength(1)
          expect(result.info.role === "assistant" && result.info.error?.name).toBe("ContextOverflowError")
          expect(JSON.stringify(result.info.role === "assistant" && result.info.error)).toContain(
            "Compaction was blocked by a PreCompact hook: not now",
          )
        }),
        { git: true, config: (url) => providerCfg(url, { context: 50_000, output: 10_000 }) },
      ),
    30_000,
  )

  it.live(
    "a Stop continuation stays in the vetoed turn: PreCompact runs once",
    () =>
      provideTmpdirServer(
        Effect.fnUntraced(function* ({ dir, llm }) {
          const marker = path.join(dir, "compact")
          const stop = path.join(dir, "stop")
          const flag = JSON.stringify(stop + ".flag")
          yield* configured({
            PreCompact: [{ matcher: "auto", hooks: [hook(marker, block("not now"))] }],
            // Blocks once, after the second turn's answer.
            Stop: [
              {
                hooks: [
                  hook(
                    stop,
                    `if (JSON.parse(input).last_assistant_message === "second" && !fs.existsSync(${flag})) { fs.writeFileSync(${flag}, "1"); ${block("check the tests")} }`,
                  ),
                ],
              },
            ],
          })
          const chat = yield* create
          const big = { input: 45_000, output: 10 }
          yield* llm.push(reply().text("first").stop().usage(big))
          yield* ask(chat.id, "start")
          yield* llm.text("second", { usage: big })
          yield* llm.text("third")
          const result = yield* ask(chat.id, "go on")
          expect(result.parts.some((part) => part.type === "text" && part.text === "third")).toBe(true)
          expect(yield* llm.calls).toBe(3)
          expect(continuations(yield* (yield* Session.Service).messages({ sessionID: chat.id }))).toHaveLength(1)
          expect(yield* lines(marker)).toHaveLength(1)
        }),
        { git: true, config: (url) => providerCfg(url, { context: 50_000, output: 10_000 }) },
      ),
    30_000,
  )

  it.live(
    "a blocked overflow recovery ends the turn with a context overflow error",
    () =>
      provideTmpdirServer(
        Effect.fnUntraced(function* ({ dir, llm }) {
          const marker = path.join(dir, "compact")
          yield* configured({ PreCompact: [{ hooks: [hook(marker, block("keep the history"))] }] })
          const chat = yield* create
          const closed = yield* closing(chat.id)
          yield* llm.error(400, overflow)
          const result = yield* ask(chat.id, "start")
          expect(yield* Deferred.await(closed).pipe(Effect.timeout("2 seconds"))).toBe("error")
          expect(yield* llm.calls).toBe(1)
          expect(result.info.role === "assistant" && result.info.error?.name).toBe("ContextOverflowError")
          expect(JSON.stringify(result.info.role === "assistant" && result.info.error)).toContain(
            "Compaction was blocked by a PreCompact hook: keep the history",
          )
          expect(yield* lines(marker)).toMatchObject([{ trigger: "auto" }])
        }),
        { git: true, config: (url) => providerCfg(url) },
      ),
    30_000,
  )

  it.live(
    "an allowing hook lets overflow recovery compact as before",
    () =>
      provideTmpdirServer(
        Effect.fnUntraced(function* ({ dir, llm }) {
          const marker = path.join(dir, "compact")
          yield* configured({ PreCompact: [{ matcher: "auto", hooks: [hook(marker)] }] })
          const chat = yield* create
          const closed = yield* closing(chat.id)
          yield* llm.error(400, overflow)
          yield* llm.text("summary ok")
          yield* llm.text("final answer")
          const result = yield* ask(chat.id, "start")
          expect(yield* Deferred.await(closed).pipe(Effect.timeout("2 seconds"))).toBe("completed")
          expect(yield* llm.calls).toBe(3)
          expect(result.parts.some((part) => part.type === "text" && part.text === "final answer")).toBe(true)
          expect(yield* lines(marker)).toMatchObject([{ trigger: "auto" }])
        }),
        { git: true, config: (url) => providerCfg(url) },
      ),
    30_000,
  )
})

describe("compaction hook input", () => {
  it.live(
    "PostCompact reports a context-tool compaction as auto with kilo_trigger tool",
    () =>
      provideTmpdirServer(
        Effect.fnUntraced(function* ({ dir }) {
          const manual = path.join(dir, "manual")
          const auto = path.join(dir, "auto")
          yield* configured({
            PostCompact: [
              { matcher: "manual", hooks: [hook(manual)] },
              { matcher: "auto", hooks: [hook(auto)] },
            ],
          })
          const chat = yield* create
          const services = { config: yield* Config.Service, database: yield* Database.Service }
          // The model asks for a compaction with the `context` tool, which compacts with `auto: false`.
          expect(yield* KiloHookCompact.allow({ sessionID: chat.id, trigger: "auto", kilo: "tool", ...services })).toBe(
            true,
          )
          yield* KiloHookCompact.compacted({ sessionID: chat.id, auto: false, summary: "by the model", ...services })
          expect(yield* settle(auto, 1)).toMatchObject([
            { hook_event_name: "PostCompact", trigger: "auto", kilo_trigger: "tool", compact_summary: "by the model" },
          ])
          // The user's own /compact afterwards is manual again.
          expect(
            yield* KiloHookCompact.allow({ sessionID: chat.id, trigger: "manual", manual: true, ...services }),
          ).toBe(true)
          yield* KiloHookCompact.compacted({ sessionID: chat.id, auto: false, summary: "by the user", ...services })
          const [input] = yield* settle(manual, 1)
          expect(input).toMatchObject({ trigger: "manual", compact_summary: "by the user" })
          expect(input?.kilo_trigger).toBeUndefined()
          expect(yield* lines(auto)).toHaveLength(1)
        }),
        { git: true, config: (url) => providerCfg(url) },
      ),
    30_000,
  )

  it.live(
    "compaction hooks in a subagent session send the root session and the agent, even after a restart",
    () =>
      provideTmpdirServer(
        Effect.fnUntraced(function* ({ dir }) {
          const marker = path.join(dir, "compact")
          yield* configured({ PreCompact: [{ hooks: [hook(marker)] }] })
          const sessions = yield* Session.Service
          const chat = yield* create
          const child = yield* sessions.create({ parentID: chat.id, title: "child", agent: "explore" })
          const grandchild = yield* sessions.create({ parentID: child.id, title: "grandchild", agent: "general" })
          // Nothing in memory knows the ancestry, as after a restart: it comes from the database.
          KiloSession.clearPlatformOverride(child.id)
          KiloSession.clearPlatformOverride(grandchild.id)
          expect(
            yield* KiloHookCompact.allow({
              sessionID: grandchild.id,
              trigger: "manual",
              config: yield* Config.Service,
              database: yield* Database.Service,
            }),
          ).toBe(true)
          const [input] = yield* lines(marker)
          expect(input).toMatchObject({
            hook_event_name: "PreCompact",
            session_id: chat.id,
            kilo_session_id: grandchild.id,
            agent_id: grandchild.id,
            agent_type: "general-purpose",
            cwd: dir,
          })
          expect(KiloSession.resolveRoot(grandchild.id)).toBe(chat.id)
        }),
        { git: true, config: (url) => providerCfg(url) },
      ),
    30_000,
  )
})

// The `context` tool's compaction, with hooks from its tool context. Session, provider and
// compaction are stand-ins: the test is about what the tool asks PreCompact and does with a block.
describe("PreCompact for the context tool", () => {
  const created: unknown[] = []
  const tools = testEffect(
    LayerNode.compile(
      LayerNode.group([
        AgentSvc.node,
        FSUtil.node,
        CrossSpawnSpawner.node,
        Truncate.node,
        Session.node,
        ProviderSvc.node,
        SessionCompaction.node,
      ]),
      [
        [
          Session.node,
          Layer.mock(Session.Service, {
            get: () => Effect.succeed({ model: { providerID: "test", id: "test-model" } } as never),
          }),
        ],
        [ProviderSvc.node, Layer.mock(ProviderSvc.Service, {})],
        [
          SessionCompaction.node,
          Layer.mock(SessionCompaction.Service, {
            create: (input: unknown) =>
              Effect.sync(() => {
                created.push(input)
              }),
          }),
        ],
      ],
    ),
  )

  const run = (hooks: Config.Info["hooks"]) =>
    Effect.gen(function* () {
      const tool = yield* Tool.init(yield* CompactTool)
      return yield* tool.execute(
        {},
        {
          sessionID: SessionID.make("ses_hooks_compact_tool"),
          messageID: MessageID.ascending(),
          agent: "code",
          abort: new AbortController().signal,
          callID: "call_compact",
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
          extra: { hooks },
        },
      )
    })

  tools.instance("sends auto with kilo_trigger tool, and a block skips the compaction", () =>
    Effect.gen(function* () {
      const dir = yield* Effect.acquireRelease(
        Effect.promise(() => mkdtemp(path.join(os.tmpdir(), "kilo-hooks-compact-"))),
        (dir) => Effect.promise(() => rm(dir, { recursive: true, force: true })),
      )
      const marker = path.join(dir, "compact")
      created.length = 0
      const allowed = yield* run({ PreCompact: [{ matcher: "auto", hooks: [hook(marker)] }] })
      expect(allowed.title).toBe("context compaction scheduled")
      expect(created).toHaveLength(1)
      expect(yield* lines(marker)).toMatchObject([
        { hook_event_name: "PreCompact", trigger: "auto", kilo_trigger: "tool" },
      ])
      const blocked = yield* run({ PreCompact: [{ hooks: [hook(marker, block("not in this turn"))] }] })
      expect(blocked.output).toBe("A PreCompact hook blocked context compaction; continue without compacting.")
      expect(created).toHaveLength(1)
      // A manual-only hook does not see the model's own compaction.
      const manual = yield* run({ PreCompact: [{ matcher: "manual", hooks: [hook(marker, block("no"))] }] })
      expect(manual.title).toBe("context compaction scheduled")
      expect(created).toHaveLength(2)
    }),
  )
})

describe("PreCompact for a remote /compact", () => {
  test("a blocked remote compaction neither compacts nor runs the loop", async () => {
    const steps: string[] = []
    const remote = RemoteCommand.create({
      list: async () => [],
      command: async () => {
        throw new Error("unexpected command")
      },
      session: {
        get: async () => ({ id: SessionID.make("ses_remote"), agent: "code" }) as never,
        messages: async () => [],
      },
      agent: { default: async () => "code" },
      provider: { default: async () => ({ providerID: "test", modelID: "test-model" }) },
      revert: { cleanup: async () => {} },
      compaction: {
        create: async () => {
          steps.push("create")
        },
        allow: async () => {
          steps.push("allow")
          return false
        },
      },
      prompt: {
        loop: async () => {
          steps.push("loop")
        },
      },
    })
    await remote.execute({
      sessionID: SessionID.make("ses_remote"),
      protocolVersion: 1,
      command: "compact",
      arguments: "",
      catalog: { protocolVersion: 1, commands: [{ name: "compact", hints: [] }] },
    })
    expect(steps).toEqual(["allow"])
  })
})
