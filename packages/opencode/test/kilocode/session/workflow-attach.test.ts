import { afterAll, describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Effect, Stream } from "effect"
import { tool, type Tool } from "ai"
import z from "zod"
import { GitLabWorkflowLanguageModel, type WorkflowToolExecutor } from "gitlab-ai-provider"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import type { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { LLM } from "@/session/llm"
import { Provider } from "@/provider/provider"
import { SessionID, MessageID } from "@/session/schema"
import type { Agent } from "@/agent/agent"
import { ProviderTest } from "../../fake/provider"
import { withTmpdirInstance } from "../../fixture/fixture"

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-attach-"))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

/**
 * The wiring only needs the provider to hand back a workflow language model;
 * the stream itself is never the subject of these tests, so it fails loudly
 * instead of opening a WebSocket.
 */
class StubWorkflowModel extends GitLabWorkflowLanguageModel {
  override async doStream(): Promise<never> {
    throw new Error("workflow stream is not exercised in this test")
  }
  override async doGenerate(): Promise<never> {
    throw new Error("workflow stream is not exercised in this test")
  }
}

type Call = { tool: string; args: unknown }

/** The provider's own exported type describes exactly the shape llm.ts assigns. */
function isExecutor(value: unknown): value is WorkflowToolExecutor {
  return typeof value === "function"
}

function fakeTool(calls: Call[], name: string, run: () => unknown): Tool {
  return tool({
    description: name,
    inputSchema: z.object({}).passthrough(),
    execute: async (args: unknown) => {
      calls.push({ tool: name, args })
      return run()
    },
  })
}

function wired(input: { permission: PermissionV1.Rule[]; tools: Record<string, Tool> }) {
  const language = new StubWorkflowModel(
    "duo-workflow",
    { provider: "gitlab.workflow", instanceUrl: "https://gitlab.example", getHeaders: () => ({}) },
    { workingDirectory: dir },
  )
  const model = ProviderTest.model({
    providerID: ProviderV2.ID.make("gitlab"),
    id: ModelV2.ID.make("duo-workflow"),
    api: { id: "duo-workflow", url: "https://gitlab.example", npm: "gitlab-ai-provider" },
  })
  const fake = ProviderTest.fake({
    model,
    getLanguage: Effect.fn("WorkflowAttachTest.getLanguage")(() => Effect.succeed(language)),
  })
  const agent = {
    name: "test",
    mode: "primary",
    options: {},
    permission: input.permission,
  } satisfies Agent.Info
  const sessionID = SessionID.make("session-workflow-attach")

  return Effect.gen(function* () {
    const svc = yield* LLM.Service
    yield* svc
      .stream({
        user: {
          id: MessageID.make("msg_user-workflow-attach"),
          sessionID,
          role: "user",
          time: { created: Date.now() },
          agent: agent.name,
          model: { providerID: model.providerID, modelID: model.id },
        } satisfies SessionV1.User,
        sessionID,
        model,
        agent,
        system: ["system"],
        messages: [{ role: "user", content: "hello" }],
        tools: input.tools,
      })
      .pipe(Stream.runDrain)
      .pipe(Effect.exit)
    const executor: unknown = Reflect.get(language, "toolExecutor")
    if (!isExecutor(executor)) throw new Error("the workflow branch did not install a toolExecutor")
    const preapproved: unknown = Reflect.get(language, "sessionPreapprovedTools")
    if (!Array.isArray(preapproved)) throw new Error("the workflow branch did not set sessionPreapprovedTools")
    return { call: executor, preapproved: preapproved.filter((name): name is string => typeof name === "string") }
  }).pipe(
    withTmpdirInstance({ config: () => ({}) }),
    Effect.provide(AppNodeBuilder.build(LLM.node, [[Provider.node, fake.layer]])),
    Effect.scoped,
    Effect.runPromise,
  )
}

describe("workflow tool wiring", () => {
  test("denies a tool with a catch-all rule and never runs it", async () => {
    const calls: Call[] = []
    const { call, preapproved } = await wired({
      permission: [{ permission: "edit", pattern: "*", action: "deny" }],
      tools: { edit: fakeTool(calls, "edit", () => ({ output: "edited" })), bash: fakeTool(calls, "bash", () => "ok") },
    })

    expect(preapproved).not.toContain("edit")
    expect(preapproved).toContain("bash")
    expect(await call("edit", JSON.stringify({ filePath: "a.txt" }), "call-1")).toEqual({
      result: "",
      error: "Permission denied for tool: edit",
    })
    expect(calls).toEqual([])

    expect(await call("bash", JSON.stringify({ command: "ls" }), "call-2")).toMatchObject({ result: "ok" })
    expect(calls).toEqual([{ tool: "bash", args: { command: "ls" } }])
  })

  test("runs an allowed tool and shapes string, object and thrown results", async () => {
    const calls: Call[] = []
    const { call, preapproved } = await wired({
      permission: [],
      tools: {
        echo: fakeTool(calls, "echo", () => "plain text"),
        render: fakeTool(calls, "render", () => ({ output: "rendered", title: "Render", metadata: { bytes: 3 } })),
        boom: fakeTool(calls, "boom", () => {
          throw new Error("kaboom")
        }),
      },
    })

    // llm.ts consumes the request's tools sorted by name.
    expect(preapproved).toEqual(["boom", "echo", "render"])
    expect(await call("echo", JSON.stringify({ text: "hi" }), "call-1")).toMatchObject({
      result: "plain text",
    })
    expect(calls.at(0)).toEqual({ tool: "echo", args: { text: "hi" } })

    expect(await call("render", "{}", "call-2")).toEqual({
      result: "rendered",
      metadata: { bytes: 3 },
      title: "Render",
    })

    expect(await call("boom", "{}", "call-3")).toEqual({ result: "", error: "kaboom" })
  })

  test("answers a tool that is not in the map without throwing", async () => {
    const calls: Call[] = []
    const { call } = await wired({
      permission: [],
      tools: { bash: fakeTool(calls, "bash", () => "ok") },
    })

    expect(await call("mystery", "{}", "call-1")).toEqual({
      result: "",
      error: "Tool not available: mystery",
    })
    expect(calls).toEqual([])
  })

  test("answers a name that is not in the map when a ruleset is in force", async () => {
    const calls: Call[] = []
    const { call } = await wired({
      permission: [{ permission: "edit", pattern: "*", action: "deny" }],
      tools: { bash: fakeTool(calls, "bash", () => "ok") },
    })

    for (const [index, name] of ["constructor", "toString", "__proto__"].entries()) {
      expect(await call(name, "{}", `call-${index}`)).toEqual({
        result: "",
        error: `Tool not available: ${name}`,
      })
    }
    expect(calls).toEqual([])
  })

  test("leaves a path-scoped deny to the tool and still runs it", async () => {
    const calls: Call[] = []
    const { call, preapproved } = await wired({
      permission: [{ permission: "edit", pattern: "secrets/**", action: "deny" }],
      tools: { edit: fakeTool(calls, "edit", () => ({ output: "edited" })) },
    })

    // A rule scoped to one path cannot speak for the whole tool, so the call
    // reaches the tool, whose own per-argument check decides the path.
    expect(preapproved).toContain("edit")
    expect(await call("edit", JSON.stringify({ filePath: "secrets/key.txt" }), "call-1")).toMatchObject({
      result: "edited",
    })
    expect(calls).toEqual([{ tool: "edit", args: { filePath: "secrets/key.txt" } }])
  })
})
