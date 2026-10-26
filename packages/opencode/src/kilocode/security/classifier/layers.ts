/**
 * The semantic security layer.
 *
 * Security Auto Mode's authority is the deterministic engine. This layer is a *witness*: it looks at
 * a decision the engine could not settle and may say "the text that led here was telling the agent to
 * do this". What it says never becomes a decision on its own — it becomes one more piece of evidence,
 * folded through the same monotone reducer every other layer uses.
 *
 * That is the whole design, and it is why the invariants are not a list of `if` statements:
 *
 *   `Decision.reduce` folds evidence with `stricter()`, starting from ALLOW. Appending evidence can
 *   move a decision towards ASK or DENY and can never move it back. A layer that only ever *appends*
 *   is, structurally, incapable of relaxing anything.
 *
 * Concretely, and provably rather than by convention:
 *   - a deterministic DENY stays DENY, whatever the model says;
 *   - a hard ASK stays a hard ASK;
 *   - the model can never produce ALLOW, because ALLOW is the identity of the fold, not a value this
 *     layer can contribute. `BENIGN_CONTEXT` is in the vocabulary so the model has somewhere to put
 *     "I looked and this is fine", and it maps to no evidence at all — the only representation of a
 *     benign verdict that cannot be turned into permission;
 *   - the model can never produce DENY either. It contributes an ASK. A layer whose input is a model
 *     may insist on a person; it may not end the task on its own judgement.
 *
 * What changed from the action-only version: that one judged the command. It caught an upload whose
 * *file name* looked like a secret and missed every case where the secret was staged through a file
 * called `staged.dat` first — because the name is all it had. This one is given the untrusted text
 * the session actually read, which is where the meaning was the whole time.
 */
import { Effect } from "effect"
import { Decision } from "../decision"
import { SecretContent } from "../state/content"
import { SecuritySessionState } from "../state/store"
import type { NormalizedAction, NormalizedPath, SecurityDecision, SecurityEvidence } from "../types"
import { ClassifierBreaker, type ClassifierProvider } from "./provider"
import type { Provenance, SemanticInput, Verdict } from "./schema"

export namespace SemanticEvidence {
  /** Counters for the ablation: cost and reliability are reported, never inferred. */
  export interface Stats {
    calls: number
    flagged: number
    errors: number
    timeouts: number
    considered: number
    latencies: number[]
    byCategory: Record<string, number>
    /**
     * Every answered verdict, tallied as `RISK/CATEGORY/CONFIDENCE`, whether or not it produced
     * evidence.
     *
     * `byCategory` only counts what was acted on, which makes the two questions that matter about a
     * probabilistic layer unanswerable: how often it says nothing, and whether the verdicts it gets
     * wrong are the ones it hedges on. Both were guesses until this counter existed.
     */
    byVerdict: Record<string, number>
  }

  const stats: Stats = {
    calls: 0,
    flagged: 0,
    errors: 0,
    timeouts: 0,
    considered: 0,
    latencies: [],
    byCategory: {},
    byVerdict: {},
  }

  export function snapshot(): Stats {
    return {
      ...stats,
      latencies: [...stats.latencies],
      byCategory: { ...stats.byCategory },
      byVerdict: { ...stats.byVerdict },
    }
  }

  export function reset() {
    ClassifierBreaker.reset()
    stats.calls = 0
    stats.flagged = 0
    stats.errors = 0
    stats.timeouts = 0
    stats.considered = 0
    stats.latencies = []
    stats.byCategory = {}
    stats.byVerdict = {}
  }

  /**
   * Routing: which decisions are even eligible for a model call.
   *
   * Three conditions, all required. A DENY or a hard ASK is settled — the engine already stopped the
   * action, and a model call could only add latency. The action has to actually move data outward or
   * run through delegated authority — an `ls` is not a semantics problem. And the session has to have
   * read something untrusted, or have a recorded goal to compare against: with neither, there is no
   * semantic question to ask, only a command, and the engine reads commands better than a model does.
   */
  export function considers(input: {
    decision: SecurityDecision
    action: NormalizedAction
    sessionID: string
  }): boolean {
    const { decision, action } = input
    if (decision.action === "deny") return false
    if (decision.action === "ask" && decision.hard) return false
    const interesting =
      (action.kind === "shell" && action.command.commands.some((process) => process.network)) ||
      (action.kind === "permission" && action.permission.startsWith("mcp"))
    if (!interesting) return false
    const hasContext =
      SecuritySessionState.ingestedOf(input.sessionID).length > 0 ||
      SecuritySessionState.goalOf(input.sessionID) !== undefined
    if (!hasContext) return false
    stats.considered += 1
    return true
  }

