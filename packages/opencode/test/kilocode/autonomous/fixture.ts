import path from "path"
import { Effect, Layer, Schema } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Agent } from "@/agent/agent"
import * as MCP from "@/mcp"
import { BackgroundJob } from "@/background/job"
import { Command } from "@/command"
import { Config } from "@/config/config"
import { Provider } from "@/provider/provider"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Permission } from "@/permission"
import { Question } from "@/question"
import { Session } from "@/session/session"
import { SessionPrompt } from "@/session/prompt"
import { SessionStatus } from "@/session/status"
import { SessionRunState } from "@/session/run-state"
import { SessionDrain } from "@/kilocode/session/drain"
import { Storage } from "@/storage/storage"
import { AutonomousRunner } from "@/kilocode/autonomous/runner"
import { TestInstance } from "../../fixture/fixture"
import { testEffect } from "../../lib/effect"
import { TestLLMServer } from "../../lib/llm-server"

const ops = Layer.effect(
  AutonomousRunner.Ops,
  Effect.gen(function* () {
    const svc = yield* SessionPrompt.Service
    return AutonomousRunner.Ops.of({ prompt: svc.prompt, cancel: svc.cancel })
  }),
)

const compiled = LayerNode.compile(
    LayerNode.group([
      SessionPrompt.node,
      Session.node,
      SessionProjector.node,
      SessionStatus.node,
      SessionRunState.node,
      SessionDrain.node,
      Agent.node,
      MCP.node,
      BackgroundJob.node,
      Command.node,
      EventV2Bridge.node,
      Permission.node,
      Question.node,
      FSUtil.node,
      Storage.node,
      Config.node,
      Provider.node,
      LayerNode.make({ service: TestLLMServer, layer: TestLLMServer.layer, deps: [] }),
    ]),
  )

export const it = testEffect(Layer.provideMerge(ops, compiled))

/** Writes an opencode.json pointing every model class at the fake LLM server. */
export const setup = Effect.fnUntraced(function* (cfg: Partial<Config.Info> = {}) {
  const llm = yield* TestLLMServer
  const fs = yield* FSUtil.Service
  const instance = yield* TestInstance
  const model = {
    name: "Test Model",
    tool_call: true,
    attachment: true,
    modalities: { input: ["text", "image"], output: ["text"] },
    limit: { context: 100000, output: 10000 },
    cost: { input: 1, output: 2 },
  }
  yield* fs.writeWithDirs(
    path.join(instance.directory, "opencode.json"),
    JSON.stringify({
      model: "test/cloud",
      small_model: "test/small",
      subagent_model: "test/coder",
      enabled_providers: ["test"],
      formatter: false,
      lsp: false,
      autonomous_goal: { enabled: true },
      ...cfg,
      provider: {
        test: {
          name: "Test",
          npm: "@ai-sdk/openai-compatible",
          options: { apiKey: "test-key", baseURL: llm.url },
          models: { small: model, coder: model, cloud: model },
        },
      },
    }),
  )
  const sessions = yield* Session.Service
  const prompt = yield* SessionPrompt.Service
  const root = yield* sessions.create({ title: "Autonomous root" })
  return { llm, sessions, prompt, root, directory: instance.directory }
})

export const Sample = Schema.Struct({ ok: Schema.Boolean, items: Schema.Array(Schema.String) })
