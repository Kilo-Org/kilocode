// A step token the browser issued for an action that already ran (a download it stopped) is usable on the next
// identical call only. The tool layer remembers it once the user grants, and the backend hands it to the extension
// when the model repeats the same step; nothing ever re-runs an action by itself.
const STEPS = new Map<string, { token: string; expires: number }>()

/** The extension's own lifetime for a step token. */
const TTL = 60_000

/** Steps remembered at once; the oldest is dropped so a long session cannot grow the map. */
const LIMIT = 500

/**
 * The extension's canonical hash of a call's arguments: object keys sorted, arrays in order, then FNV-1a kept in one
 * 32-bit lane and returned as `<hex>:<length>`. The token binds the model's exact arguments, so a retry with other
 * values needs a fresh approval. This is the extension's own `hashBrowserToolArguments`, ported verbatim.
 */
export function hashArguments(args: unknown): string {
  const canonical = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map((item) => canonical(item)).join(",")}]`
    if (typeof value !== "object" || value === null) return JSON.stringify(value) ?? "null"
    const record = value as Record<string, unknown>
    const keys = Object.keys(record).toSorted()
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`
  }
  const text = canonical(args)
  // 2_166_136_261 and 16_777_619 are the standard 0x811C9DC5 offset basis and 0x01000193 prime.
  let hash = 2_166_136_261
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.codePointAt(index) ?? 0
    hash = Math.imul(hash, 16_777_619) >>> 0
  }
  return `${hash.toString(16)}:${String(text.length)}`
}

function key(session: string, tool: string, hash: string) {
  return `${session}\u0000${tool}\u0000${hash}`
}

/** Remember a token for a step the causing call described, by the hash the browser bound it to. */
export function rememberHash(session: string, tool: string, hash: string, token: string, ttl = TTL) {
  while (STEPS.size >= LIMIT) {
    const oldest = STEPS.keys().next().value
    if (oldest === undefined) break
    STEPS.delete(oldest)
  }
  STEPS.set(key(session, tool, hash), { token, expires: Date.now() + ttl })
}

/** Remember a token for exactly this session, tool and arguments, until it is taken or it expires. */
export function rememberStep(
  session: string,
  tool: string,
  args: Record<string, unknown>,
  token: string,
  ttl = TTL,
) {
  rememberHash(session, tool, hashArguments(args), token, ttl)
}

/** Take the token for this step: one use, and an expired token is gone rather than spent later. */
export function takeStep(session: string, tool: string, args: Record<string, unknown>): string | undefined {
  return takeHash(session, tool, hashArguments(args))
}

/** Take the token a causing step was remembered under: one use, and an expired token is gone rather than spent. */
export function takeHash(session: string, tool: string, hash: string): string | undefined {
  const name = key(session, tool, hash)
  const step = STEPS.get(name)
  if (step === undefined) return undefined
  STEPS.delete(name)
  return step.expires > Date.now() ? step.token : undefined
}

/** Clear every remembered step. The test seam for this module-level store. */
export function resetSteps() {
  STEPS.clear()
}
