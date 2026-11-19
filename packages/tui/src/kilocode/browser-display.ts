// What a browser tool row shows of the call's input. Typed text is masked: the row is drawn before the browser
// classifies the field (and never classified at all under `browser.allow_sensitive` or on the Playwright backend), so
// the TUI cannot tell a password from a search box and hides every typed value. The model's input is unchanged.
const MASK = "•••"

/** Field kinds whose value is a choice, not typed text. */
const CHOICES: Record<string, true> = { checkbox: true, radio: true, slider: true }

/**
 * The input as a row shows it. `tool` is the tool's own name (`browser_type`) or its Code Mode path (`browser.type`);
 * every other tool's input is returned as is.
 */
export function browserDisplayInput(tool: string, input: Record<string, unknown>): Record<string, unknown> {
  const name = tool.replace(/^browser\./, "browser_")
  if (name === "browser_type" && typeof input.text === "string") return { ...input, text: MASK }
  if (name !== "browser_fill_form" || !Array.isArray(input.fields)) return input
  return {
    ...input,
    fields: input.fields.map((field: unknown) =>
      typeof field === "object" && field !== null && "value" in field && !CHOICES[String(Reflect.get(field, "type"))]
        ? { ...field, value: MASK }
        : field,
    ),
  }
}

/** Code Mode's nested call rows, with each browser call's typed text masked. */
export function browserDisplayCalls<T extends { tool: string; input?: Record<string, unknown> }>(calls: T[]): T[] {
  return calls.map((call) => (call.input ? { ...call, input: browserDisplayInput(call.tool, call.input) } : call))
}