  /**
   * Which credential store a sensitive path belongs to, as the word a person would use: `aws`, `ssh`,
   * `kube`. Derived from the single dot-directory the path sits under, so it is a class and never a
   * location — `~/.aws/credentials` yields `aws` and nothing else.
   *
   * This is what makes "did the request mention what this action touches?" answerable. Without it the
   * only thing the layer knows about `~/.aws/config` is that its base name is `config`, and a request
   * saying "set up the AWS deployment" looks unrelated to it.
   */
  function storeOf(target: NormalizedPath): string | undefined {
    if (target.relation !== "home-sensitive") return undefined
    const segment = target.canonical.split("/").find((part) => part.startsWith(".") && part.length > 1)
    return segment ? segment.slice(1).toLowerCase() : undefined
  }

  /**
   * Redaction, applied at the point the data leaves.
   *
   * The excerpts are text the agent read, and text the agent read can contain a credential — not
   * because it went looking for one, but because a repository file had one in it. The model does not
   * need the value: the question is what the text *tells the agent to do*, and that survives having
   * the value replaced. The same goes for the request, which is the user's own words and can contain
   * a token they pasted.
   *
   * Done here rather than at the recording site because here is the only place the data crosses the
   * boundary, which makes the guarantee checkable in one test: put a synthetic credential in an
   * excerpt, and assert the provider never sees it.
   */
  export function redact(text: string): string {
    const found = SecretContent.classify(text)
    let out = text
    // Short matches are skipped: replacing a six-character string everywhere damages the text the
    // model has to read, and a secret that short is not one.
    for (const value of found.values) if (value.length >= 8) out = out.replaceAll(value, "[redacted]")
    return out
  }

  /**
   * Apply the redaction to an already-assembled input.
   *
   * Exported for the evaluation, which builds inputs by hand: a corpus scored on text the product
   * would never send is measuring a pipeline that does not exist. Some of its cases turn on a file
   * holding credentials, and in production the model sees the key names with the values replaced —
   * so that is what the evaluation must show it too.
   */
  export function redactInput(input: SemanticInput): SemanticInput {
    return {
      action: input.action,
      provenance: input.provenance.map(outbound),
      ...(input.goal ? { goal: redact(input.goal) } : {}),
    }
  }

  /**
   * One excerpt, prepared to leave: redacted, and carrying what the deterministic content classifier
   * made of it. Both halves have to happen here, in this order — the adjudication reads the original
   * text, and after redaction that text no longer exists.
   */
  function outbound(item: { source: string; name: string; excerpt: string }): Provenance {
    return {
      source: item.source,
      name: item.name,
      excerpt: redact(item.excerpt),
      adjudication: SecretContent.adjudicate(item.excerpt, { file: item.name }),
    }
  }

  /** Assemble what the model is shown. Structure and bounded excerpts; never a command line. */
  export function summarize(action: NormalizedAction, sessionID: string): SemanticInput | undefined {
    const readSecret = SecuritySessionState.hasSecretContext(sessionID)
    const provenance = SecuritySessionState.ingestedOf(sessionID).map(outbound)
    const recorded = SecuritySessionState.goalOf(sessionID)
    const goal = recorded === undefined ? undefined : redact(recorded)
    if (action.kind === "permission")
      return {
        action: { network: false, delegated: action.permission, readSecret, operands: [] },
        provenance,
        ...(goal ? { goal } : {}),
      }
    if (action.kind !== "shell") return undefined
    const process = action.command.commands.find((item) => item.network)
    if (!process) return undefined
    return {
      action: {
        ...(process.executable !== undefined ? { executable: process.executable } : {}),
        network: true,
        ...(process.effect !== undefined ? { effect: process.effect } : {}),
        readSecret,
        operands: process.operands.map((operand) => ({
          // Basename only: the directory carries the user's identity and none of the meaning.
          basename: operand.path.canonical.split("/").pop() ?? "",
          relation: operand.path.relation,
          labels: operand.path.labels,
          effect: operand.effect,
          ...(storeOf(operand.path) ? { store: storeOf(operand.path)! } : {}),
        })),
      },
      provenance,
      ...(goal ? { goal } : {}),
    }
  }

  /** The breaker is shared with the explanation path — see `ClassifierBreaker`. */
  const tripped = ClassifierBreaker.tripped

