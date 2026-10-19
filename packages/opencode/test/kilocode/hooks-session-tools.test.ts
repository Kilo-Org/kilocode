import { expect } from "bun:test"
import path from "path"
import { mkdtemp, rm } from "fs/promises"
import os from "os"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Database } from "@opencode-ai/core/database/database"
import { ProjectV2 } from "@opencode-ai/core/project"
import * as CrossSpawnSpawner from "@opencode-ai/core/cross-spawn-spawner"
import { Cause, Effect, Exit, Fiber, Layer, Schema } from "effect"
import { Agent } from "@/agent/agent"
import { EventV2Bridge } from "@/event-v2-bridge"
import * as ConfigService from "@/config/config"
import { KiloSession } from "@/kilocode/session"
import { MCP } from "@/mcp"
import { Permission } from "@/permission"
import { Provider } from "@/provider/provider"
import { Session } from "@/session/session"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { SessionProcessor } from "@/session/processor"
import { SessionTools } from "@/session/tools"
import { Tool } from "@/tool/tool"
import { ToolRegistry } from "@/tool/registry"
import { Truncate } from "@/tool/truncate"
import { Plugin } from "@/plugin"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { InstanceRef } from "@/effect/instance-ref"
import type { InstanceContext } from "@/project/instance-context"
import type { Config } from "@/config/config"
import { TestConfig } from "../fixture/config"
import { testEffect } from "../lib/effect"

// Hook commands run in bash or the platform shell; `bun -e` with double-quoted scripts stays portable.
const script = (code: string) => `"${process.execPath}" -e "${code}"`
// Exec form needs no shell quoting.
const exec = (code: string) => ({ type: "command" as const, command: process.execPath, args: ["-e", code] })
// A hook that appends its stdin to a marker file, then runs `extra`.
const record = (file: string, extra = "") =>
  exec(
    `const fs = require('fs'); fs.appendFileSync(${JSON.stringify(file)}, fs.readFileSync(0, 'utf8') + '\\n'); ${extra}`,
  )
const reply = (value: unknown) => `console.log(${JSON.stringify(JSON.stringify(value))})`
const lines = async (file: string) =>
  (await Bun.file(file).exists())
    ? (await Bun.file(file).text())
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>)
    : []

const sessionID = SessionID.make("ses_hooks")
const parentID = SessionID.make("ses_hooks_parent")
const childID = SessionID.make("ses_hooks_child")
const messageID = MessageID.ascending()
const runs: string[] = []
const asks: Parameters<Permission.Interface["ask"]>[0][] = []

const agent: Agent.Info = {
  name: "code",
  mode: "primary",
  options: {},
  permission: [{ permission: "*", pattern: "*", action: "allow" }],
}

const model = { providerID: ProviderV2.ID.make("test"), api: { id: "test-model" } } as Provider.Model

const instance = {
  directory: process.cwd(),
  worktree: process.cwd(),
  project: {
    id: ProjectV2.ID.make("test-project"),
    worktree: process.cwd(),
    vcs: "git",
    time: { created: 0, updated: 0 },
    sandboxes: [],
  },
} satisfies InstanceContext

const info = (id: SessionID, parent?: SessionID) =>
  ({ id, parentID: parent, permission: [], directory: process.cwd() }) as unknown as Session.Info
const sessions = new Map([
  [sessionID, info(sessionID)],
  [parentID, info(parentID)],
  [childID, info(childID, parentID)],
])

const base: Config.Info["hooks"] = {
  PreToolUse: [
    {
      matcher: "Edit",
      hooks: [{ type: "command", command: script("process.stderr.write('edits are frozen'); process.exit(2)") }],
    },
    {
      matcher: "mcp__github__.*",
      hooks: [{ type: "command", command: script("process.stderr.write('no GitHub writes'); process.exit(2)") }],
    },
  ],
  PostToolUse: [
    {
      matcher: "write",
      hooks: [{ type: "command", command: script("process.stderr.write('lint: 1 error'); process.exit(2)") }],
    },
  ],
}
// The hooks the config returns; tests swap them and restore the base set.
const config: { hooks: Config.Info["hooks"] } = { hooks: base }

