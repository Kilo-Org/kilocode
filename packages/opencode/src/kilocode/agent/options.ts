// kilocode_change - new file

// Kilo stores internal/UI-only metadata on an agent's `options` record:
//   - `id`:          mode identifier used to recognize built-in modes (see session/prompt.ts)
//   - `displayName`: human-readable name for org/marketplace modes
//   - `source`:      origin marker ("organization" | "global" | "project")
//   - `reference`:   configured reference descriptor for Scout/reference agents (see agent/agent.ts)
//   - `resolved`:    resolved reference data for Scout/reference agents
//
// These are NOT provider request parameters. The agent `options` record is
// otherwise forwarded verbatim into providerOptions, so any of these keys that
// survive into the request body get rejected by strict providers
// (e.g. NVIDIA NIM: 400 "Unsupported parameter(s): displayName, id").
//
// We strip only this known denylist rather than allowlisting provider options,
// so genuine provider options an agent sets continue to pass through untouched.
export const INTERNAL_OPTION_KEYS = ["id", "displayName", "source", "reference", "resolved"] as const

const internal: ReadonlySet<string> = new Set(INTERNAL_OPTION_KEYS)

// Returns a shallow copy of `options` with Kilo-internal metadata keys removed.
// Used at the provider-request boundary so agent metadata never leaks into the
// request body. The original `options` object is left untouched.
export function stripInternalOptions(options: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {}
  for (const key in options) {
    if (internal.has(key)) continue
    result[key] = options[key]
  }
  return result
}
