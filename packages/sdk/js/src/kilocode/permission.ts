import type { KiloClient } from "../v2/client.js"

type Decision = {
  requestID: string
  directory: string
  reply: "once" | "always" | "reject"
  approvedAlways: string[]
  deniedAlways: string[]
  message?: string
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
      await client.permission.saveAlwaysRules(
        {
          requestID: input.requestID,
          directory: input.directory,
          approvedAlways: input.approvedAlways,
          deniedAlways: input.deniedAlways,
        },
        { throwOnError: true, signal: AbortSignal.timeout(budget()) },
      )
    }
    await client.permission.reply(
      {
        requestID: input.requestID,
        directory: input.directory,
        reply: input.reply,
        interactive: true,
        ...(input.message ? { message: input.message } : {}),
      },
      { throwOnError: true, signal: AbortSignal.timeout(budget()) },
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
