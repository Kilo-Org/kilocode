// ActiveDesignSession: one persistent Kilo session, driven in-process. Creates
// the session, then returns plain `dispatch`/`cancel` callbacks the orchestrator
// can fire from stdin/voice events. Each callback is wrapped with `Instance.bind`
// so it restores the instance ALS when invoked outside the Effect fiber (the
// callbacks fire from terminal input handlers), letting `AppRuntime.runPromise`
// resolve the per-project services correctly.

import { Effect } from "effect"
import * as Log from "@opencode-ai/core/util/log"
import { Session } from "@/session/session"
import { SessionPrompt } from "@/session/prompt"
import { ModelID, ProviderID } from "@/provider/schema"
import type { Permission } from "@/permission"
import { Instance } from "@/project/instance"
import { AppRuntime } from "@/effect/app-runtime"
import { designMetadata } from "./metadata"
import type { InputKind, Turn } from "./state"

const log = Log.create({ service: "design.session" })

export type ModelRef = { providerID: string; modelID: string }

export type ActiveDesignSession = {
  sessionID: string
  /** Fire a turn at the agent (non-blocking). Progress arrives via the session bus. */
  dispatch: (turn: Turn) => void
  /** Interrupt the active agent turn. */
  cancel: () => void
}

export const createActiveSession = Effect.fn("Design.createActiveSession")(function* (opts: {
  agent: string
  input: InputKind
  model?: ModelRef
  target?: string
  /** Reports a dispatch failure (e.g. invalid model) so the surface can show it. */
  onError?: (message: string) => void
}) {
  const sessions = yield* Session.Service
  const prompt = yield* SessionPrompt.Service
  // Design Mode is a fast, hands-free loop: auto-approve tool use so turns apply
  // edits without blocking on permission prompts (the surface has none).
  const permission: Permission.Ruleset = [{ permission: "*", pattern: "*", action: "allow" }]
  const info = yield* sessions.create({ agent: opts.agent, permission })
  const sessionID = info.id

  const dispatch = Instance.bind((turn: Turn) => {
    const effect = prompt.prompt({
      sessionID,
      agent: opts.agent,
      ...(opts.model
        ? { model: { providerID: ProviderID.make(opts.model.providerID), modelID: ModelID.make(opts.model.modelID) } }
        : {}),
      parts: [
        {
          type: "text",
          text: turn.text,
          metadata: designMetadata(turn, { input: opts.input, target: opts.target }),
        },
      ],
    })
    // Fire-and-forget: the orchestrator advances its queue from TurnClose on the
    // bus, not from this promise. We only surface dispatch failures here.
    AppRuntime.runPromise(effect).catch((err) => {
      log.error("dispatch failed", { sessionID, turnId: turn.id, err })
      opts.onError?.(err instanceof Error ? err.message : String(err))
    })
  })

  const cancel = Instance.bind(() => {
    AppRuntime.runPromise(prompt.cancel(sessionID)).catch((err) => {
      log.error("cancel failed", { sessionID, err })
    })
  })

  return { sessionID, dispatch, cancel } satisfies ActiveDesignSession
})
