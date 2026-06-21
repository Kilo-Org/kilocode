// kilocode_change - new file
import type { Message } from "@kilocode/sdk/v2"

const fmt = new Intl.NumberFormat("en-US")

export function getUsage(msg: readonly Message[]) {
  // kilocode_change start - track cache read and write separately (issue #11466)
  return msg.reduce(
    (sum, item) => {
      if (item.role !== "assistant") return sum
      return {
        input: sum.input + item.tokens.input,
        output: sum.output + item.tokens.output,
        cacheRead: sum.cacheRead + item.tokens.cache.read,
        cacheWrite: sum.cacheWrite + item.tokens.cache.write,
      }
    },
    {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
  )
  // kilocode_change end
}

export function formatCount(input: number) {
  return fmt.format(input)
}
