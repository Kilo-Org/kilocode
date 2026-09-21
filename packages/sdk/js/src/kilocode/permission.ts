import type { KiloClient } from "../v2/client.js"

type Decision = {
  requestID: string
  directory: string
  reply: "once" | "always" | "reject"
  approvedAlways: string[]
  deniedAlways: string[]
  message?: string
}

const ATTEMPTS = 3

// Keep in sync with the transient classifier in packages/core/src/util/retry.ts
// (mirrored in packages/kilo-vscode/src/services/cli-backend/retry.ts). Only
// transport-level failures are retried. A status-less client error such as a
// response parse failure or a server-version mismatch is definitive and must not
// be replayed. Re-sending an identical rule set after a lost response is
// tolerable because duplicate patterns do not change the decision.
const TRANSIENT = [
  "load failed",
  "network connection was lost",
  "network request failed",
  "failed to fetch",
  "fetch failed",
  "econnreset",
  "econnrefused",
  "etimedout",
  "socket hang up",
]

const TRANSIENT_EXACT = ["terminated"]

function transport(error: unknown): boolean {
  if (!error) return false
  const message = String(error instanceof Error ? error.message : error)
    .toLowerCase()
    .trim()
  if (TRANSIENT_EXACT.includes(message)) return true
  return TRANSIENT.some((entry) => message.includes(entry))
}

async function send<T>(fn: () => Promise<T>, budget: () => number): Promise<T> {
  let last: unknown
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    try {
      return await fn()
    } catch (error) {
      last = error
      if (attempt === ATTEMPTS - 1 || !transport(error) || budget() <= 0) throw error
      await new Promise((resolve) => setTimeout(resolve, Math.min(100 * 2 ** attempt, budget())))
    }
  }
  throw last
}

/**
 * Send a permission decision with one bounded wait across both requests.
 * A timeout aborts only the client wait, so callers must reconcile an aborted
 * rule save because the server may still persist the rules.
 * Rules are saved first so a failed save never continues to the reply.
 */
export async function respondToPermission(
  client: KiloClient,
  input: Decision,
  timeout = 15_000,
): Promise<{ error?: unknown; saved?: boolean }> {
  const deadline = Date.now() + timeout
  const budget = () => Math.max(0, deadline - Date.now())
  const saved = input.approvedAlways.length > 0 || input.deniedAlways.length > 0
  try {
    if (saved) {
      await send(
        () =>
          client.permission.saveAlwaysRules(
            {
              requestID: input.requestID,
              directory: input.directory,
              approvedAlways: input.approvedAlways,
              deniedAlways: input.deniedAlways,
            },
            { throwOnError: true, signal: AbortSignal.timeout(budget()) },
          ),
        budget,
      )
    }
    await send(
      () =>
        client.permission.reply(
          {
            requestID: input.requestID,
            directory: input.directory,
            reply: input.reply,
            interactive: true,
            ...(input.message ? { message: input.message } : {}),
          },
          { throwOnError: true, signal: AbortSignal.timeout(budget()) },
        ),
      budget,
    )
    return { saved }
  } catch (error) {
    return { error, saved }
  }
}

/**
 * An aborted rule save can still complete on the server. A request that is no
 * longer pending was applied, so the caller must not offer a retry that could
 * persist a conflicting rule. Returns false when the outcome stays unknown.
 */
export async function permissionSettled(
  client: KiloClient,
  directory: string,
  requestID: string,
  timeout = 5_000,
): Promise<boolean> {
  const { data, error } = await client.permission.list(
    { directory },
    { signal: AbortSignal.timeout(timeout) },
  )
  if (error || !data) return false
  return !data.some((permission) => permission.id === requestID)
}