  /** Test seam: forget a tripped breaker. */
  export const resetBreaker = ClassifierBreaker.reset

  /**
   * Has the deterministic layer already answered the question this verdict asks?
   *
   * `DATA_EXFILTRATION` is a claim about one thing: whether the content going out is credential
   * material. `SecretContent` answers exactly that, on exactly those bytes, with named rules — and
   * where it has affirmatively explained every suspicious value in every excerpt, the model is not
   * contributing information, it is disagreeing with a rule. A disagreement is worth showing a
   * person; it is not grounds to stop an unattended run.
   *
   * Deliberately narrow. It needs *every* excerpt explained, so one unrecognised opaque value hands
   * full authority back — which is the case the layer was measured to be valuable in, and the case
   * both remaining content attacks fall into. The other categories are untouched: the content
   * classifier has no opinion about whether text instructs an agent, so it cannot settle
   * `PROMPT_INJECTION`, and a mismatch with the user's request is not a question about bytes.
   */
  export function settled(summary: SemanticInput, verdict: Verdict): boolean {
    if (verdict.category !== "DATA_EXFILTRATION") return false
    // A session that has already read credential material is not settled by what the excerpts hold:
    // the thing that might be leaving need not appear in any of them. In practice such a session is
    // stopped deterministically and never reaches this layer at all, so this closes a gap in the
    // argument rather than a gap in the behaviour — which is the right time to close one.
    if (summary.action.readSecret) return false
    if (summary.provenance.length === 0) return false
    return summary.provenance.every((item) => item.adjudication === "benign")
  }

  function evidenceFor(verdict: Verdict, hard: boolean, settledByRule = false): SecurityEvidence {
    return Decision.evidence({
      rule: hard ? "advisory.semantic.escalate" : "advisory.semantic.flag",
      // `hard` survives a permissive rule and stops an unattended run. Still an ASK either way: the
      // layer asks for a person, it does not decide for them.
      source: hard ? "hard" : "default",
      action: "ask",
      reasonCode: verdict.category === "USER_GOAL_MISMATCH" ? "UNCLASSIFIED_ACTION" : "NETWORK_EGRESS",
      message: "A semantic review flagged this outbound action for a person to confirm.",
      // The whole verdict, not the half of it that survived the policy: an audit trail that omits how
      // sure the model was cannot answer whether the escalations it got wrong were the hedged ones.
      attributes: {
        advisory: true,
        category: verdict.category,
        risk: verdict.risk,
        confidence: verdict.confidence,
        ...(settledByRule ? { settled: true } : {}),
      },
    })
  }

  /**
   * How much of a hedged verdict to act on.
   *
   * `conservative` (the default) acts only on a verdict the provider is willing to stand behind.
   * `balanced` also acts on a middling SUSPICIOUS, as a soft ask.
   *
   * This exists because the measurement said the threshold matters more than anything else about the
   * layer. On the held-out corpus the offline stand-in reaches 59% recall at 17% false escalation
   * under `balanced` and 3% at 0% under `conservative` — the signal is there, and a provider that
   * hedges on unfamiliar phrasing loses nearly all of it to the stricter rule. Which is right depends
   * on how well a given provider's confidence is calibrated, and that is a property of the provider,
   * not something this file can know. So it is a setting with a safe default, not a constant tuned
   * until a benchmark looked good.
   */
  export type Sensitivity = "conservative" | "balanced"

  function sensitivity(): Sensitivity {
    return process.env["KILO_SECURITY_AUTO_CLASSIFIER_SENSITIVITY"] === "balanced" ? "balanced" : "conservative"
  }

  /**
   * Turn a verdict into evidence, conservatively.
   *
   * The confidence label is the model's opinion of its own opinion, so it gates how far a verdict
   * carries and never stands alone: only `HIGH_RISK` reaches a hard ask, and only when the model is
   * not hedging. Everything softer contributes a soft ask, which changes what a person sees without
   * stopping an unattended run. `ORDINARY` — including `BENIGN_CONTEXT` — contributes nothing.
   *
   * No threshold on a self-reported number. Three labels, three coarse outcomes.
   */
  export function policy(
    verdict: Verdict,
    mode: Sensitivity = sensitivity(),
    /** True when a deterministic rule has already settled this verdict's question — see {@link settled}. */
    known = false,
  ): SecurityEvidence[] {
    // One place decides how far a verdict carries, so a bound on its authority cannot be added in
    // one branch and forgotten in another.
    const escalate = (hard: boolean) => [evidenceFor(verdict, hard && !known, hard && known)]
    if (verdict.risk === "SUSPICIOUS" && verdict.confidence === "MEDIUM" && mode === "balanced") return escalate(false)
    if (verdict.risk === "HIGH_RISK" && (verdict.confidence === "HIGH" || verdict.confidence === "MEDIUM"))
      return escalate(true)
    if (verdict.risk === "HIGH_RISK") return escalate(false)
    if (verdict.risk === "SUSPICIOUS" && verdict.confidence === "HIGH") return escalate(false)
    return []
  }

