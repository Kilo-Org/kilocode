import { expect, beforeEach } from "bun:test"
import { jsonSchema, type Tool as AITool, type ToolExecutionOptions } from "ai"
import { Effect, Layer } from "effect"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Agent } from "@/agent/agent"
import { Bus } from "@/bus"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { InstanceRef } from "@/effect/instance-ref"
import { MCP } from "@/mcp"
import { Permission } from "@/permission"
import { ProjectID } from "@/project/schema"
import type { InstanceContext } from "@/project/instance-context"
import { Plugin } from "@/plugin"
import { MessageV2 } from "@/session/message-v2"
import { Session } from "@/session/session"
import { SessionTools } from "@/session/tools"
import { MessageID, SessionID } from "@/session/schema"
import { ToolRegistry } from "@/tool/registry"
import { Truncate } from "@/tool/truncate"
import { TestConfig } from "../fixture/config"
import { tmpdirScoped } from "../fixture/fixture"
import { ProviderTest } from "../fake/provider"
import { testEffect } from "../lib/effect"

const projectID = ProjectID.make("mcp-structured-content")
const sessionID = SessionID.make("ses_mcp-structured-content")
const model = ProviderTest.model()
const agent: Agent.Info = {
  name: "build",
  mode: "primary",
  permission: Permission.fromConfig({ "*": "allow" }),
  options: {},
}

let result: Record<string, unknown> & { content: Array<Record<string, unknown>> }

beforeEach(() => {
  result = { content: [{ type: "text", text: "ok" }] }
})

function session(directory: string): Session.Info {
  return {
    id: sessionID,
    slug: "mcp-structured-content",
    projectID,
    directory,
    title: "MCP structured content",
    version: "test",
    permission: Permission.fromConfig({ "*": "allow" }),
    time: { created: 0, updated: 0 },
  }
}

function message(directory: string): MessageV2.Assistant {
  return {
    id: MessageID.make("msg_mcp-structured-content"),
    role: "assistant",
    parentID: MessageID.make("msg_mcp-structured-content-parent"),
    sessionID,
    mode: "build",
    agent: agent.name,
    path: { cwd: directory, root: directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: model.id,
    providerID: model.providerID,
    time: { created: 0 },
  }
}

function context(directory: string): InstanceContext {
  return {
    directory,
    worktree: directory,
    project: {
      id: projectID,
      worktree: directory,
      time: { created: 0, updated: 0 },
      sandboxes: [],
    },
  }
}

const mcp = Layer.mock(MCP.Service)({
  tools: () =>
    Effect.succeed({
      mcp_lookup: {
        description: "MCP lookup",
        inputSchema: jsonSchema({ type: "object", properties: {} }),
        execute: async () => result,
      } satisfies AITool,
    }),
})
const config = TestConfig.layer({
  get: () => Effect.succeed({ experimental: { sandbox: false } }),
})
const agents = Layer.mock(Agent.Service)({
  get: () => Effect.succeed(agent),
})
const sessions = Layer.mock(Session.Service)({
  get: () => Effect.succeed(session("/workspace")),
})
const permission = Layer.mock(Permission.Service)({
  ask: () => Effect.void,
})
const plugin = Layer.mock(Plugin.Service)({
  trigger: (_name, _input, output) => Effect.succeed(output),
})
const registry = Layer.mock(ToolRegistry.Service)({
  tools: () => Effect.succeed([]),
})
const truncate = Layer.mock(Truncate.Service)({
  output: (text: string) => Effect.succeed({ content: text, truncated: false as const }),
  limits: () => Effect.succeed({ maxLines: Truncate.MAX_LINES, maxBytes: Truncate.MAX_BYTES }),
})
const it = testEffect(
  Layer.mergeAll(
    config,
    agents,
    sessions,
    permission,
    plugin,
    registry,
    mcp,
    truncate,
    Bus.layer,
    AppFileSystem.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    RuntimeFlags.layer(),
  ),
)

function resolve(directory: string) {
  return SessionTools.resolve({
    agent,
    model,
    session: session(directory),
    processor: {
      message: message(directory),
      metadata: () => Effect.void,
      completeToolCall: () => Effect.void,
    },
    bypassAgentCheck: false,
    messages: [],
    promptOps: {
      cancel: () => Effect.die(new Error("cancel is not used by this test")),
      resolvePromptParts: () => Effect.die(new Error("resolvePromptParts is not used by this test")),
      prompt: () => Effect.die(new Error("prompt is not used by this test")),
    },
  }).pipe(Effect.provideService(InstanceRef, context(directory)))
}

function call(tool: AITool) {
  const options: ToolExecutionOptions = {
    toolCallId: "call_mcp_lookup",
    messages: [],
    abortSignal: new AbortController().signal,
  }
  if (!tool.execute) return Effect.die(new Error("tool has no execute callback"))
  return Effect.tryPromise({
    try: () => Promise.resolve(tool.execute?.({}, options)),
    catch: (error) => (error instanceof Error ? error : new Error(String(error))),
  })
}

it.live("preserves MCP structured content separately from text output", () =>
  Effect.gen(function* () {
    const dir = yield* tmpdirScoped()
    result = {
      content: [{ type: "text", text: "human-readable result" }],
      structuredContent: { rows: [{ id: 1 }] },
      _meta: { server: "mcp" },
    }

    const tools = yield* resolve(dir)
    const tool = tools.mcp_lookup
    if (!tool) return yield* Effect.die(new Error("expected MCP lookup tool"))
    const output = (yield* call(tool)) as Record<string, unknown>

    expect(output.output).toBe("human-readable result")
    expect(output.structuredContent).toEqual({ rows: [{ id: 1 }] })
    expect(output.metadata).toEqual({ truncated: false })
  }),
)

it.live("does not parse JSON text content into structuredContent", () =>
  Effect.gen(function* () {
    const dir = yield* tmpdirScoped()
    result = { content: [{ type: "text", text: '{"rows":[{"id":1}]}' }] }

    const tools = yield* resolve(dir)
    const tool = tools.mcp_lookup
    if (!tool) return yield* Effect.die(new Error("expected MCP lookup tool"))
    const output = (yield* call(tool)) as Record<string, unknown>

    expect(output.output).toBe('{"rows":[{"id":1}]}')
    expect(output.structuredContent).toBeUndefined()
  }),
)

it.live("omits oversized MCP structured content with metadata", () =>
  Effect.gen(function* () {
    const dir = yield* tmpdirScoped()
    result = {
      content: [{ type: "text", text: "large result" }],
      structuredContent: { text: "x".repeat(1024 * 1024) },
    }

    const tools = yield* resolve(dir)
    const tool = tools.mcp_lookup
    if (!tool) return yield* Effect.die(new Error("expected MCP lookup tool"))
    const output = (yield* call(tool)) as Record<string, Record<string, unknown> | unknown>

    expect(output.output).toBe("large result")
    expect(output.structuredContent).toBeUndefined()
    expect(output.metadata).toMatchObject({
      structuredContentOmitted: { reason: "size", maxBytes: 1024 * 1024 },
      truncated: false,
    })
  }),
)
