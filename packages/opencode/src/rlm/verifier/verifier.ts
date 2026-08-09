/**
 * Sara RLM — Verifier (Phase 3)
 * Calls the LLM to produce a structured verification.
 */

import type { RLMVerification } from "./schema.js"
import { validateVerification } from "./schema.js"
import { buildVerifierPrompt } from "./prompt.js"
import type { RLMResult } from "../result.js"
import type { RLMContext } from "../context.js"
import { rlmExecutionError, rlmVerificationError } from "../error.js"
import { Effect, Cause } from "effect"
import { SessionPrompt } from "@/session/prompt"
import { Provider } from "@/provider/provider"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"

export function verify(result: RLMResult, taskDescription: string, ctx: RLMContext) {
  return Effect.gen(function* () {
    const promptSvc = yield* SessionPrompt.Service
    const providerSvc = yield* Provider.Service
    const model = ctx.agent.model ?? (yield* providerSvc.defaultModel().pipe(Effect.orDie))

    const promptText = buildVerifierPrompt(result, taskDescription)

    const verifierInput = {
      sessionID: ctx.rootSessionID,
      agent: ctx.agent.name, // Use the agent resolved by the runtime (same agent as leaf execution)
      model: {
        providerID: ProviderV2.ID.make(model.providerID),
        modelID: ModelV2.ID.make(model.modelID),
      },
      parts: [{ type: "text" as const, text: promptText }],
    }

    const llmResult = yield* promptSvc
      .prompt(verifierInput as SessionPrompt.PromptInput)
      .pipe(
        Effect.catchCause((cause: Cause.Cause<unknown>) =>
          Effect.fail(rlmExecutionError("Verifier LLM call failed", { cause: Cause.squash(cause) })),
        ),
      )

    const parts = llmResult.parts
    const responseText = parts
      .filter((p: any) => p.type === "text" && !("synthetic" in p && p.synthetic === true))
      .map((p: any) => p.text ?? "")
      .join("\n")
      .trim()

    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(responseText)
    } catch (e) {
      return Effect.fail(
        rlmVerificationError("Verifier returned invalid JSON", {
          reason: responseText.slice(0, 500),
          cause: e,
        }),
      )
    }

    const errors = validateVerification(parsed)
    if (errors.length > 0) {
      return Effect.fail(
        rlmVerificationError("Verification output failed schema validation", {
          reason: errors.join("; "),
        }),
      )
    }

    return parsed as unknown as RLMVerification
  })
}