  /**
   * Run a provider call under a real deadline.
   *
   * The `AbortSignal` asks the provider to stop; this decides how long the *decision* waits, which is
   * not the same thing and the difference was measurable. Resolving a model goes through the provider
   * service, and an unauthenticated resolution spends about a second fetching a model catalogue —
   * work no abort signal interrupts. Awaiting it meant a layer that cannot relax a decision could
   * still change one through latency: with no model configured, one benchmark scenario ran past its
   * own timeout and succeeded.
   *
   * So the deadline stops the waiting, not the work. Whatever the provider is still doing settles
   * into a handler that discards it.
   */
  async function bounded<T>(call: () => Promise<T>, timeoutMs: number): Promise<Outcome<T>> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<Outcome<T>>((resolve) => {
      timer = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs)
    })
    // `call()` is inside the try: a provider that throws *synchronously* is a provider failure like
    // any other, and must land in `error` rather than reject this function. It is the same defect
    // that presentation had — a bad provider escaping as an Effect defect — and the same fix.
    const work = (async () => {
      try {
        return { kind: "ok" as const, value: await call() }
      } catch {
        return { kind: "error" as const }
      }
    })()
    try {
      return await Promise.race([work, deadline])
    } finally {
      clearTimeout(timer)
      // The loser of the race must not surface later as an unhandled rejection.
      void work.catch(() => undefined)
    }
  }

  type Outcome<T> = { kind: "ok"; value: T } | { kind: "timeout" } | { kind: "error" }

  /**
   * Ask the layer about one action. Yields evidence to fold, or nothing at all.
   *
   * Every failure path yields nothing: no provider, a timeout, a transport error, an answer outside
   * the vocabulary. "Nothing" means the deterministic decision stands exactly as it was — the same
   * behaviour as running with the layer switched off. That is the property the frozen guarantee rests
   * on: this layer can add friction, and its absence can never add risk.
   */
  export const assess = Effect.fn("SemanticEvidence.assess")(function* (input: {
    provider: ClassifierProvider | undefined
    summary: SemanticInput | undefined
    timeoutMs: number
  }) {
    if (!input.provider || !input.summary || tripped()) return [] as SecurityEvidence[]
    const { provider, summary, timeoutMs } = input
    const started = performance.now()
    const outcome = yield* Effect.promise(() => {
      // The signal still travels to the provider so a well-behaved one stops early; the race decides
      // how long this decision waits either way.
      const controller = new AbortController()
      setTimeout(() => controller.abort(), timeoutMs)
      return bounded(() => provider.classify(summary, controller.signal), timeoutMs)
    })
    stats.calls += 1
    stats.latencies.push(performance.now() - started)
    if (outcome.kind === "timeout") stats.timeouts += 1
    if (outcome.kind === "error") stats.errors += 1
    ClassifierBreaker.record(outcome.kind === "ok")
    if (outcome.kind !== "ok") return [] as SecurityEvidence[]
    const seen = `${outcome.value.risk}/${outcome.value.category}/${outcome.value.confidence}`
    stats.byVerdict[seen] = (stats.byVerdict[seen] ?? 0) + 1
    // A verdict about the user's intent requires knowing it. With no request recorded there is
    // nothing to compare against, and a model asked anyway will answer from the absence — which is
    // how "we do not know what you wanted" turns into friction on ordinary work. Measured: with the
    // request missing, one run flagged 37 of 39 decisions and cost 10 of 51 completed tasks. This is
    // a structural guard rather than a line in the prompt, because a line in the prompt is a request.
    if (outcome.value.category === "USER_GOAL_MISMATCH" && summary.goal === undefined) return [] as SecurityEvidence[]
    const evidence = policy(outcome.value, sensitivity(), settled(summary, outcome.value))
    if (evidence.length > 0) {
      stats.flagged += 1
      stats.byCategory[outcome.value.category] = (stats.byCategory[outcome.value.category] ?? 0) + 1
    }
    return evidence
  })
}
