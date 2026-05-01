import { z } from "zod"

type Tokens = {
  input: number
  output: number
  reasoning?: number
}

export namespace KiloSessionMetrics {
  const Rate = z.object({
    prompt: z.number().positive().optional(),
    generation: z.number().positive().optional(),
    output: z.number().positive().optional(),
  })

  export const Info = z.object({
    duration: z.number().positive().optional(),
    rate: Rate,
  })
  export type Info = z.infer<typeof Info>

  const value = (input: unknown): number | undefined => {
    if (typeof input !== "number") return undefined
    if (!Number.isFinite(input)) return undefined
    if (input <= 0) return undefined
    return input
  }

  const path = (input: unknown, keys: string[]): unknown => {
    if (keys.length === 0) return input
    if (!input || typeof input !== "object") return undefined
    const [head, ...tail] = keys
    return path((input as Record<string, unknown>)[head], tail)
  }

  const first = (input: unknown, paths: string[][]) => {
    return paths.map((item) => value(path(input, item))).find((item) => item !== undefined)
  }

  export function create(input: {
    elapsed: number
    tokens: Tokens
    metadata?: unknown
  }): Info | undefined {
    const seconds = input.elapsed / 1000
    const output = value(
      seconds > 0 ? ((input.tokens.output ?? 0) + (input.tokens.reasoning ?? 0)) / seconds : undefined,
    )
    const prompt = first(input.metadata, [
      ["prompt_per_second"],
      ["promptPerSecond"],
      ["timings", "prompt_per_second"],
      ["timings", "promptPerSecond"],
      ["llama", "prompt_per_second"],
      ["llama", "promptPerSecond"],
      ["llama", "timings", "prompt_per_second"],
      ["llama", "timings", "promptPerSecond"],
    ])
    const generation = first(input.metadata, [
      ["predicted_per_second"],
      ["predictedPerSecond"],
      ["generation_per_second"],
      ["generationPerSecond"],
      ["timings", "predicted_per_second"],
      ["timings", "predictedPerSecond"],
      ["llama", "predicted_per_second"],
      ["llama", "predictedPerSecond"],
      ["llama", "timings", "predicted_per_second"],
      ["llama", "timings", "predictedPerSecond"],
    ])
    const rate = { prompt, generation, output }
    const parsed = Rate.safeParse(rate)
    if (!parsed.success) return undefined
    if (!parsed.data.prompt && !parsed.data.generation && !parsed.data.output) return undefined
    return { duration: value(input.elapsed), rate: parsed.data }
  }
}
