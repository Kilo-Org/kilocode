import type { KiloClient } from "@kilocode/sdk/v2/client"
import type { KiloProviderOptions } from "./options"

export type Surface = "sidebar" | "editor" | "agent-manager"

export function surface(opts: KiloProviderOptions): Surface {
  if (opts.platform === "agent-manager") return "agent-manager"
  if (opts.topBarSurface === "tab") return "editor"
  return "sidebar"
}

/**
 * Interrupt the active turn and run a queued message next, keeping the rest of
 * the queue. Resolves false when the message is no longer queued (it already
 * started, or was removed), which callers treat as a no-op.
 */
export async function sendQueuedNow(input: { client: KiloClient; sessionID: string; messageID: string; dir: string }) {
  const res = await input.client.session.abort(
    { sessionID: input.sessionID, directory: input.dir, promote: input.messageID },
    { throwOnError: true },
  )
  return res.data === true
}
