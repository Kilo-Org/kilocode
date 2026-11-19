// A step token the browser issued for an action that already ran (a download it stopped) is usable on the next
// identical call only. The tool layer remembers it once the user grants, and the backend hands it to the extension
// when the model repeats the same step; nothing ever re-runs an action by itself.
const STEPS = new Map<string, { token: string; expires: number }>()

/** The extension's own lifetime for a step token. */
const TTL = 60_000

/** Steps remembered at once; the oldest is dropped so a long session cannot grow the map. */
const LIMIT = 500

function key(session: string, tool: string, args: Record<string, unknown>) {
  return `${session}\u0000${tool}\u0000${JSON.stringify(args)}`
}

/** Remember a token for exactly this session, tool and arguments, until it is taken or it expires. */
export function rememberStep(
  session: string,
  tool: string,
  args: Record<string, unknown>,
  token: string,
  ttl = TTL,
) {
  while (STEPS.size >= LIMIT) {
    const oldest = STEPS.keys().next().value
    if (oldest === undefined) break
    STEPS.delete(oldest)
  }
  STEPS.set(key(session, tool, args), { token, expires: Date.now() + ttl })
}

/** Take the token for this step: one use, and an expired token is gone rather than spent later. */
export function takeStep(session: string, tool: string, args: Record<string, unknown>): string | undefined {
  const name = key(session, tool, args)
  const step = STEPS.get(name)
  if (step === undefined) return undefined
  STEPS.delete(name)
  return step.expires > Date.now() ? step.token : undefined
}

/** Clear every remembered step. The test seam for this module-level store. */
export function resetSteps() {
  STEPS.clear()
}
