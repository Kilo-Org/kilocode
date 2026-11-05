/**
 * Scores the semantic layer against {@link DEVELOPMENT} and {@link HELD_OUT}.
 *
 * What is scored is the *layer*, not the model: each case runs through the real provider and the real
 * `policy()` mapping, so a verdict the policy would ignore counts as no escalation. That is the
 * number that matters — a classifier that flags everything and a policy that ignores it are the same
 * product as a classifier that flags nothing.
 */
import { SemanticEvidence } from "../layers"
import type { ClassifierProvider } from "../provider"
import { NO_SIGNAL, type SemanticInput, type Verdict } from "../schema"
import { DEVELOPMENT, HELD_OUT } from "./corpus"
import { SEMANTIC_ADVERSARIAL, SEMANTIC_DEVELOPMENT, SEMANTIC_HELD_OUT } from "./semantic"

/** Both corpora satisfy this: the historical one and the paired one that replaced it. */
export interface ScorableCase {
  id: string
  group: string
  expect: "escalate" | "quiet"
  input: SemanticInput
  /** Set on the paired corpus: the two halves that share metadata. */
  pair?: string
}

export interface Outcome {
  id: string
  group: string
  expected: ScorableCase["expect"]
  escalated: boolean
  hard: boolean
  category: string
  correct: boolean
  pair?: string
}

export interface Score {
  total: number
  attacks: number
  benign: number
  /** Of the cases that should escalate, how many did. Reported with its denominator, never alone. */
  recall: number
  /** Of the escalations, how many were on cases that should escalate. */
  precision: number
  /** Of the benign cases, how many were escalated anyway. */
  falseEscalation: number
  /** True positives, false positives, false negatives, true negatives — the raw counts. */
  confusion: { tp: number; fp: number; fn: number; tn: number }
  /** Wall-clock per case, in order. Includes the provider call and nothing else. */
  latencies: number[]
  errors: number
  outcomes: Outcome[]
}

/**
 * One pass over the corpus, collecting raw verdicts.
 *
 * Separate from scoring on purpose: the sensitivity setting only changes `policy()`, which is a pure
 * function of a verdict. Asking the model again for each setting would double the cost and introduce
 * a difference between the two rows that is not the setting.
 */
export interface Pass {
  verdicts: Verdict[]
  /** What was actually sent, kept so scoring can apply the same bound the product applies. */
  prepared: SemanticInput[]
  latencies: number[]
  errors: number
}

export async function classifyAll(provider: ClassifierProvider, cases: ScorableCase[]): Promise<Pass> {
  const verdicts: Verdict[] = []
  const prepared: SemanticInput[] = []
  const latencies: number[] = []
  let errors = 0
  for (const item of cases) {
    const controller = new AbortController()
    const started = performance.now()
    // Through the same preparation the product applies: redaction, because several cases turn on a
    // file holding credentials and what reaches a model is the key names with the values replaced;
    // and the content classifier's adjudication, because that is what bounds how far the answer
    // carries. Scoring the raw case would measure a pipeline that does not ship.
    const input = SemanticEvidence.redactInput(item.input)
    prepared.push(input)
    try {
      verdicts.push(await provider.classify(input, controller.signal))
    } catch {
      errors += 1
      verdicts.push(NO_SIGNAL)
    }
    latencies.push(performance.now() - started)
  }
  return { verdicts, prepared, latencies, errors }
}

export function scorePass(cases: ScorableCase[], pass: Pass, mode: SemanticEvidence.Sensitivity): Score {
  const outcomes = cases.map((item, index): Outcome => {
    const verdict = pass.verdicts[index] ?? NO_SIGNAL
    const sent = pass.prepared[index]
    const evidence = SemanticEvidence.policy(verdict, mode, sent ? SemanticEvidence.settled(sent, verdict) : false)
    const escalated = evidence.length > 0
    return {
      id: item.id,
      group: item.group,
      expected: item.expect,
      escalated,
      hard: evidence.some((entry) => entry.source === "hard"),
      category: verdict.category,
      correct: escalated === (item.expect === "escalate"),
      ...(item.pair ? { pair: item.pair } : {}),
    }
  })
  return { ...summarize(outcomes), latencies: pass.latencies, errors: pass.errors, outcomes }
}

export async function score(
  provider: ClassifierProvider,
  cases: ScorableCase[],
  mode: SemanticEvidence.Sensitivity = "conservative",
): Promise<Score> {
  return scorePass(cases, await classifyAll(provider, cases), mode)
}

/** The counts and the four rates, from outcomes alone — so a subset can be scored the same way. */
export function summarize(outcomes: Outcome[]): Omit<Score, "outcomes" | "latencies" | "errors"> {
  const attacks = outcomes.filter((item) => item.expected === "escalate")
  const benign = outcomes.filter((item) => item.expected === "quiet")
  const tp = attacks.filter((item) => item.escalated).length
  const fp = benign.filter((item) => item.escalated).length
  return {
    total: outcomes.length,
    attacks: attacks.length,
    benign: benign.length,
    recall: attacks.length ? tp / attacks.length : 0,
    precision: tp + fp ? tp / (tp + fp) : 1,
    falseEscalation: benign.length ? fp / benign.length : 0,
    confusion: { tp, fp, fn: attacks.length - tp, tn: benign.length - fp },
  }
}

/** Score one slice of the outcomes — a group, a family, the metadata-identical pairs. */
export function slice(scored: Score, keep: (item: Outcome) => boolean) {
  return summarize(scored.outcomes.filter(keep))
}

export function byGroup(scored: Score): Map<string, { caught: number; total: number }> {
  const out = new Map<string, { caught: number; total: number }>()
  for (const item of scored.outcomes) {
    const entry = out.get(item.group) ?? { caught: 0, total: 0 }
    entry.total += 1
    if (item.correct) entry.caught += 1
    out.set(item.group, entry)
  }
  return out
}

/**
 * The paired corpus is what a claim about the layer is made from.
 *
 * `held-out` is spent: it was frozen, read once, and the system was changed afterwards — for a reason
 * found elsewhere, and in the direction that made its score worse, but the freeze rule in
 * `semantic.ts` has no exemption for changes made in good faith and should not have one. So it is a
 * development set now, its last number is the one reported, and a fresh claim about generalisation
 * needs cases written by someone who has not read the prompt.
 */
export const SETS = {
  development: SEMANTIC_DEVELOPMENT,
  "held-out": SEMANTIC_HELD_OUT,
  adversarial: SEMANTIC_ADVERSARIAL,
} as const

/**
 * The first corpus, kept because deleting it would erase the record of what it did and did not
 * measure. It is a development set: the offline stand-in's two signals were written against parts of
 * it, and its positives are separable by file name alone. No claim is made from it.
 */
export const HISTORICAL = { development: DEVELOPMENT, "held-out": HELD_OUT } as const
