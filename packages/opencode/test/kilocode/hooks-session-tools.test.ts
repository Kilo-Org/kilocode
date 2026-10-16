import { expect } from "bun:test"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Database } from "@opencode-ai/core/database/database"
import { ProjectV2 } from "@opencode-ai/core/project"
import { Effect, Layer, Schema } from "effect"
import { Agent } from "@/agent/agent"
import { MCP } from "@/mcp"
import { Permission } from "@/permission"
import { Provider } from "@/provider/provider"
import { Session } from "@/session/session"
import { MessageID, SessionID } from "@/session/schema"
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

// Hook commands run through the platform shell; `bun -e` with double-quoted scripts stays portable.
const script = (code: string) => `"${process.execPath}" -e "${code}"`

const sessionID = SessionID.make("ses_hooks")
const messageID = MessageID.ascending()
const runs: string[] = []

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

const session = { id: sessionID, permission: [], directory: process.cwd() } as unknown as Session.Info

const hooks: Config.Info["hooks"] = {
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

const probe = (id: string): Tool.Def => ({
  id,
  description: `records ${id} runs`,
  parameters: Schema.Struct({}),
  jsonSchema: { type: "object", properties: {} },
  execute: () =>
    Effect.sync(() => {
      runs.push(id)
      return { title: id, metadata: {}, output: `${id} done` }
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
      ask: () => Effect.succeed({ manual: false }),
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
  Layer.mock(Session.Service)({ get: () => Effect.succeed(session) }),
  TestConfig.layer({ get: () => Effect.succeed({ hooks }) }),
  AppNodeBuilder.build(Database.node),
  Layer.succeed(
    ToolRegistry.Service,
    ToolRegistry.Service.of({
      ids: () => Effect.succeed(["edit", "write"]),
      all: () => Effect.succeed([]),
      named: () => Effect.die("unused"),
      tools: () => Effect.succeed([probe("edit"), probe("write")]),
    }),
  ),
)

const it = testEffect(layer)

const processor = {
  message: {
    id: messageID,
    sessionID,
    role: "assistant",
    parentID: MessageID.ascending(),
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

const resolve = SessionTools.resolve({
  agent,
  model,
  session,
  processor,
  bypassAgentCheck: false,
  messages: [],
  promptOps: {} as never,
  memoryCache: {},
}).pipe(Effect.provideService(InstanceRef, instance))

const options = (id: string) => ({ toolCallId: id, abortSignal: new AbortController().signal, messages: [] })

it.effect("blocks a tool call before it runs when a PreToolUse hook exits with 2", () =>
  Effect.gen(function* () {
    runs.length = 0
    const tools = yield* resolve
    const execute = tools.edit.execute
    if (!execute) throw new Error("edit tool is missing execute")
    const error = yield* Effect.promise(() =>
      Promise.resolve(execute({}, options("call_edit"))).then(
        () => undefined,
        (err: unknown) => err,
      ),
    )
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain("A PreToolUse hook blocked this edit call")
    expect((error as Error).message).toContain("edits are frozen")
    expect(runs).toEqual([])
  }),
)

it.effect("runs the tool and appends PostToolUse feedback to its result", () =>
  Effect.gen(function* () {
    runs.length = 0
    const tools = yield* resolve
    const execute = tools.write.execute
    if (!execute) throw new Error("write tool is missing execute")
    const result = (yield* Effect.promise(() => Promise.resolve(execute({}, options("call_write"))))) as {
      output: string
    }
    expect(runs).toEqual(["write"])
    expect(result.output).toContain("write done")
    expect(result.output).toContain("lint: 1 error")
  }),
)

it.effect("runs hooks for MCP tools, matching Claude Code's mcp__server__tool names", () =>
  Effect.gen(function* () {
    runs.length = 0
    const tools = yield* resolve
    const execute = tools.github_create_issue?.execute
    if (!execute) throw new Error("MCP tool is missing execute")
    const error = yield* Effect.promise(() =>
      Promise.resolve(execute({}, options("call_mcp"))).then(
        () => undefined,
        (err: unknown) => err,
      ),
    )
    expect((error as Error).message).toContain("no GitHub writes")
    expect(runs).toEqual([])
  }),
)
