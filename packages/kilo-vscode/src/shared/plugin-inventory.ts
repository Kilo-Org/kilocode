// The server answers `rpc.unavailable` for a Kilo RPC until the plugins of the request's Location are registered,
// which is also the answer of a server without that plugin. A Location lists no plugin while it activates and all of
// them once it has, so its plugin inventory tells the two answers apart.
import type { OpenCodeClient } from "@opencode/client"

// How often and how long to wait for the plugins of a cold Location. A local Location lists its plugins in well under
// a second; the limit only ends the wait on a server that never lists any.
const POLL = 100
const WAIT = 30_000

type Inventory = {
  api: OpenCodeClient
  /** The directory of the Location that answers the RPC. */
  directory: string
  /** Ends the wait when it turns false: the owner was disposed, the connection dropped or a newer read started. */
  active: () => boolean
}

/**
 * Resolves once the Location lists its plugins. A server without the inventory endpoint fails the read, which ends
 * the wait at once.
 */
export async function pluginsListed(input: Inventory) {
  const deadline = Date.now() + WAIT
  while (input.active() && Date.now() < deadline) {
    const listed = await input.api.plugin.list({ location: { directory: input.directory } }).then(
      (result) => result.data.length > 0,
      () => true,
    )
    if (listed) return
    await new Promise((resolve) => setTimeout(resolve, POLL))
  }
}

/**
 * A Kilo RPC read that a still activating Location cannot fail for good: an `rpc.unavailable` answer waits for the
 * plugins of the Location and reads once more, so only the second such answer means that the server has no such
 * plugin. A wait that `active` ended rejects with the first answer, and every other failure rejects unchanged.
 */
export function readListed<T>(input: Inventory & { read: () => Promise<T> }) {
  return input.read().catch(async (error: unknown) => {
    if (!error || typeof error !== "object" || !("type" in error) || error.type !== "rpc.unavailable") throw error
    await pluginsListed(input)
    if (!input.active()) throw error
    return input.read()
  })
}
