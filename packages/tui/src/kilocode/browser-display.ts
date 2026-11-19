// What a browser tool row shows of the call's input. Typed text is masked: the row is drawn before the browser
// classifies the field (and never classified at all under `browser.allow_sensitive` or on the Playwright backend), so
// the TUI cannot tell a password from a search box and hides every typed value. The model's input is unchanged.
import { Option, Schema } from "effect"
import { isRecord } from "../util/record"

const MASK = "•••"

/** Field kinds whose value is a choice, not typed text. */
const CHOICES: Record<string, true> = { checkbox: true, radio: true, slider: true }

const Field = Schema.StructWithRest(
  Schema.Struct({ type: Schema.optional(Schema.String), value: Schema.optional(Schema.Unknown) }),
  [Schema.Record(Schema.String, Schema.Unknown)],
)
const decodeFill = Schema.decodeUnknownOption(Schema.Struct({ fields: Schema.Array(Field) }))

function mask(input: Record<string, unknown>, key: string): Record<string, unknown> {
  return key in input ? { ...input, [key]: MASK } : input
}

/** `browser_drop` data is a map of MIME type to dropped text: the types stay, every value is masked. */
function maskDrop(input: Record<string, unknown>): Record<string, unknown> {
  if (!("data" in input)) return input
  const data = input.data
  return {
    ...input,
    data: isRecord(data) ? Object.fromEntries(Object.keys(data).map((type) => [type, MASK])) : MASK,
  }
}

function maskFill(input: Record<string, unknown>): Record<string, unknown> {
  if (!("fields" in input)) return input
  const parsed = decodeFill(input)
  if (Option.isNone(parsed)) return { ...input, fields: MASK }
  return {
    ...input,
    fields: parsed.value.fields.map((field) =>
      "value" in field && !CHOICES[field.type ?? ""] ? { ...field, value: MASK } : field,
    ),
  }
}

/**
 * The input as a row shows it. `tool` is the tool's own name (`browser_type`) or its Code Mode path (`browser.type`);
 * every other tool's input is returned as is. Input of an unexpected shape is masked whole, never shown raw.
 */
export function browserDisplayInput(tool: string, input: Record<string, unknown>): Record<string, unknown> {
  const name = tool.replace(/^browser\./, "browser_")
  if (name === "browser_type") return mask(input, "text")
  if (name === "browser_handle_dialog") return mask(input, "promptText")
  if (name === "browser_drop") return maskDrop(input)
  if (name === "browser_fill_form") return maskFill(input)
  return input
}

/** Code Mode's nested call rows, with each browser call's typed text masked. */
export function browserDisplayCalls<T extends { tool: string; input?: Record<string, unknown> }>(calls: T[]): T[] {
  return calls.map((call) => (call.input ? { ...call, input: browserDisplayInput(call.tool, call.input) } : call))
}
