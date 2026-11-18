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

/**
 * `experimental.image_generate` is an explicit opt-in: only `true` or the `{ model }` form enable it. An unset value
 * means off so the Kilo image models, and the upstream image tool they turn on, stay out of the context until the user
 * asks for them.
 */
export function imageGenerationEnabled(value: unknown): boolean {
  return value === true || (typeof value === "object" && value !== null)
}

/** The `experimental.image_generate` value its switch writes: `false` off, otherwise `true` or the configured model. */
export function imageGenerationSwitch(value: unknown, enabled: boolean): unknown {
  if (!enabled) return false
  return typeof value === "object" && value !== null ? value : true
}

/** The `experimental.image_generate` value a model pick writes; an empty object keeps the tool on with the model unset. */
export function imageGenerationModel(value: unknown, model: unknown): Record<string, unknown> {
  const current = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {}
  if (model === undefined) {
    const next = { ...current }
    delete next.model
    return next
  }
  return { ...current, model }
}
