import { Agent } from "@/agent/agent"
import { Provider } from "@/provider/provider"
import { Session } from "@/session/session"
import { SessionID } from "@/session/schema"
import { Effect } from "effect"

type Model = NonNullable<Session.Info["model"]>

export const updateSessionSelection = Effect.fn("KiloSession.updateSelection")(function* (input: {
  sessionID: SessionID
  current: Session.Info
  agent: string | undefined
  model: Model | undefined
}) {
  if (input.agent === undefined && input.model === undefined) return

  const agents = yield* Agent.Service
  const providers = yield* Provider.Service
  const sessions = yield* Session.Service
  const agent = input.agent ?? input.current.agent ?? (yield* agents.defaultAgent())
  const stored = input.model ?? input.current.model
  const model =
    stored ??
    (yield* Effect.gen(function* () {
      const profile = yield* agents.get(agent)
      const fallback = profile.model ?? (yield* providers.defaultModel().pipe(Effect.orDie))
      return {
        id: fallback.modelID,
        providerID: fallback.providerID,
        ...(profile.model && profile.variant ? { variant: profile.variant } : {}),
      }
    }))
  const variant = model.variant ?? "default"
  const same =
    input.current.agent === agent &&
    input.current.model?.id === model.id &&
    input.current.model.providerID === model.providerID &&
    (input.current.model.variant ?? "default") === variant
  if (same) return

  yield* sessions.setAgentModel({
    sessionID: input.sessionID,
    agent,
    model: { ...model, variant },
    time: Date.now(),
  })
})
