import { Schema, SchemaGetter } from "effect"
import type { Match } from "@opencode-ai/schema/filesystem"

// ripgrep emits base64 `bytes` instead of `text` when the data is not valid UTF-8.
// Decode with lossy UTF-8 so valid multi-byte sequences survive intact and only
// truly undecodable bytes become U+FFFD. This avoids guessing the source encoding
// (which could misrepresent content to the LLM) and keeps valid portions readable.
//
// Caveat: submatch start/end are ripgrep byte offsets. On mixed-encoding lines
// (valid UTF-8 multi-byte sequences alongside invalid bytes), the decoded text has
// fewer characters than raw bytes, so the offsets no longer index into the decoded
// string. Nothing in-repo consumes these offsets for slicing today; if that changes,
// recompute them after decoding or drop them for bytes-decoded records.

/** ripgrep `arbitrary data` (`{text}` or `{bytes}`) normalized to `{text}`. */
export const Data = Schema.Union([
  Schema.Struct({ text: Schema.String }),
  Schema.Struct({ bytes: Schema.String }),
]).pipe(
  Schema.decodeTo(Schema.Struct({ text: Schema.String }), {
    decode: SchemaGetter.transform((data) =>
      "text" in data ? { text: data.text } : { text: Buffer.from(data.bytes, "base64").toString("utf8") },
    ),
    encode: SchemaGetter.passthrough({ strict: false }),
  }),
)

export interface Options {
  readonly context?: number
  readonly literal?: boolean
  readonly ignoreCase?: boolean
}

export type GrepMatch = Match & {
  readonly context: boolean
  readonly textTruncated: boolean
}

export const flags = (input: Options) => [
  ...(input.literal ? ["--fixed-strings"] : []),
  ...(input.ignoreCase ? ["--ignore-case"] : []),
  ...(input.context ? [`--context=${input.context}`] : []),
]

export const stop = (limit: number) => {
  let matches = 0
  return (row: { readonly context: boolean }) => !row.context && ++matches > limit
}

export const select = <
  A extends {
    readonly context: boolean
    readonly path: { readonly text: string }
    readonly line_number: number
  },
>(
  input: { readonly limit: number; readonly context?: number },
  items: readonly A[],
) => {
  let count = 0
  const overflow = items.findIndex((row) => !row.context && ++count > input.limit)
  const selected = items.slice(0, overflow === -1 ? items.length : overflow)
  const matches = selected.filter((row) => !row.context)
  return selected.filter(
    (row) =>
      !row.context ||
      matches.some(
        (match) =>
          match.path.text === row.path.text && Math.abs(match.line_number - row.line_number) <= (input.context ?? 0),
      ),
  )
}

export const decorate = (match: Match, context: boolean, textTruncated: boolean): GrepMatch =>
  Object.assign(match, { context, textTruncated })
