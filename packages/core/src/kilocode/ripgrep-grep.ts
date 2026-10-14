import { Schema, SchemaGetter } from "effect"
import type { Match } from "@opencode-ai/schema/filesystem"

// ripgrep only emits base64 `bytes` when the data is not valid UTF-8. Decode it as
// Windows-1252 (the WHATWG mapping for ISO-8859-1), the common legacy source encoding.
// Every byte maps to one UTF-16 unit, so ripgrep's byte offsets stay aligned with the text.
// Tradeoff: ripgrep reports the whole line as bytes when any byte is invalid UTF-8, so a
// valid UTF-8 multi-byte sequence sharing a line with a stray Latin-1 byte decodes as
// mojibake (e.g. UTF-8 "ä" becomes "Ã¤"). This keeps offsets correct and only affects
// mixed-encoding lines; fully UTF-8 and fully Latin-1 lines are unaffected.
const legacy = new TextDecoder("windows-1252")

/** ripgrep `arbitrary data` (`{text}` or `{bytes}`) normalized to `{text}`. */
export const Data = Schema.Union([
  Schema.Struct({ text: Schema.String }),
  Schema.Struct({ bytes: Schema.String }),
]).pipe(
  Schema.decodeTo(Schema.Struct({ text: Schema.String }), {
    decode: SchemaGetter.transform((data) =>
      "text" in data ? { text: data.text } : { text: legacy.decode(Buffer.from(data.bytes, "base64")) },
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
