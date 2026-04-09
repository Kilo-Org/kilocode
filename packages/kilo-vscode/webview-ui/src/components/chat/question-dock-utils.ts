import type { QuestionOption } from "../../types/messages"

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
