import type { QuestionOption } from "../../types/messages"

/**
 * Translate a backend-provided i18n key, falling back to the canonical label when no key is
 * set or the key is missing from the dictionary.
 *
 * Implementation detail: our `language.t` (see webview-ui/src/context/language.tsx) returns
 * the key string back when a translation is missing. We detect that "echo" and substitute
 * the fallback. If `language.t` ever changes to return `undefined` / empty / throw on miss,
 * this helper's fallback branch must be updated to match.
 *
 * Edge case: if a translator ever writes a value identical to the dotted key string, this
 * helper would falsely fall back to the English label. Namespaced keys (`plan.followup.*`)
 * make this practically impossible, but keep it in mind before picking ambiguous key names.
 */
export function tr(translate: (key: string) => string, key: string | undefined, fallback: string): string {
  if (!key) return fallback
  const result = translate(key)
  if (result === key) return fallback
  return result
}

export type PickOutcome = { kind: "submit" } | { kind: "advance" } | { kind: "stay" }

/**
 * Decide what should happen after a user picks an option in the question dock.
 *
 * - Multi-select prompts: the pick only toggles local state; no tab change, no submit.
 * - Single-question single-select prompts: keep the pick local and wait for explicit Submit.
 * - Multi-question single-select, option pick: advance to the next tab.
 * - Custom-input path for a single-select is handled separately in handleCustomSubmit.
 */
export function pickOutcome(input: { single: boolean; multi: boolean; custom: boolean }): PickOutcome {
  if (input.multi) return { kind: "stay" }
  if (input.single) return { kind: "stay" }
  return { kind: "advance" }
}

export function toggleAnswer(existing: string[], answer: string): string[] {
  const next = [...existing]
  const index = next.indexOf(answer)
  if (index === -1) next.push(answer)
  if (index !== -1) next.splice(index, 1)
  return next
}

export function resolveQuestionMode(options: QuestionOption[], answer: string): string | undefined {
  return options.find((item) => item.label === answer)?.mode
}

export function resolveSelectedQuestionMode(
  questions: Array<{ options?: QuestionOption[] }>,
  answers: string[][],
  kinds: Record<string, "option" | "custom">[] = [],
): string | undefined {
  let mode: string | undefined

  for (const [i, list] of answers.entries()) {
    const options = questions[i]?.options ?? []
    for (const answer of list) {
      if (kinds[i]?.[answer] === "custom") continue
      const next = resolveQuestionMode(options, answer)
      if (next) mode = next
    }
  }

  return mode
}

export function resolveOptimisticQuestionAgent(base: string | undefined, current: string, mode: string | undefined) {
  if (!mode) {
    return {
      base: undefined,
      agent: base,
    }
  }

  if (base === undefined && current === mode) {
    return {
      base: undefined,
      agent: undefined,
    }
  }

  return {
    base: base ?? current,
    agent: mode,
  }
}
