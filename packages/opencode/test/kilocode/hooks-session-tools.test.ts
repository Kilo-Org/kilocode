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
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import * as CrossSpawnSpawner from "@opencode-ai/core/cross-spawn-spawner"
import { Cause, Effect, Exit, Fiber, Layer, Schema } from "effect"
import { Agent } from "@/agent/agent"
import { EventV2Bridge } from "@/event-v2-bridge"
import * as ConfigService from "@/config/config"
import { KiloHooks } from "@/kilocode/hooks/hooks"
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
import { TodoWriteTool } from "@/tool/todo"
import { Todo } from "@/session/todo"
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
// Metadata a probe's next result carries (a bash exit code, the AGENTS.md files a read pulled in).
const metadata: Record<string, Record<string, unknown>> = {}
// The output text a probe's next result carries, instead of `<id> done`.
const outputs: Record<string, string> = {}
const probe = (id: string): Tool.Def => ({
  id,
  description: `records ${id} runs`,
  parameters: Schema.Struct({}),
  jsonSchema: { type: "object", properties: {} },
  execute: () =>
    Effect.sync(() => {
      runs.push(id)
      // read returns an image, as reading a picture does
      return {
        title: id,
        metadata: metadata[id] ?? {},
        output: outputs[id] ?? `${id} done`,
        ...(id === "read" ? { attachments: [image] } : {}),
      }
    }),
})
// A tool that starts and then fails with `error`.
const failing = (id: string, error: () => unknown): Tool.Def => ({
  ...probe(id),
  execute: () =>
    Effect.sync(() => {
      runs.push(id)
    }).pipe(Effect.andThen(Effect.die(error()))),
})
const agents = Layer.mock(Agent.Service)({ get: () => Effect.succeed(agent) })
const truncate = Layer.succeed(
  Truncate.Service,
  Truncate.Service.of({
    cleanup: () => Effect.void,
    write: () => Effect.succeed("output.txt"),
    output: (text: string) => Effect.succeed({ content: text, truncated: false }),
    limits: () => Effect.succeed({ maxLines: 2000, maxBytes: 50 * 1024 }),
  } satisfies Truncate.Interface),
)
// A tool that asks for its own permission before it runs, as most tools do.
const asker: Tool.Def = {
  ...probe("asker"),
  execute: (_args, ctx) =>
    ctx.ask({ permission: "asker", patterns: ["*"], always: ["*"], metadata: {} }).pipe(
      Effect.andThen(
        Effect.sync(() => {
          runs.push("asker")
          return { title: "asker", metadata: {}, output: "asker done" }
        }),
      ),
    ),
}
// The real todo service and todowrite tool, so Task events roll back what is actually stored.
const todos = AppNodeBuilder.build(Todo.node)
const registry = Layer.effect(
  ToolRegistry.Service,
  Effect.gen(function* () {
    const todowrite = yield* Tool.init(yield* TodoWriteTool)
    const tools = [
      probe("edit"),
      probe("write"),
      probe("bash"),
      probe("read"),
      todowrite,
      failing("explode", () => new Error("explode failed")),
      failing("reject", () => new PermissionV1.RejectedError()),
      asker,
    ]
    return ToolRegistry.Service.of({
      ids: () => Effect.succeed(tools.map((item) => item.id)),
      all: () => Effect.succeed([]),
      named: () => Effect.die("unused"),
      tools: () => Effect.succeed(tools),
    })
  }),
).pipe(Layer.provide(Layer.mergeAll(todos, agents, truncate)))