const image = { type: "file" as const, mime: "image/png", url: "data:image/png;base64,AA==" }
const probe = (id: string): Tool.Def => ({
  id,
  description: `records ${id} runs`,
  parameters: Schema.Struct({}),
  jsonSchema: { type: "object", properties: {} },
  execute: () =>
    Effect.sync(() => {
      runs.push(id)
      // read returns an image, as reading a picture does
      return { title: id, metadata: {}, output: `${id} done`, ...(id === "read" ? { attachments: [image] } : {}) }
    }),
})

const layer = Layer.mergeAll(
  Layer.succeed(
    Plugin.Service,
    Plugin.Service.of({
      init: () => Effect.void,
      list: () => Effect.succeed([]),
      trigger: (_name, _input, output) => Effect.succeed(output),
    } satisfies Plugin.Interface),
  ),
  Layer.succeed(
    Permission.Service,
    Permission.Service.of({
      ask: (input) =>
        Effect.sync(() => {
          asks.push(input)
          return { manual: true }
        }),
      reply: () => Effect.void,
      list: () => Effect.succeed([]),
      saveAlwaysRules: () => Effect.void,
      allowEverything: () => Effect.void,
      pending: () => Effect.succeed(undefined),
    } satisfies Permission.Interface),
  ),
  Layer.succeed(
    MCP.Service,
    MCP.Service.of({
      tools: () =>
        Effect.succeed({
          github_create_issue: {
            def: { name: "create_issue", inputSchema: { type: "object", properties: {} } },
            client: {
              callTool: async () => {
                runs.push("github_create_issue")
                return { content: [{ type: "text", text: "issue created" }] }
              },
            },
            clientName: "github",
          } as unknown as MCP.McpTool,
        }),
      clients: () => Effect.succeed({}),
    } as Partial<MCP.Interface> as MCP.Interface),
  ),
  Layer.succeed(
    Truncate.Service,
    Truncate.Service.of({
      cleanup: () => Effect.void,
      write: () => Effect.succeed("output.txt"),
      output: (text: string) => Effect.succeed({ content: text, truncated: false }),
      limits: () => Effect.succeed({ maxLines: 2000, maxBytes: 50 * 1024 }),
    } satisfies Truncate.Interface),
  ),
  RuntimeFlags.layer(),
  Layer.mock(Agent.Service)({ get: () => Effect.succeed(agent) }),
  Layer.mock(Session.Service)({
    get: (id: SessionID) => {
      const found = sessions.get(id)
      return found ? Effect.succeed(found) : Effect.die(new Error(`no session ${id}`))
    },
  }),
  TestConfig.layer({ get: () => Effect.succeed({ hooks: config.hooks }) }),
  AppNodeBuilder.build(Database.node),
  Layer.succeed(
    ToolRegistry.Service,
    ToolRegistry.Service.of({
      ids: () => Effect.succeed(["edit", "write", "bash", "read"]),
      all: () => Effect.succeed([]),
      named: () => Effect.die("unused"),
      tools: () => Effect.succeed([probe("edit"), probe("write"), probe("bash"), probe("read")]),
    }),
  ),
)

const it = testEffect(layer)

const user = MessageID.ascending()

const processor = {
  message: {
    id: messageID,
    sessionID,
    role: "assistant",
    parentID: user,
    agent: "code",
    mode: "code",
    path: { cwd: process.cwd(), root: process.cwd() },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: ModelV2.ID.make("test-model"),
    providerID: ProviderV2.ID.make("test"),
    time: { created: 1 },
  } satisfies SessionV1.Assistant,
  metadata: () => Effect.void,
  completeToolCall: () => Effect.void,
} satisfies Pick<SessionProcessor.Handle, "message" | "metadata" | "completeToolCall">

