import { expect } from "bun:test"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Agent } from "@/agent/agent"
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
// kilocode_change start - Kilo's SessionTools.resolve needs these services and instance context
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Database } from "@opencode-ai/core/database/database"
import { ProjectV2 } from "@opencode-ai/core/project"
import { InstanceRef } from "@/effect/instance-ref"
import type { InstanceContext } from "@/project/instance-context"
import { TestConfig } from "../fixture/config"
// kilocode_change end
import { Effect, Layer, Schema } from "effect"
import { testEffect } from "../lib/effect"

const callID = "call-test"
const sessionID = SessionID.make("ses_test")
const messageID = MessageID.ascending()
const partID = PartID.ascending()

const agent: Agent.Info = {
  name: "build",
  mode: "primary",
  options: {},
  permission: [{ permission: "*", pattern: "*", action: "allow" }],
}

const model = {
  providerID: ProviderV2.ID.make("test"),
  api: { id: "test-model" },
} as Provider.Model

function fakeMcp() {
  return MCP.Service.of({
    tools: () => Effect.succeed({}),
    clients: () => Effect.succeed({}),
  } as Partial<MCP.Interface> as MCP.Interface)
}

const fakePlugin = Plugin.Service.of({
  init: () => Effect.void,
  list: () => Effect.succeed([]),
  trigger: (_name, _input, output) => Effect.succeed(output),
} satisfies Plugin.Interface)

const fakePermission = Permission.Service.of({
  // kilocode_change - Kilo's Permission.ask returns an AskOutcome, not void
  ask: () => Effect.succeed({ manual: false }),
  reply: () => Effect.void,
  list: () => Effect.succeed([]),
  // kilocode_change start - Kilo-only Permission.Interface members, unused here
  saveAlwaysRules: () => Effect.void,
  allowEverything: () => Effect.void,
  pending: () => Effect.succeed(undefined),
  // kilocode_change end
} satisfies Permission.Interface)

const fakeTruncate = Truncate.Service.of({
  cleanup: () => Effect.void,
  write: () => Effect.succeed("output.txt"),
  output: (text: string) => Effect.succeed({ content: text, truncated: false }),
  limits: () => Effect.succeed({ maxLines: 2000, maxBytes: 50 * 1024 }),
} satisfies Truncate.Interface)

// kilocode_change start - Kilo's resolve reads the active instance directory and
// the agent/session/config services while wiring permissions and sandbox state.
const instance = {
  directory: "/tmp",
  worktree: "/tmp",
  project: {
    id: ProjectV2.ID.make("test-project"),
    worktree: "/tmp",
    vcs: "git",
    time: { created: 0, updated: 0 },
    sandboxes: [],
  },
} satisfies InstanceContext

const sessionInfo = { id: sessionID, permission: [] } as unknown as Session.Info

const fakeAgent = Layer.mock(Agent.Service)({
  get: () => Effect.succeed(agent),
})

const fakeSession = Layer.mock(Session.Service)({
  get: () => Effect.succeed(sessionInfo),
})
// kilocode_change end

const layer = Layer.mergeAll(
  Layer.succeed(Plugin.Service, fakePlugin),
  Layer.succeed(Permission.Service, fakePermission),
  Layer.succeed(MCP.Service, fakeMcp()),
  Layer.succeed(Truncate.Service, fakeTruncate),
  RuntimeFlags.layer(),
  // kilocode_change start - services and storage Kilo's resolve depends on
  fakeAgent,
  fakeSession,
  TestConfig.layer(),
  AppNodeBuilder.build(Database.node),
  // kilocode_change end
  Layer.succeed(
    ToolRegistry.Service,
    ToolRegistry.Service.of({
      ids: () => Effect.succeed(["timing"]),
      all: () => Effect.succeed([]),
      named: () => Effect.die("unused"),
      tools: () =>
        Effect.succeed([
          {
            id: "timing",
            description: "updates metadata more than once",
            parameters: Schema.Struct({}),
            jsonSchema: { type: "object", properties: {} },
            execute: (_args, ctx) =>
              Effect.gen(function* () {
                yield* ctx.metadata({ metadata: { output: "first" } })
                yield* ctx.metadata({ metadata: { output: "second" } })
                return { title: "timing", metadata: {}, output: "done" }
              }),
          } satisfies Tool.Def,
        ]),
    }),
  ),
)

const it = testEffect(layer)

it.effect("preserves running tool start time across metadata updates", () =>
  Effect.gen(function* () {
    const state: SessionV1.ToolPart = {
      id: partID,
      sessionID,
      messageID,
      type: "tool",
      tool: "timing",
      callID,
      state: {
        status: "running",
        input: {},
        time: { start: 100 },
      },
    }
    const updates: number[] = []
    const processor = {
      message: {
        id: messageID,
        sessionID,
        role: "assistant",
        parentID: MessageID.ascending(),
        agent: "build",
        mode: "build",
        path: { cwd: "/tmp", root: "/tmp" },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        modelID: ModelV2.ID.make("test-model"),
        providerID: ProviderV2.ID.make("test"),
        time: { created: 1 },
      } satisfies SessionV1.Assistant,
      // kilocode_change - Kilo routes Tool.Context.metadata through
      // processor.metadata instead of upstream's updateToolCall, so the mock
      // applies metadata to the running part and records the preserved start.
      metadata: (_toolCallID, input) =>
        Effect.sync(() => {
          if (state.state.status !== "running") return
          state.state = {
            ...state.state,
            title: input.title ?? state.state.title,
            metadata: { ...state.state.metadata, ...input.metadata },
          }
          updates.push(state.state.time.start)
        }),
      completeToolCall: () => Effect.void,
    } satisfies Pick<SessionProcessor.Handle, "message" | "metadata" | "completeToolCall">

    const tools = yield* SessionTools.resolve({
      agent,
      model,
      session: sessionInfo, // kilocode_change - shared with the Session.Service mock
      processor,
      bypassAgentCheck: false,
      messages: [],
      promptOps: {} as never,
      memoryCache: {}, // kilocode_change - required by Kilo's resolve signature
    }).pipe(Effect.provideService(InstanceRef, instance)) // kilocode_change - Kilo resolves sandbox state from the active instance
    const execute = tools.timing.execute
    if (!execute) throw new Error("timing tool is missing execute")

    yield* Effect.promise(() =>
      execute(
        {},
        {
          toolCallId: callID,
          abortSignal: new AbortController().signal,
          messages: [],
        },
      ),
    )

    expect(updates).toEqual([100, 100])
    expect(state.state.status).toBe("running")
    if (state.state.status === "running") {
      expect(state.state.time.start).toBe(100)
    }
  }),
)