// Everything but the permission service, the config and the database.
const shared = Layer.mergeAll(
  Layer.succeed(
    Plugin.Service,
    Plugin.Service.of({
      init: () => Effect.void,
      list: () => Effect.succeed([]),
      trigger: (_name, _input, output) => Effect.succeed(output),
    } satisfies Plugin.Interface),
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
  truncate,
  RuntimeFlags.layer(),
  agents,
  Layer.mock(Session.Service)({
    get: (id: SessionID) => {
      const found = sessions.get(id)
      return found ? Effect.succeed(found) : Effect.die(new Error(`no session ${id}`))
    },
  }),
  todos,
  registry,
)
const settings = TestConfig.layer({ get: () => Effect.succeed({ hooks: config.hooks }) })

const layer = Layer.mergeAll(
  shared,
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
  settings,
  AppNodeBuilder.build(Database.node),
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

const options = (id: string, signal = new AbortController().signal) => ({
  toolCallId: id,
  abortSignal: signal,
  messages: [],
})

// Runs a tool and returns its output text, or the error it failed with.
const invoke = (tools: Record<string, unknown>, id: string, args = {}, signal?: AbortSignal) =>
  Effect.promise(() => {
    const tool = tools[id] as { execute?: (args: unknown, opts: unknown) => unknown }
    if (!tool.execute) throw new Error(`${id} tool is missing execute`)
    return Promise.resolve(tool.execute(args, options(`call_${id}`, signal))).then(
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
        for (const key of Object.keys(metadata)) delete metadata[key]
        for (const key of Object.keys(outputs)) delete outputs[key]
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

it.live("names the tool and carries its input in the prompt of a PreToolUse ask on an MCP tool", () =>
  Effect.gen(function* () {
    yield* using({
      PreToolUse: [
        {
          matcher: "mcp__github__.*",
          hooks: [
            exec(reply({ hookSpecificOutput: { permissionDecision: "ask", permissionDecisionReason: "writes" } })),
          ],
        },
      ],
    })
    const tools = yield* resolve({ messages: turn(false) })
    const args = { title: "Bug", labels: ["bug"] }
    const result = yield* invoke(tools, "github_create_issue", args)
    // The MCP tool asks for its own permission too: the hook's prompt is the one marked hookAsk.
    const hookAsks = asks.filter((item) => item.metadata?.hookAsk === true)
    expect(hookAsks).toHaveLength(1)
    expect(hookAsks[0]).toMatchObject({
      permission: "github_create_issue",
      patterns: ["*"],
      always: [],
      // The tool as hooks see it, and the arguments they receive as tool_input.
      metadata: { hookAsk: true, reason: "writes", tool: "mcp__github__create_issue", input: args },
    })
    expect(result.output).toContain("issue created")
  }),
)

it.live("names a built-in tool by its Claude Code name in a PreToolUse ask", () =>
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
    yield* invoke(tools, "bash", { command: "rm -rf build" })
    expect(asks[0]?.metadata).toMatchObject({ tool: "Bash", input: { command: "rm -rf build" } })
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
          hooks: [
            exec(`console.log(JSON.stringify({ hookSpecificOutput: { updatedToolOutput: 'x'.repeat(20000) } }))`),
          ],
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

// Waits for a detached hook to append `count` inputs to its marker, then a little longer, so a
// test also sees runs it did not expect.
const settle = (file: string, count: number) =>
  Effect.gen(function* () {
    while ((yield* Effect.promise(() => lines(file))).length < count) yield* Effect.sleep("20 millis")
    yield* Effect.sleep("300 millis")
    return yield* Effect.promise(() => lines(file))
  }).pipe(Effect.timeoutOrElse({ duration: "10 seconds", orElse: () => Effect.promise(() => lines(file)) }))

// A hook that records its input and exits 2 with `reason` when `field` equals `value`.
const gate = (file: string, field: string, value: string, reason: string) =>
  exec(
    `const fs = require('fs'); const input = fs.readFileSync(0, 'utf8'); fs.appendFileSync(${JSON.stringify(file)}, input + '\\n'); if (JSON.parse(input)[${JSON.stringify(field)}] === ${JSON.stringify(value)}) { process.stderr.write(${JSON.stringify(reason)}); process.exit(2) }`,
  )

// Todos belong to a stored session: store the test session once, then replace its todo list.
const seed = (list: Todo.Info[]) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* db
      .insert(ProjectTable)
      .values({
        id: instance.project.id,
        worktree: AbsolutePath.make(process.cwd()),
        vcs: "git",
        time_created: 0,
        time_updated: 0,
        sandboxes: [],
      })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    yield* db
      .insert(SessionTable)
      .values({
        id: sessionID,
        project_id: instance.project.id,
        slug: "hooks",
        directory: process.cwd(),
        title: "hooks",
        version: "test",
        time_created: 0,
        time_updated: 0,
      })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    yield* Todo.Service.use((svc) => svc.update({ sessionID, todos: list }))
  })
const stored = Todo.Service.use((svc) => svc.get(sessionID))
const item = (content: string, status: string, priority = "high") => ({ content, status, priority }) as Todo.Info

it.live("appends PostToolUseFailure feedback to the error of a tool that failed", () =>
  Effect.gen(function* () {
    const dir = yield* scratch()
    const marker = path.join(dir, "failure")
    yield* using({
      PostToolUseFailure: [
        {
          matcher: "explode",
          hooks: [record(marker, reply({ hookSpecificOutput: { additionalContext: "check the input file" } }))],
        },
      ],
    })
    const result = yield* invoke(yield* resolve(), "explode")
    expect(result.error?.message).toContain("explode failed")
    expect(result.error?.message).toContain('<hook_feedback event="PostToolUseFailure">')
    expect(result.error?.message).toContain("check the input file")
    const [input] = yield* Effect.promise(() => lines(marker))
    expect(input).toMatchObject({
      hook_event_name: "PostToolUseFailure",
      session_id: sessionID,
      tool_name: "explode",
      tool_use_id: "call_explode",
      error: "explode failed",
      is_interrupt: false,
    })
    expect(typeof input?.duration_ms).toBe("number")
    expect(runs).toEqual(["explode"])
  }),
)

it.live("passes a permission rejection through unchanged without running PostToolUseFailure", () =>
  Effect.gen(function* () {
    const dir = yield* scratch()
    const marker = path.join(dir, "failure")
    yield* using({ PostToolUseFailure: [{ hooks: [record(marker)] }] })
    const result = yield* invoke(yield* resolve(), "reject")
    expect(result.error).toBeInstanceOf(PermissionV1.RejectedError)
    expect(yield* Effect.promise(() => lines(marker))).toEqual([])
  }),
)

it.live("does not run PostToolUseFailure for a cancelled call", () =>
  Effect.gen(function* () {
    const dir = yield* scratch()
    const marker = path.join(dir, "failure")
    yield* using({ PostToolUseFailure: [{ hooks: [record(marker)] }] })
    const abort = new AbortController()
    abort.abort()
    const result = yield* invoke(yield* resolve(), "explode", {}, abort.signal)
    expect(result.error?.message).toBe("explode failed")
    expect(yield* Effect.promise(() => lines(marker))).toEqual([])
  }),
)

it.live("runs PostToolUseFailure instead of PostToolUse when bash exits non-zero", () =>
  Effect.gen(function* () {
    const dir = yield* scratch()
    const failure = path.join(dir, "failure")
    const success = path.join(dir, "success")
    yield* using({
      PostToolUseFailure: [
        {
          matcher: "Bash",
          hooks: [record(failure, reply({ hookSpecificOutput: { additionalContext: "run the linter first" } }))],
        },
      ],
      PostToolUse: [{ matcher: "Bash", hooks: [record(success)] }],
    })
    metadata.bash = { exit: 3 }
    const result = yield* invoke(yield* resolve(), "bash", { command: "make" })
    expect(result.output).toContain("bash done")
    expect(result.output).toContain('<hook_feedback event="PostToolUseFailure">')
    expect(result.output).toContain("run the linter first")
    const [input] = yield* Effect.promise(() => lines(failure))
    expect(String(input?.error)).toStartWith("Exit code 3")
    expect(input?.tool_input).toEqual({ command: "make" })
    expect(yield* Effect.promise(() => lines(success))).toEqual([])
  }),
)

it.live("runs PostToolUseFailure instead of PostToolUse when a bash command is killed at its timeout", () =>
  Effect.gen(function* () {
    const dir = yield* scratch()
    const failure = path.join(dir, "failure")
    const success = path.join(dir, "success")
    yield* using({
      PostToolUseFailure: [
        {
          matcher: "Bash",
          hooks: [record(failure, reply({ hookSpecificOutput: { additionalContext: "retry with a larger timeout" } }))],
        },
      ],
      PostToolUse: [{ matcher: "Bash", hooks: [record(success)] }],
    })
    // What the shell tool returns for a command it killed: no exit code, and the reason in its output.
    metadata.bash = { exit: null }
    outputs.bash =
      "partial output\n\n<shell_metadata>\nshell tool terminated command after exceeding timeout 2000 ms. If this command is expected to take longer, retry with a larger timeout value in milliseconds.\n</shell_metadata>"
    const result = yield* invoke(yield* resolve(), "bash", { command: "sleep 30" })
    expect(result.output).toContain("partial output")
    expect(result.output).toContain('<hook_feedback event="PostToolUseFailure">')
    expect(result.output).toContain("retry with a larger timeout")
    const [input] = yield* Effect.promise(() => lines(failure))
    expect(String(input?.error)).toStartWith("Command timed out after 2000 ms\npartial output")
    expect(input?.is_interrupt).toBe(false)
    expect(input?.tool_input).toEqual({ command: "sleep 30" })
    expect(yield* Effect.promise(() => lines(success))).toEqual([])
  }),
)

it.live("runs PostToolUseFailure for a bash command killed at its timeout even when its signal aborts afterwards", () =>
  Effect.gen(function* () {
    const dir = yield* scratch()
    const failure = path.join(dir, "failure")
    const success = path.join(dir, "success")
    // Background hooks: an aborted signal kills the ones a call waits for.
    yield* using({
      PostToolUseFailure: [{ matcher: "Bash", hooks: [{ ...record(failure), async: true }] }],
      PostToolUse: [{ matcher: "Bash", hooks: [{ ...record(success), async: true }] }],
    })
    // The shell can still drain its output after the timeout, and the user cancels in that window:
    // the output says the command timed out, so the aborted signal changes nothing.
    metadata.bash = { exit: null }
    outputs.bash =
      "partial output\n\n<shell_metadata>\nshell tool terminated command after exceeding timeout 2000 ms.\n</shell_metadata>"
    const abort = new AbortController()
    abort.abort()
    yield* invoke(yield* resolve(), "bash", { command: "sleep 30" }, abort.signal)
    const [input] = yield* settle(failure, 1)
    expect(String(input?.error)).toStartWith("Command timed out after 2000 ms\npartial output")
    expect(input?.is_interrupt).toBe(false)
    expect(yield* Effect.promise(() => lines(success))).toEqual([])
  }),
)

it.live("runs no PostToolUse or PostToolUseFailure hook, async ones included, for a cancelled bash call", () =>
  Effect.gen(function* () {
    const dir = yield* scratch()
    const failure = path.join(dir, "failure")
    const success = path.join(dir, "success")
    yield* using({
      PostToolUseFailure: [{ matcher: "Bash", hooks: [{ ...record(failure), async: true }] }],
      PostToolUse: [{ matcher: "Bash", hooks: [{ ...record(success), async: true }] }],
    })
    const tools = yield* resolve()
    // Controls: the same async handlers do run for a timeout and for a zero exit.
    metadata.bash = { exit: null }
    outputs.bash = "<shell_metadata>\nshell tool terminated command after exceeding timeout 2000 ms.\n</shell_metadata>"
    yield* invoke(tools, "bash", { command: "sleep 30" })
    expect(yield* settle(failure, 1)).toHaveLength(1)
    metadata.bash = { exit: 0 }
    delete outputs.bash
    yield* invoke(tools, "bash", { command: "true" })
    expect(yield* settle(success, 1)).toHaveLength(1)
    // What the shell tool returns for an abort: no exit code, and its own note in the output.
    const abort = new AbortController()
    abort.abort()
    metadata.bash = { exit: null }
    outputs.bash = "partial output\n\n<shell_metadata>\nUser aborted the command\n</shell_metadata>"
    const result = yield* invoke(tools, "bash", { command: "sleep 30" }, abort.signal)
    expect(result.output).toBe(outputs.bash)
    // A call that exited keeps its hooks although its signal has aborted since.
    metadata.bash = { exit: 0 }
    delete outputs.bash
    yield* invoke(tools, "bash", { command: "true" }, abort.signal)
    expect(yield* settle(success, 2)).toHaveLength(2)
    expect(yield* Effect.promise(() => lines(failure))).toHaveLength(1)
  }),
)

it.live("keeps running PostToolUse for a bash command that exits zero or has no exit code", () =>
  Effect.gen(function* () {
    const dir = yield* scratch()
    const failure = path.join(dir, "failure")
    const success = path.join(dir, "success")
    yield* using({
      PostToolUseFailure: [{ matcher: "Bash", hooks: [record(failure)] }],
      PostToolUse: [{ matcher: "Bash", hooks: [record(success)] }],
    })
    const tools = yield* resolve()
    // The probe reports no metadata by default; a real shell call always has an exit code.
    yield* invoke(tools, "bash", { command: "true" })
    metadata.bash = { exit: 0 }
    yield* invoke(tools, "bash", { command: "true" })
    expect(yield* Effect.promise(() => lines(success))).toHaveLength(2)
    expect(yield* Effect.promise(() => lines(failure))).toEqual([])
  }),
)

it.live("fires CwdChanged when a bash call runs in another workdir than the previous one", () =>
  Effect.gen(function* () {
    const dir = yield* scratch()
    const marker = path.join(dir, "cwd")
    yield* using({ CwdChanged: [{ hooks: [record(marker)] }] })
    const tools = yield* resolve()
    yield* invoke(tools, "bash", { command: "ls", workdir: dir })
    yield* invoke(tools, "bash", { command: "ls", workdir: dir })
    const inputs = yield* settle(marker, 1)
    expect(inputs).toHaveLength(1)
    expect(inputs[0]).toMatchObject({
      hook_event_name: "CwdChanged",
      session_id: sessionID,
      old_cwd: process.cwd(),
      new_cwd: dir,
    })
    // Back in the session directory: one more run.
    yield* invoke(tools, "bash", { command: "ls" })
    const next = yield* settle(marker, 2)
    expect(next).toHaveLength(2)
    expect(next[1]).toMatchObject({ old_cwd: dir, new_cwd: process.cwd() })
  }),
)

it.live("fires InstructionsLoaded for the nested AGENTS.md files a read pulls in", () =>
  Effect.gen(function* () {
    const dir = yield* scratch()
    const marker = path.join(dir, "instructions")
    const file = path.join(dir, "sub", "main.ts")
    const agents = path.join(dir, "sub", "AGENTS.md")
    yield* using({ InstructionsLoaded: [{ matcher: "nested_traversal", hooks: [record(marker)] }] })
    metadata.read = { loaded: [agents] }
    yield* invoke(yield* resolve(), "read", { filePath: file })
    const inputs = yield* settle(marker, 1)
    expect(inputs).toHaveLength(1)
    expect(inputs[0]).toMatchObject({
      hook_event_name: "InstructionsLoaded",
      load_reason: "nested_traversal",
      file_path: agents,
      memory_type: "Project",
      trigger_file_path: file,
    })
  }),
)

it.live("rolls back the todo a TaskCreated hook blocks and keeps the rest of the update", () =>
  Effect.gen(function* () {
    const dir = yield* scratch()
    const marker = path.join(dir, "created")
    yield* using({ TaskCreated: [{ hooks: [gate(marker, "task_subject", "deploy to prod", "no deploys today")] }] })
    yield* seed([])
    const result = yield* invoke(yield* resolve(), "todowrite", {
      todos: [item("write tests", "pending"), item("deploy to prod", "pending")],
    })
    expect((yield* stored).map((todo) => todo.content)).toEqual(["write tests"])
    expect(result.output).toContain('<hook_feedback event="TaskCreated">')
    expect(result.output).toContain('Task "deploy to prod" was not created: no deploys today')
    const inputs = yield* Effect.promise(() => lines(marker))
    expect(inputs.map((input) => input.task_subject)).toEqual(["write tests", "deploy to prod"])
    expect(inputs[0]).toMatchObject({ hook_event_name: "TaskCreated", kilo_status: "pending", kilo_priority: "high" })
    expect(String(inputs[0]?.task_id)).toMatch(/^[0-9a-f]{8}$/)
  }),
)

it.live("keeps a todo open when a TaskCompleted hook blocks, while other changes land", () =>
  Effect.gen(function* () {
    const dir = yield* scratch()
    const marker = path.join(dir, "completed")
    yield* using({
      TaskCompleted: [{ hooks: [gate(marker, "task_subject", "write tests", "the tests still fail")] }],
    })
    yield* seed([item("write tests", "in_progress"), item("update docs", "pending", "low")])
    const result = yield* invoke(yield* resolve(), "todowrite", {
      todos: [item("write tests", "completed"), item("update docs", "pending", "high")],
    })
    expect(yield* stored).toEqual([item("write tests", "in_progress"), item("update docs", "pending", "high")])
    expect(result.output).toContain('Task "write tests" was kept open: the tests still fail')
  }),
)

it.live("keeps a todo's task_id across reorders and runs no Task hook for an unchanged list", () =>
  Effect.gen(function* () {
    const dir = yield* scratch()
    const created = path.join(dir, "created")
    const completed = path.join(dir, "completed")
    yield* using({ TaskCreated: [{ hooks: [record(created)] }], TaskCompleted: [{ hooks: [record(completed)] }] })
    yield* seed([])
    const tools = yield* resolve()
    yield* invoke(tools, "todowrite", { todos: [item("a", "pending"), item("b", "pending")] })
    yield* invoke(tools, "todowrite", { todos: [item("b", "pending"), item("a", "pending")] })
    expect(yield* Effect.promise(() => lines(created))).toHaveLength(2)
    expect(yield* Effect.promise(() => lines(completed))).toEqual([])
    yield* invoke(tools, "todowrite", { todos: [item("b", "pending"), item("a", "completed")] })
    const first = (yield* Effect.promise(() => lines(created))).find((input) => input.task_subject === "a")
    const [done] = yield* Effect.promise(() => lines(completed))
    expect(done?.task_subject).toBe("a")
    expect(done?.task_id).toBe(first?.task_id)
  }),
)

it.live("does not keep a todo open when a TaskCompleted hook's script is missing", () =>
  Effect.gen(function* () {
    yield* using({
      TaskCompleted: [
        {
          hooks: [
            exec(
              `process.stderr.write("python3: can't open file '/nonexistent.py': [Errno 2] No such file or directory"); process.exit(2)`,
            ),
          ],
        },
      ],
    })
    yield* seed([item("ship", "pending")])
    yield* invoke(yield* resolve(), "todowrite", { todos: [item("ship", "completed")] })
    expect(yield* stored).toEqual([item("ship", "completed")])
  }),
)

it.live("gives the permission prompt of a call a PermissionRequest review for that call", () =>
  Effect.gen(function* () {
    yield* using({})
    yield* seed([])
    yield* invoke(yield* resolve(), "todowrite", { todos: [] })
    expect(asks.at(0)?.review).toBeUndefined()
    yield* using({
      PermissionRequest: [
        {
          matcher: "TodoWrite",
          hooks: [
            exec(
              reply({
                hookSpecificOutput: {
                  hookEventName: "PermissionRequest",
                  decision: { behavior: "deny", message: "no" },
                },
              }),
            ),
          ],
        },
      ],
    })
    yield* invoke(yield* resolve(), "todowrite", { todos: [] })
    const review = asks.at(0)?.review
    if (!review) throw new Error("no PermissionRequest review")
    const verdict = yield* review({
      id: PermissionV1.ID.ascending(),
      sessionID,
      permission: "todowrite",
      patterns: ["*"],
      metadata: {},
      always: ["*"],
    })
    expect(verdict).toEqual({ deny: "A PermissionRequest hook denied this todowrite call: no" })
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

// SessionTools with the real permission service: what a PermissionRequest hook's deny does to the
// tool call the model made, for the tool's own ask and for a PreToolUse hook's forced ask.
const live = testEffect(
  Layer.mergeAll(
    shared,
    AppNodeBuilder.build(
      LayerNode.group([Permission.node, ConfigService.node, CrossSpawnSpawner.node, EventV2Bridge.node, Database.node]),
      [[ConfigService.node, settings]],
    ),
  ),
)

// A session whose rules ask before the `asker` tool runs.
const asking = SessionID.make("ses_hooks_asking")
const careful: Session.Info = { ...info(asking), permission: [{ permission: "asker", pattern: "*", action: "ask" }] }
sessions.set(asking, careful)

const deny = (message: string, extra: Record<string, unknown> = {}) =>
  exec(
    reply({
      hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "deny", message, ...extra } },
    }),
  )

live.instance(
  "a PermissionRequest deny fails the tool call with the hook's message",
  () =>
    Effect.gen(function* () {
      yield* using({ PermissionRequest: [{ matcher: "asker", hooks: [deny("no asking today")] }] })
      const result = yield* invoke(yield* resolve({ session: careful }), "asker")
      expect(result.error).toBeInstanceOf(KiloHooks.Denied)
      expect(result.error?.message).toBe("A PermissionRequest hook denied this asker call: no asking today")
      expect(runs).toEqual([])
      expect(yield* (yield* Permission.Service).list()).toEqual([])
    }),
  { git: true },
)

live.instance(
  "a PermissionRequest deny that asks to interrupt reaches the caller as a permission rejection",
  () =>
    Effect.gen(function* () {
      yield* using({ PermissionRequest: [{ hooks: [deny("stop everything", { interrupt: true })] }] })
      const result = yield* invoke(yield* resolve({ session: careful }), "asker")
      expect(result.error).toBeInstanceOf(PermissionV1.RejectedError)
      expect(runs).toEqual([])
    }),
  { git: true },
)

live.instance(
  "a PermissionRequest hook denies the forced prompt of a PreToolUse ask",
  () =>
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
        PermissionRequest: [{ matcher: "Bash", hooks: [deny("not on this machine")] }],
      })
      const result = yield* invoke(yield* resolve({ messages: turn(false) }), "bash", { command: "rm -rf build" })
      expect(result.error).toBeInstanceOf(KiloHooks.Denied)
      expect(result.error?.message).toBe("A PermissionRequest hook denied this bash call: not on this machine")
      expect(runs).toEqual([])
      expect(yield* (yield* Permission.Service).list()).toEqual([])
    }),
  { git: true },
)
