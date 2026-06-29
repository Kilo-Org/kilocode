import { generateText } from "ai"
import type { Decision, Detector, GuardEvent, Verdict } from "@openguardrails/core"
import { OGR_VERSION } from "@openguardrails/core"
import { buildSystemPrompt, ERR_ON_BLOCK_SUFFIX, parseVerdict } from "../prompt"
import type { ClassifierAction, JudgePolicy, TranscriptEntry } from "../types"

// kilocode_change start — OGR LLM-judge detector backed by the user's own model (issue #9138)

/** Whatever `generateText` accepts as `model` — avoids pinning a provider-spec version. */
type LanguageModel = Parameters<typeof generateText>[0]["model"]

/** Render the reasoning-blind transcript + the action under evaluation, last. */
function renderUserPrompt(transcript: TranscriptEntry[], action: ClassifierAction): string {
  const lines: string[] = []
  for (const e of transcript) {
    if (e.role === "user") lines.push(`User: ${e.text}`)
    else lines.push(`${e.tool} ${JSON.stringify(e.input)}`)
  }
  lines.push(`${action.tool} ${JSON.stringify(action.input)}`)
  return `<transcript>\n${lines.join("\n")}\n</transcript>${ERR_ON_BLOCK_SUFFIX}`
}

function verdict(ev: GuardEvent, provider: string, decision: Decision, reason: string, category?: string): Verdict {
  return {
    eventId: ev.eventId,
    guardId: ev.guardId,
    provider,
    decision,
    categories: category ? [{ id: category, domain: "security", score: 0.9 }] : [],
    reasons: [reason],
    ogrVersion: OGR_VERSION,
  }
}

/**
 * OGR detector: "use your own model as the guardrail". Classifies the gated tool
 * call with the user's configured model over the reasoning-blind transcript
 * (single-pass `<block>yes|no</block>`), and returns an OGR Verdict.
 *
 * Fails CLOSED: any error or unparseable response → `require_approval`, which
 * the gate maps to a human `ask`. This is the OGR-native replacement for the old
 * `ClassifierProvider` backends — no more `own`/`http`/`og-*` enum; where the
 * verdict comes from is just which OGR detectors are composed.
 */
export class OwnModelJudge implements Detector {
  readonly provider: string
  readonly handles = ["tool_call", "exec"] as const

  constructor(
    private readonly model: LanguageModel,
    label: string,
    private readonly signal: AbortSignal,
  ) {
    this.provider = `ogr.llm_judge(${label})`
  }

  async evaluate(ev: GuardEvent): Promise<Verdict> {
    const transcript = (ev.payload["transcript"] as TranscriptEntry[] | undefined) ?? []
    const action = ev.payload["action"] as ClassifierAction
    const policy = ev.payload["judgePolicy"] as JudgePolicy
    try {
      const res = await generateText({
        model: this.model,
        system: buildSystemPrompt(policy),
        messages: [{ role: "user", content: renderUserPrompt(transcript, action) }],
        temperature: 0,
        maxOutputTokens: 256,
        abortSignal: this.signal,
      })
      const parsed = parseVerdict(res.text)
      if (!parsed) return verdict(ev, this.provider, "require_approval", "classifier response unparseable")
      return parsed.shouldBlock
        ? verdict(
            ev,
            this.provider,
            "block",
            parsed.reason ?? "blocked by the OGR command-approval judge",
            "security.policy_violation",
          )
        : verdict(ev, this.provider, "allow", "no policy violation")
    } catch (e) {
      return verdict(ev, this.provider, "require_approval", e instanceof Error ? e.message : "classifier unavailable")
    }
  }
}

// kilocode_change end
