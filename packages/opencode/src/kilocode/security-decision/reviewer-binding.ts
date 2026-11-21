// kilocode_change - new file
import { Effect } from "effect"
import { MessageID } from "@/session/schema"
import type { Agent } from "@/agent/agent"
import type { Config } from "@/config/config"
import type { LLM } from "@/session/llm"
import type { MessageV2 } from "@/session/message-v2"
import type { Provider } from "@/provider/provider"
import { KiloLLM } from "@/kilocode/session/llm"
import { LLM as LLMService } from "@/session/llm"
import { SecurityReviewer } from "./reviewer"
import { SecurityReviewerConfig } from "./reviewer-config"

/**
 * Binds the reviewer to a model through the existing provider and LLM services.
 *
 * There is no inference client here: the request is an ordinary `LLM.stream` call, the same one
 * `branch-name` and `commit-message` already make for their background models. `SecurityReviewer`
 * stays a policy wrapper — prompt, timeout, verdict validation, fail-closed — and this module only
 * supplies it with a way to reach a model.
 *
 * Isolation from the agent's session is structural rather than conventional. The reviewer's
 * `Complete` contract carries no session, so there is nothing to leak by accident; the request this
 * module builds names a synthetic session of its own, a hidden agent, and no tools at all. Nothing
 * it sends can reach the agent's history, its parent or root session, its tool approvals or its
 * export stream, because none of those identifiers are present in the request.
 */
export namespace SecurityReviewerBinding {
  /** The synthetic session the reviewer's own traffic is attributed to. Never a real session id. */
  export const SESSION = SecurityReviewer.AGENT

  export type Outcome =
    | Readonly<{ bound: true; providerID: string; modelID: string; source: SecurityReviewerConfig.Source }>
    | Readonly<{ bound: false; reason: SecurityReviewerConfig.Reason | "model_unavailable" }>

  const agent: Agent.Info = {
    name: SESSION,
    mode: "primary",
    hidden: true,
    options: {},
    permission: [],
    prompt: "",
    temperature: 0,
  } as Agent.Info

  /**
   * The stream request for one review.
   *
   * Exported so the isolation contract is assertable: everything that could tie this call to the
   * agent's session is either absent or a constant of this module.
   */
  export function request(model: Provider.Model, prompt: { system: string; user: string }): LLM.StreamInput {
    const user: MessageV2.User = {
      id: MessageID.ascending(),
      sessionID: SESSION,
      role: "user",
      time: { created: Date.now() },
      agent: agent.name,
      model: { providerID: model.providerID, modelID: model.id },
    } as MessageV2.User

    return {
      agent,
      user,
      model,
      // A reviewer answers with one JSON object; it never acts, so it is given nothing to act with.
      tools: {},
      small: true,
      sessionID: SESSION,
      system: [prompt.system],
      messages: [{ role: "user", content: prompt.user }],
      retries: 1,
    } as LLM.StreamInput
  }

  function complete(model: Provider.Model): SecurityReviewer.Complete {
    return async (prompt) => {
      // Loaded here rather than at module scope, and it has to stay that way. This module is
      // reachable from `kilocode/bootstrap`, which the control plane pulls in while its own module
      // body is still running; a static edge from here to the composition root closes that circle
      // and leaves `Workspace.node` in its temporal dead zone for any graph entered through the
      // server — which is exactly how the TUI worker enters it. See worker-module-graph.test.ts.
      const { AppRuntime } = await import("@/effect/app-runtime")
      return AppRuntime.runPromise(
        LLMService.Service.use((svc) => KiloLLM.text(svc.stream(request(model, prompt))).pipe(Effect.orDie)),
      )
    }
  }

  /**
   * Resolve a trusted model and bind it, or leave the reviewer unbound.
   *
   * Dependencies arrive as arguments rather than from the ambient context so the whole decision —
   * including the refusal to read a merged config — stays testable. An unbound reviewer is the safe
   * state: `SecurityReviewer.review` then reports `not_run` and every ask stands.
   */
  export const install = Effect.fn("SecurityReviewerBinding.install")(function* (
    config: Pick<Config.Interface, "get" | "getGlobal">,
    provider: Pick<Provider.Interface, "getModel">,
    env?: Record<string, string | undefined>,
  ) {
    const resolved = yield* SecurityReviewerConfig.resolve(config, env)
    if (!resolved.enabled) {
      SecurityReviewer.reset(resolved.reason)
      return { bound: false, reason: resolved.reason } satisfies Outcome
    }

    const model = yield* provider
      .getModel(resolved.providerID as never, resolved.modelID as never)
      .pipe(Effect.catchCause(() => Effect.succeed(undefined)))
    // A model the provider cannot produce is not a reviewer: stay unbound rather than reach for
    // whatever the session happens to be using.
    if (!model) {
      SecurityReviewer.reset("model_unavailable")
      return { bound: false, reason: "model_unavailable" } satisfies Outcome
    }

    SecurityReviewer.bind(complete(model), resolved.timeout, `${resolved.providerID}/${resolved.modelID}`)
    return {
      bound: true,
      providerID: resolved.providerID,
      modelID: resolved.modelID,
      source: resolved.source,
    } satisfies Outcome
  })
}