// The turn's user message: a human prompt, or a goal tick (synthetic background text).
const turn = (unattended: boolean) =>
  [
    {
      info: {
        id: user,
        sessionID,
        role: "user",
        time: { created: 1 },
        agent: "code",
        model: { providerID: "test", modelID: "test-model" },
      },
      parts: [
        {
          id: PartID.ascending(),
          sessionID,
          messageID: user,
          type: "text",
          text: "do it",
          ...(unattended ? { synthetic: true, metadata: { background: true } } : {}),
        },
      ],
    },
  ] as unknown as SessionV1.WithParts[]

const resolve = (input: { session?: Session.Info; messages?: SessionV1.WithParts[]; agent?: Agent.Info } = {}) =>
  SessionTools.resolve({
    agent: input.agent ?? agent,
    model,
    session: input.session ?? info(sessionID),
    processor,
    bypassAgentCheck: false,
    messages: input.messages ?? [],
    promptOps: {} as never,
    memoryCache: {},
  }).pipe(Effect.provideService(InstanceRef, instance))

const options = (id: string) => ({ toolCallId: id, abortSignal: new AbortController().signal, messages: [] })

// Runs a tool and returns its output text, or the error it failed with.
const invoke = (tools: Record<string, unknown>, id: string, args = {}) =>
  Effect.promise(() => {
    const tool = tools[id] as { execute?: (args: unknown, opts: unknown) => unknown }
    if (!tool.execute) throw new Error(`${id} tool is missing execute`)
    return Promise.resolve(tool.execute(args, options(`call_${id}`))).then(
      (value) => ({
        output: (value as { output: string }).output,
        attachments: (value as { attachments?: unknown[] }).attachments,
        error: undefined,
      }),
      (err: unknown) => ({ output: undefined, attachments: undefined, error: err as Error }),
    )
  })

const scratch = () =>
  Effect.acquireRelease(
    Effect.promise(() => mkdtemp(path.join(os.tmpdir(), "kilo-hooks-"))),
    (dir) => Effect.promise(() => rm(dir, { recursive: true, force: true })),
  )

const using = (hooks: Config.Info["hooks"]) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      runs.length = 0
      asks.length = 0
      config.hooks = hooks
    }),
    () =>
      Effect.sync(() => {
        config.hooks = base
      }),
  )

it.effect("blocks a tool call before it runs when a PreToolUse hook exits with 2", () =>
  Effect.gen(function* () {
    runs.length = 0
    const tools = yield* resolve()
    const result = yield* invoke(tools, "edit")
    expect(result.error).toBeInstanceOf(Error)
    expect(result.error?.message).toContain("A PreToolUse hook blocked this edit call")
    expect(result.error?.message).toContain("edits are frozen")
    expect(runs).toEqual([])
  }),
)

it.effect("runs the tool and appends PostToolUse feedback to its result", () =>
  Effect.gen(function* () {
    runs.length = 0
    const tools = yield* resolve()
    const result = yield* invoke(tools, "write")
    expect(runs).toEqual(["write"])
    expect(result.output).toContain("write done")
    expect(result.output).toContain("lint: 1 error")
  }),
)

it.effect("runs hooks for MCP tools, matching Claude Code's mcp__server__tool names", () =>
  Effect.gen(function* () {
    runs.length = 0
    const tools = yield* resolve()
    const result = yield* invoke(tools, "github_create_issue")
    expect(result.error?.message).toContain("no GitHub writes")
    expect(runs).toEqual([])
  }),
)

it.live("sends MCP tools their server and the turn's prompt id and permission mode", () =>
  Effect.gen(function* () {
    const dir = yield* scratch()
    const marker = path.join(dir, "mcp")
    yield* using({ PreToolUse: [{ matcher: "mcp__github__.*", hooks: [record(marker)] }] })
    const tools = yield* resolve()
    yield* invoke(tools, "github_create_issue")
    const [input] = yield* Effect.promise(() => lines(marker))
    expect(input).toMatchObject({
      session_id: sessionID,
      tool_name: "mcp__github__create_issue",
      mcp_server: { name: "github" },
      prompt_id: user,
      permission_mode: "default",
    })
    expect(runs).toEqual(["github_create_issue"])
  }),
)

