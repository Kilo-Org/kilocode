import { Effect } from "effect"
import { ConfigRulesDetector, Runtime, type Composition, type ConfigRules, type Detector } from "@openguardrails/core"
import * as Config from "@/config/config"
import { Provider } from "@/provider/provider"
import { ModelID, ProviderID } from "@/provider/schema"
import type { MessageV2 } from "@/session/message-v2"
import { isSafeAllowlisted } from "./allowlist"
import { resolveJudgePolicy } from "./prompt"
import { buildTranscript, projectToolInput } from "./transcript"
import { buildGuardEvent } from "./ogr/event"
import { OwnModelJudge } from "./ogr/judge"
import { DEFAULT_COMPOSITION, DEFAULT_RULES } from "./ogr/rules"
import type { ClassifierDecision } from "./types"

// kilocode_change start — LLM command-approval classifier (issue #9138)

const ALLOW: ClassifierDecision = { kind: "allow" }
const ask = (reason: string): ClassifierDecision => ({ kind: "ask", reason })
const block = (reason: string): ClassifierDecision => ({ kind: "block", reason })

// Escalation backstop: too many denials in one turn → escalate to the human.
const MAX_CONSECUTIVE_DENIALS = 3
const MAX_TOTAL_DENIALS = 20

/**
 * Per-session denial counters. Reset when the latest user message changes
 * (i.e. on a new user turn), matching the issue's "counters reset on any user
 * turn". Keyed by sessionID.
 */
const counters = new Map<string, { lastUser: string; consecutive: number; total: number }>()

function lastUserId(messages: MessageV2.WithParts[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.info.role === "user") return messages[i]!.info.id
  }
  return ""
}

function parseModel(s: string): [ProviderID, ModelID] {
  const i = s.indexOf("/")
  return i === -1
    ? [ProviderID.make(s), ModelID.make(s)]
    : [ProviderID.make(s.slice(0, i)), ModelID.make(s.slice(i + 1))]
}

/**
 * Decide whether a would-auto-approve tool call should proceed, be blocked
 * (deny-and-continue), or be escalated to the human (`ask`).
 *
 * The decision is produced by **OpenGuardrails (OGR)**: the call becomes a
 * GuardEvent, runs through the OGR Runtime composing a deterministic
 * `ConfigRulesDetector` with an `OwnModelJudge` (the user's own model as a
 * guardrail), and the composed Verdict maps to the gate decision. There is no
 * bespoke backend enum — "local vs hosted" and "use my own model" are just which
 * OGR detectors are configured.
 *
 * Returns `undefined` when the classifier is disabled or the tool is on the
 * safe allowlist — the caller then proceeds exactly as today (no gating).
 *
 * Fails CLOSED: any error / OGR-unavailable / unparseable response → `ask`.
 *
 * Requires `Config` + `Provider`; the call site runs this through the request
 * EffectBridge so the captured context provides them (the thunk stays R=never).
 */
export const evaluate = Effect.fn("Classifier.evaluate")(function* (input: {
  tool: string
  toolInput: unknown
  messages: MessageV2.WithParts[]
  fallbackModel: Provider.Model
  sessionID: string
  abort: AbortSignal
}) {
  const cfg = (yield* (yield* Config.Service).get()).classifier
  if (!cfg?.enabled) return undefined
  if (isSafeAllowlisted(input.tool)) return undefined

  // Counter state, reset on a new user turn.
  const sid = input.sessionID
  const lu = lastUserId(input.messages)
  const c = counters.get(sid) ?? { lastUser: lu, consecutive: 0, total: 0 }
  if (c.lastUser !== lu) {
    c.lastUser = lu
    c.consecutive = 0
    c.total = 0
  }

  const verdict = yield* Effect.gen(function* () {
    // Resolve the model that backs the OGR judge: the configured classifier
    // model, else the agent's own model. Inside the catch so a missing model
    // fails closed (→ require_approval → human ask) rather than throwing.
    const provider = yield* Provider.Service
    let model: Provider.Model
    if (cfg.model) {
      const [providerID, modelID] = parseModel(cfg.model)
      model = yield* provider.getModel(providerID, modelID)
    } else {
      model = input.fallbackModel
    }
    const language = yield* provider.getLanguage(model)
    const label = `${model.providerID}/${model.id}`
    const detectors: Detector[] = [
      new ConfigRulesDetector((cfg.rules as ConfigRules | undefined) ?? DEFAULT_RULES),
      new OwnModelJudge(language, label, input.abort),
    ]
    const runtime = new Runtime(detectors, {
      composition: (cfg.composition as Composition | undefined) ?? DEFAULT_COMPOSITION,
    })
    const event = buildGuardEvent({
      tool: input.tool,
      action: { tool: input.tool, input: projectToolInput(input.tool, input.toolInput) },
      transcript: buildTranscript(input.messages),
      judgePolicy: resolveJudgePolicy(cfg),
      sessionId: sid,
    })
    return yield* Effect.promise(() => runtime.evaluate(event))
  }).pipe(
    // OGR-unavailable / any error → fail closed (the caller escalates to a human).
    Effect.catch((e) =>
      Effect.succeed({
        decision: "require_approval" as const,
        reasons: [e instanceof Error ? e.message : String(e)],
      }),
    ),
  )

  const reason = verdict.reasons.join("; ") || "blocked by the OGR command-approval policy"

  if (verdict.decision === "allow") {
    c.consecutive = 0
    counters.set(sid, c)
    return ALLOW
  }
  if (verdict.decision === "block") {
    c.consecutive += 1
    c.total += 1
    counters.set(sid, c)
    if (c.consecutive >= MAX_CONSECUTIVE_DENIALS || c.total >= MAX_TOTAL_DENIALS) {
      return ask("Repeated classifier denials this turn — escalating to you for review.")
    }
    return block(reason)
  }
  // require_approval / redact / modify → ask the human (don't count as a denial).
  counters.set(sid, c)
  return ask(reason)
})

// kilocode_change end

export * as Classifier from "./index"
