import { NonNegativeInt, PositiveInt } from "@opencode-ai/core/schema"
import { Schema } from "effect"

export const DEFAULT_LIMIT = 100

export const fields = {
  context: Schema.optional(NonNegativeInt).annotate({
    description: "Number of context lines to show before and after each match (default 0)",
  }),
  limit: Schema.optional(PositiveInt).annotate({
    description: "Maximum matching lines to return (default 100)",
  }),
  literal: Schema.optional(Schema.Boolean).annotate({
    description: "Treat pattern as plain text instead of a regex (default false)",
  }),
  ignoreCase: Schema.optional(Schema.Boolean).annotate({
    description: "Match without regard to letter case (default false)",
  }),
}

type Input = {
  readonly context?: number
  readonly limit?: number
  readonly literal?: boolean
  readonly ignoreCase?: boolean
}

export const metadata = (input: Input, limit: number, context: number) => ({
  context,
  limit,
  literal: input.literal,
  ignoreCase: input.ignoreCase,
})

export const options = (input: Input, limit: number, context: number) => ({
  limit,
  context,
  literal: input.literal,
  ignoreCase: input.ignoreCase,
})

export const describe = (description: string) => `${description}
- Searches file contents using regular expressions by default; use literal=true for plain-text patterns
- Use ignoreCase=true for case-insensitive matching, context=N for surrounding lines, and limit=N to bound matches (default 100)
- Context lines are explicitly labeled when requested`

export const line = (
  row: { readonly line: number; readonly text: string; readonly context: boolean },
  context: number,
) => {
  const label = context === 0 ? `Line ${row.line}` : `${row.context ? "[context]" : "[match]"} Line ${row.line}`
  return `  ${label}: ${row.text}`
}

export const limitNotice = (limit: number) =>
  `${limit} matches limit reached. Use limit=${Math.min(Number.MAX_SAFE_INTEGER, limit * 2)} for more, or refine pattern.`

export const notices = (rows: readonly { readonly textTruncated: boolean }[]) => {
  const output: string[] = []
  if (rows.some((row) => row.textTruncated)) {
    output.push("", "Some matching or context lines were truncated. Use read for full lines.")
  }
  return output
}