it.live("appends PreToolUse additionalContext to the tool output", () =>
  Effect.gen(function* () {
    yield* using({
      PreToolUse: [
        {
          matcher: "Read",
          hooks: [exec(reply({ hookSpecificOutput: { additionalContext: "remember the style guide" } }))],
        },
      ],
    })
    const tools = yield* resolve()
    const result = yield* invoke(tools, "read")
    expect(result.output).toContain("read done")
    expect(result.output).toContain('<hook_feedback event="PreToolUse">')
    expect(result.output).toContain("remember the style guide")
  }),
)

it.live("blocks on a JSON deny even when the hook exits 1", () =>
  Effect.gen(function* () {
    yield* using({
      PreToolUse: [
        {
          matcher: "Read",
          hooks: [
            exec(
              `${reply({ hookSpecificOutput: { permissionDecision: "deny", permissionDecisionReason: "no reads" } })}; process.exit(1)`,
            ),
          ],
        },
      ],
    })
    const tools = yield* resolve()
    const result = yield* invoke(tools, "read")
    expect(result.error?.message).toContain("no reads")
    expect(runs).toEqual([])
  }),
)

it.live("sends a subagent's root session id with agent_id and agent_type", () =>
  Effect.gen(function* () {
    const dir = yield* scratch()
    const marker = path.join(dir, "subagent")
    yield* using({ PreToolUse: [{ matcher: "Read", hooks: [record(marker)] }] })
    // Nothing in memory knows the child's parent: the root comes from the stored sessions.
    KiloSession.clearPlatformOverride(childID)
    const explore: Agent.Info = { ...agent, name: "explore", mode: "subagent" }
    const tools = yield* resolve({ session: info(childID, parentID), agent: explore })
    yield* invoke(tools, "read")
    const [input] = yield* Effect.promise(() => lines(marker))
    expect(input).toMatchObject({
      session_id: parentID,
      kilo_session_id: childID,
      agent_id: childID,
      agent_type: "Explore",
      kilo_agent: "explore",
    })
  }),
)

it.live("shows a forced permission prompt when a PreToolUse hook asks on an attended turn", () =>
  Effect.gen(function* () {
    yield* using({
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [
            exec(reply({ hookSpecificOutput: { permissionDecision: "ask", permissionDecisionReason: "risky" } })),
          ],
        },
      ],
    })
    const tools = yield* resolve({ messages: turn(false) })
    const result = yield* invoke(tools, "bash", { command: "rm -rf build" })
    expect(asks).toHaveLength(1)
    expect(asks[0]).toMatchObject({
      permission: "bash",
      patterns: ["rm -rf build"],
      always: [],
      metadata: { hookAsk: true, reason: "risky" },
    })
    expect(result.output).toBe("bash done")
  }),
)

it.live("blocks a PreToolUse ask on an unattended turn instead of prompting", () =>
  Effect.gen(function* () {
    yield* using({
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [
            exec(reply({ hookSpecificOutput: { permissionDecision: "ask", permissionDecisionReason: "risky" } })),
          ],
        },
      ],
    })
    const tools = yield* resolve({ messages: turn(true) })
    const result = yield* invoke(tools, "bash", { command: "rm -rf build" })
    expect(result.error?.message).toContain("nobody can answer in this turn: risky")
    expect(asks).toEqual([])
    expect(runs).toEqual([])
  }),
)

it.live("blocks a subagent's PreToolUse ask while its parent turn is unattended", () =>
  Effect.gen(function* () {
    yield* using({
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [
            exec(reply({ hookSpecificOutput: { permissionDecision: "ask", permissionDecisionReason: "risky" } })),
          ],
        },
      ],
    })
    const explore: Agent.Info = { ...agent, name: "explore", mode: "subagent" }
    // The parent runs a goal tick; the child's first prompt is the parent model's text, which looks human.
    yield* resolve({ session: info(parentID), messages: turn(true) })
    const child = yield* resolve({ session: info(childID, parentID), messages: turn(false), agent: explore })
    const blocked = yield* invoke(child, "bash", { command: "rm -rf build" })
    expect(blocked.error?.message).toContain("nobody can answer in this turn: risky")
    expect(asks).toEqual([])
    // Once a human prompts the parent, its subagents can ask again.
    yield* resolve({ session: info(parentID), messages: turn(false) })
    const next = yield* resolve({ session: info(childID, parentID), messages: turn(false), agent: explore })
    yield* invoke(next, "bash", { command: "rm -rf build" })
    expect(asks).toHaveLength(1)
  }),
)

