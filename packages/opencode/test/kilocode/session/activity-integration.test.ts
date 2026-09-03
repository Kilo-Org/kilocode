import path from "node:path"
import { expect } from "bun:test"
import { Effect, Fiber } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { BackgroundJob } from "@/background/job"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Permission } from "@/permission"
import { Question } from "@/question"
import { Session } from "@/session/session"
import { SessionPrompt } from "@/session/prompt"
import { SessionStatus } from "@/session/status"
import { TestInstance } from "../../fixture/fixture"
import { awaitWithTimeout, pollWithTimeout, testEffect } from "../../lib/effect"
import { reply, TestLLMServer } from "../../lib/llm-server"

const it = testEffect(
  LayerNode.compile(
    LayerNode.group([
      SessionPrompt.node,
      Session.node,
      SessionProjector.node,
      SessionStatus.node,
      EventV2Bridge.node,
      Permission.node,
      Question.node,
      BackgroundJob.node,
      FSUtil.node,
      LayerNode.make({ service: TestLLMServer, layer: TestLLMServer.layer, deps: [] }),
    ]),
  ),
)

for (const kind of ["question", "task"] as const) {
  it.instance(
    `reports real ${kind} user waits through the prompt engine and clears on cancel`,
    () =>
      Effect.gen(function* () {
        const llm = yield* TestLLMServer
        const fs = yield* FSUtil.Service
        const instance = yield* TestInstance
        yield* fs.writeWithDirs(
          path.join(instance.directory, "kilo.json"),
          JSON.stringify({
            model: "test/test-model",
            small_model: "test/test-model",
            enabled_providers: ["test"],
            formatter: false,
            lsp: false,
            permission: { "*": "allow", bash: "ask" },
            provider: {
              test: {
                name: "Test",
                npm: "@ai-sdk/openai-compatible",
                options: { apiKey: "test-key", baseURL: llm.url },
                models: {
                  "test-model": { name: "Test Model", tool_call: true, limit: { context: 100000, output: 10000 } },
                },
              },
            },
          }),
        )
        const sessions = yield* Session.Service
        const prompt = yield* SessionPrompt.Service
        const status = yield* SessionStatus.Service
        const permission = yield* Permission.Service
        const questions = yield* Question.Service
        const parent = yield* sessions.create({ title: "Activity integration" })
        yield* llm.push(
          ...(kind === "question"
            ? [
                reply().tool("question", {
                  questions: [
                    { header: "Continue", question: "Continue?", options: [{ label: "Yes", description: "Continue" }] },
                  ],
                }),
              ]
            : [
                reply().tool("task", { description: "Inspect directory", prompt: "Run pwd", subagent_type: "general" }),
                reply().tool("bash", { command: "pwd", description: "Inspect directory" }),
              ]),
        )
        const running = yield* prompt
          .prompt({
            sessionID: parent.id,
            agent: "code",
            model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test-model") },
            parts: [{ type: "text", text: "Run the requested tool" }],
          })
          .pipe(Effect.forkChild)
        const blocked =
          kind === "question"
            ? yield* pollWithTimeout(
                Effect.map(questions.list(), (items) => items.at(0)?.sessionID),
                "Root question was not asked",
                "15 seconds",
              )
            : yield* pollWithTimeout(
                Effect.map(permission.list(), (items) => items.find((item) => item.sessionID !== parent.id)?.sessionID),
                "Child permission was not asked",
                "15 seconds",
              )
        yield* pollWithTimeout(
          Effect.map(SessionStatus.snapshot(status), (items) => {
            const root = items.get(parent.id)
            const child = items.get(blocked)
            return root?.type === "busy" && root.working === false && child?.working === false ? true : undefined
          }),
          "User wait still contributed automatic work",
          "15 seconds",
        )
        expect((yield* status.get(parent.id)).type).toBe("busy")
        if (kind === "task") {
          expect(blocked).not.toBe(parent.id)
          expect((yield* status.get(blocked)).type).toBe("busy")
        }
        yield* prompt.cancel(parent.id)
        yield* awaitWithTimeout(Fiber.await(running), "Prompt did not cancel", "10 seconds")
        yield* pollWithTimeout(
          Effect.map(SessionStatus.snapshot(status), (items) => {
            return !items.get(parent.id)?.working && !items.get(blocked)?.working ? true : undefined
          }),
          "Cancelled work retained a contribution",
        )
        expect((yield* status.get(parent.id)).type).toBe("idle")
      }),
    40_000,
  )
}
