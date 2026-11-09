export * as KiloConfigExcess from "./excess.js"

import { ConfigNormalize } from "../../config/normalize.js"

/**
 * Report one diagnostic per top-level key the reader does not recognize, the reader half of v1's `Excess.keys`.
 *
 * The recognized set is `known` (the v2 schema, shared with the writer) plus every legacy name upstream
 * normalization still consumes. Rather than copy `normalize.ts`'s legacy-key list (it would go stale), each candidate
 * is probed through the normalizer itself: a key is recognized when normalizing a document that holds only that key
 * either draws a diagnostic for it or contributes a canonical field. An unknown key does neither. `skip` carries the
 * derived and already-refused names the reader ignores on purpose, so they are not reported twice. Top-level only.
 */
export function report(
  input: unknown,
  known: ReadonlySet<string>,
  skip: ReadonlySet<string>,
  report?: (diagnostic: ConfigNormalize.Diagnostic) => void,
) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return
  for (const key of Object.keys(input)) {
    if (known.has(key) || skip.has(key) || recognized(key)) continue
    report?.({ path: [key], kind: "unsupported", message: `ignored unrecognized key "${key}"` })
  }
}

/** A legacy name the normalizer consumes: it reacts to a lone probe value, an unrecognized key is inert. */
function recognized(key: string) {
  const probe = ConfigNormalize.normalize({ [key]: true })
  if (probe.type === "rejected") return true
  return probe.diagnostics.length > 0 || Object.keys(probe.encoded).length > 0
}
