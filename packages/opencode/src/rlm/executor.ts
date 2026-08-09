/**
 * Sara RLM — Phase 1 Executor
 */
import { computeUsage } from "./result.js"
import { rlmAborted, rlmExecutionError } from "./error.js"
import type { RLMTask } from "./task.js"
import type { RLMContext } from "./context.js"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import { SessionPrompt } from "@/session/prompt"
import { Provider } from "@/provider/provider"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { Effect, Cause } from "effect"
import { errorMessage } from "@/util/error"

export function run(task: RLMTask, ctx: RLMContext) {
  return Effect.gen(function* () {
    if (ctx.abort.aborted) {
      return yield* Effect.fail(rlmAborted("Task aborted before execution started"))
    }

    const promptSvc = yield* SessionPrompt.Service
    const providerSvc = yield* Provider.Service
    const model = ctx.agent.model ?? (yield* providerSvc.defaultModel().pipe(Effect.orDie))

    const promptInput = {
      sessionID: task.sessionID,
      agent: ctx.agent.name,
      model: {
        providerID: ProviderV2.ID.make(model.providerID),
        modelID: ModelV2.ID.make(model.modelID),
      },
      parts: [{ type: "text" as const, text: task.prompt }],
    }

    const rawResult = yield* promptSvc
      .prompt(promptInput as SessionPrompt.PromptInput)
      .pipe(
        Effect.catchCause((cause: Cause.Cause<unknown>) =>
          Effect.fail(rlmExecutionError("Agent loop failed: " + errorMessage(Cause.squash(cause)), { cause: Cause.squash(cause) })),
        ),
        Effect.onInterrupt(() => Effect.fail(rlmAborted("Task aborted during execution"))),
      )

    // narrow through unknown
    const result = (rawResult as unknown) as SessionV1.WithParts
    const info = result.info
    const parts = result.parts as unknown as Array<SessionV1.TextPart>

    const textOutput = parts
      .filter((p) => p.type === "text" && !("synthetic" in p && p.synthetic === true))
      .map((p) => p.text)
      .join("\n")
      .trim()

    let usage = computeUsage({ input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } })
    let status: "success" | "failure" = "success"

    if (info.role === "assistant") {
      usage = computeUsage({
        input: info.tokens.input,
        output: info.tokens.output,
        reasoning: info.tokens.reasoning,
        cache: { read: info.tokens.cache.read, write: info.tokens.cache.write },
      })
      status = info.error ? "failure" : "success"
    }

    return {
      taskID: task.id,
      status,
      output: textOutput || "(no output)",
      summary: (textOutput || "(no output)").slice(0, 500),
      usage,
      duration: Date.now() - task.createdAt,
    }
  })
}