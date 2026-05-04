// kilocode_change - new file
import type { Message } from "@kilocode/sdk/v2"

const fmt = new Intl.NumberFormat("en-US")

export function getUsage(msg: readonly Message[]) {
  return msg.reduce(
    (sum, item) => {
      if (item.role !== "assistant") return sum
      return {
        input: sum.input + item.tokens.input,
        output: sum.output + item.tokens.output,
        cached: sum.cached + item.tokens.cache.read,
      }
    },
    {
      input: 0,
      output: 0,
      cached: 0,
    },
  )
}

export function formatCount(input: number) {
  return fmt.format(input)
}
