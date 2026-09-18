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
 * Send a permission decision with a bounded wait for each request.
 * A timeout aborts only the client wait, so the caller may retry the approval.
 * Rules are saved first so a failed save never continues to the reply.
 */
export async function respondToPermission(
  client: KiloClient,
  input: Decision,
  timeout = 15_000,
): Promise<{ error?: unknown }> {
  try {
    if (input.approvedAlways.length > 0 || input.deniedAlways.length > 0) {
      await client.permission.saveAlwaysRules(
        {
          requestID: input.requestID,
          directory: input.directory,
          approvedAlways: input.approvedAlways,
          deniedAlways: input.deniedAlways,
        },
        { throwOnError: true, signal: AbortSignal.timeout(timeout) },
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
      { throwOnError: true, signal: AbortSignal.timeout(timeout) },
    )
    return {}
  } catch (error) {
    return { error }
  }
}