it.live("blocks a call whose input a PreToolUse hook rewrote", () =>
  Effect.gen(function* () {
    yield* using({
      PreToolUse: [
        { matcher: "Bash", hooks: [exec(reply({ hookSpecificOutput: { updatedInput: { command: "ls -la" } } }))] },
      ],
    })
    const tools = yield* resolve()
    const result = yield* invoke(tools, "bash", { command: "ls" })
    expect(result.error?.message).toContain("rewrote this call's input")
    expect(runs).toEqual([])
  }),
)

it.live("stops a call when a PreToolUse hook sends continue: false, and keeps output on PostToolUse", () =>
  Effect.gen(function* () {
    yield* using({
      PreToolUse: [{ matcher: "Bash", hooks: [exec(reply({ continue: false, stopReason: "enough" }))] }],
      PostToolUse: [{ matcher: "Read", hooks: [exec(reply({ continue: false, stopReason: "done" }))] }],
    })
    const tools = yield* resolve()
    const blocked = yield* invoke(tools, "bash", { command: "ls" })
    expect(blocked.error?.message).toBe("A PreToolUse hook stopped the turn: enough")
    const kept = yield* invoke(tools, "read")
    expect(kept.output).toBe("read done")
    expect(runs).toEqual(["read"])
  }),
)

it.live("replaces the output the model sees with updatedToolOutput", () =>
  Effect.gen(function* () {
    yield* using({
      PostToolUse: [
        { matcher: "Read", hooks: [exec(reply({ hookSpecificOutput: { updatedToolOutput: "[redacted]" } }))] },
      ],
    })
    const tools = yield* resolve()
    const result = yield* invoke(tools, "read")
    expect(result.output).toBe("[redacted]")
    // The original image does not reach the model either.
    expect(result.attachments).toEqual([])
  }),
)

it.live("keeps the original attachments without updatedToolOutput and clips a long replacement", () =>
  Effect.gen(function* () {
    yield* using({})
    const plain = yield* invoke(yield* resolve(), "read")
    expect(plain.attachments).toMatchObject([image])
    yield* using({
      PostToolUse: [
        {
          matcher: "Read",
          hooks: [exec(`console.log(JSON.stringify({ hookSpecificOutput: { updatedToolOutput: 'x'.repeat(20000) } }))`)],
        },
      ],
    })
    const long = yield* invoke(yield* resolve(), "read")
    expect(long.output).toBe(`${"x".repeat(10_000)}\n... (hook output truncated)`)
  }),
)

it.live("runs an `if` hook only for calls that match its rule", () =>
  Effect.gen(function* () {
    const dir = yield* scratch()
    const marker = path.join(dir, "if")
    yield* using({ PreToolUse: [{ matcher: "Bash", hooks: [{ ...record(marker), if: "Bash(rm *)" }] }] })
    const tools = yield* resolve()
    yield* invoke(tools, "bash", { command: "cd x && rm -rf y" })
    yield* invoke(tools, "bash", { command: "ls" })
    yield* invoke(tools, "bash", { command: "echo $(rm y)" })
    const inputs = yield* Effect.promise(() => lines(marker))
    expect(inputs.map((item) => (item.tool_input as { command: string }).command)).toEqual([
      "cd x && rm -rf y",
      "echo $(rm y)",
    ])
  }),
)

it.live("sends structured tool_response for bash and the text in kilo_tool_response", () =>
  Effect.gen(function* () {
    const dir = yield* scratch()
    const marker = path.join(dir, "post")
    yield* using({ PostToolUse: [{ matcher: "Bash", hooks: [record(marker)] }] })
    const tools = yield* resolve()
    yield* invoke(tools, "bash", { command: "ls" })
    const [input] = yield* Effect.promise(() => lines(marker))
    expect(input?.tool_response).toEqual({ stdout: "bash done", stderr: "", interrupted: false })
    expect(input?.kilo_tool_response).toBe("bash done")
  }),
)

