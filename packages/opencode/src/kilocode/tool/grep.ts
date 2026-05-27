import { Effect } from "effect"
import * as Truncate from "@/tool/truncate"

export namespace GrepBudget {
  export const MAX_LINE_LENGTH = 500
  export const DESCRIPTION = `- Matching source lines are previewed to ${MAX_LINE_LENGTH} characters; use Read at the reported file and line for full content.`

  export function notice(saved: boolean) {
    const prefix = `Some match lines truncated to ${MAX_LINE_LENGTH} chars.`
    const detail = saved ? " Saved grep output also contains shortened previews." : ""
    return `[${prefix}${detail} Use Read on the original file at the reported line to see full content.]`
  }

  export function line(text: string) {
    if (text.length <= MAX_LINE_LENGTH) return { text, truncated: false } as const
    return { text: `${text.slice(0, MAX_LINE_LENGTH)}... [truncated]`, truncated: true } as const
  }

  export const make = Effect.gen(function* () {
    const truncate = yield* Truncate.Service
    return Effect.fn("GrepBudget.output")(function* (text: string) {
      const max = Math.min((yield* truncate.limits()).maxBytes, Truncate.MAX_BYTES)
      return yield* truncate.output(text, { maxBytes: max })
    })
  })
}
