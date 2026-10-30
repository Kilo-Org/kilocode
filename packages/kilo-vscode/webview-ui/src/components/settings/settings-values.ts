// Pure value helpers for the Web Tools and Experimental tabs, kept free of Solid and DOM imports so they are
// unit-testable.

/** The `websearch` selection a switch writes: `false` is off, the `random` pseudo-provider is on. */
export function webSearchSelection(enabled: boolean): false | { provider: "random" } {
  return enabled ? { provider: "random" } : false
}

/** A `websearch` selection is on for a provider selection and off for `false` or an unset value. */
export function webSearchEnabled(value: unknown): boolean {
  return Boolean(value)
}

/** A formatter/LSP switch keeps an existing per-item record when it is on, and writes `false` when it is off. */
export function keepRecord(current: unknown, enabled: boolean): unknown {
  if (!enabled) return false
  return typeof current === "object" && current !== null ? current : {}
}