// The real permission service (one graph, so the test sees the events it publishes): a hook `ask`
// prompts even under an allow-everything rule and only a human reply to it can approve it.
const real = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Permission.node, ConfigService.node, CrossSpawnSpawner.node, EventV2Bridge.node]),
  ),
)

const waiting = (count: number) =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    while (true) {
      const list = yield* permission.list()
      if (list.length >= count) return list
      yield* Effect.sleep("10 millis")
    }
  }).pipe(Effect.timeoutOrElse({ duration: "2 seconds", orElse: () => Effect.die(new Error("no prompt")) }))

const everything: PermissionV1.Ruleset = [{ permission: "*", pattern: "*", action: "allow" }]

real.instance(
  "a PreToolUse hook ask is never auto-approved and needs an interactive reply",
  () =>
    Effect.gen(function* () {
      const permission = yield* Permission.Service
      const asked: PermissionV1.Request[] = []
      const off = yield* (yield* EventV2Bridge.Service).listen((event) =>
        Effect.sync(() => {
          if (event.type === Permission.Event.Asked.type) asked.push(event.data as PermissionV1.Request)
        }),
      )
      yield* Effect.addFinalizer(() => off)
      const fiber = yield* permission
        .ask({
          sessionID: SessionID.make("ses_hook_ask"),
          permission: "bash",
          patterns: ["rm -rf build"],
          metadata: { hookAsk: true, reason: "risky" },
          always: [],
          ruleset: everything,
        })
        .pipe(Effect.forkScoped)
      const [request] = yield* waiting(1)
      if (!request) throw new Error("no prompt")
      expect(request.metadata?.hookAsk).toBe(true)
      // Clients are told about the prompt even though the rules allow the call.
      expect(asked.map((item) => item.metadata?.reason)).toEqual(["risky"])
      // An auto-approver (no `interactive`) is refused: the prompt stays pending.
      yield* permission.reply({ requestID: request.id, reply: "once" })
      expect(yield* permission.list()).toHaveLength(1)
      yield* permission.reply({ requestID: request.id, reply: "reject", interactive: true })
      const exit = yield* Fiber.await(fiber)
      expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toBeInstanceOf(PermissionV1.RejectedError)
    }),
  { git: true },
)

real.instance(
  "a pending PreToolUse hook ask is not settled by a sibling's always reply or allow-everything",
  () =>
    Effect.gen(function* () {
      const permission = yield* Permission.Service
      const hooked = yield* permission
        .ask({
          sessionID: SessionID.make("ses_hook_ask_a"),
          permission: "bash",
          patterns: ["rm -rf build"],
          metadata: { hookAsk: true, reason: "risky" },
          always: [],
          ruleset: everything,
        })
        .pipe(Effect.forkScoped)
      // Another subagent's prompt in the same instance, answered with "always".
      const sibling = yield* permission
        .ask({
          sessionID: SessionID.make("ses_hook_ask_b"),
          permission: "edit",
          patterns: ["a.ts"],
          metadata: {},
          always: [],
          ruleset: [],
        })
        .pipe(Effect.forkScoped)
      const pending = yield* waiting(2)
      const other = pending.find((item) => item.permission === "edit")
      if (!other) throw new Error("no sibling prompt")
      yield* permission.reply({ requestID: other.id, reply: "always", interactive: true })
      yield* Fiber.join(sibling)
      expect((yield* permission.list()).map((item) => item.permission)).toEqual(["bash"])
      yield* permission.allowEverything({ enable: true })
      expect((yield* permission.list()).map((item) => item.permission)).toEqual(["bash"])
      yield* permission.allowEverything({ enable: false })
      const [request] = yield* permission.list()
      if (!request) throw new Error("the hook ask was settled")
      yield* permission.reply({ requestID: request.id, reply: "once", interactive: true })
      expect(Exit.isSuccess(yield* Fiber.await(hooked))).toBe(true)
    }),
  { git: true },
)
