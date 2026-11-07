/**
 * The Mistral chat API rejects tool call ids longer than nine characters, so the
 * provider transform truncates them. Truncating each id on its own makes ids that
 * only differ after the ninth character collapse onto the same value, and a request
 * carrying two tool calls with one id is rejected with
 * "Duplicate tool call id <id> in assistant message" (#15632).
 *
 * Keeping the truncated form but handing out a suffix when it is already taken keeps
 * every id in the request distinct, and the same original id keeps resolving to the
 * same value so tool calls and their results still line up.
 */
export function mistralToolIds(scrub: (id: string) => string) {
  const ids = new Map<string, string>()
  const used = new Set<string>()

  return (id: string) => {
    const hit = ids.get(id)
    if (hit != null) return hit

    const base = scrub(id)
    let next = base
    for (let n = 1; used.has(next); n++) next = base.slice(0, 9 - String(n).length) + String(n)

    used.add(next)
    ids.set(id, next)
    return next
  }
}
