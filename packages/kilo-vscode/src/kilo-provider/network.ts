/**
 * Handles session.network.* SSE events for the VS Code extension.
 *
 * When the CLI backend detects a network failure (timeout, DNS, connection refused, etc.)
 * it pauses the session and emits session.network.asked. A background DNS probe polls for
 * recovery and emits session.network.restored when connectivity returns. The TUI asks the
 * user to press Enter; `kilo run` auto-retries with backoff. This module implements auto-reply
 * for the VS Code extension: once restored, it immediately calls network.reply() so the
 * session resumes without user intervention.
 */

import type { KiloClient } from "@kilocode/sdk/v2/client"

/** Pending network-offline requests: requestID -> sessionID. */
const waits = new Map<string, string>()

type Props = { id?: string; sessionID?: string; requestID?: string }
type GetDir = (sessionID: string) => string

/**
 * Process a session.network.* event. Call from handleEvent() with the event
 * type cast to `string` and properties cast to `Props` (these event types
 * are not yet in the SDK Event union, pending SDK regeneration).
 */
export function handleNetworkEvent(type: string, props: Props, client: KiloClient | null, dir: GetDir) {
  if (type === "session.network.asked" && props.id && props.sessionID) {
    waits.set(props.id, props.sessionID)
    return
  }
  if (type === "session.network.restored" && props.requestID) {
    const sid = waits.get(props.requestID)
    if (!sid) return
    console.log("[Kilo New] network: auto-replying to restore", props.requestID)
    void (client as any)?.network?.reply({ requestID: props.requestID, directory: dir(sid) })
    waits.delete(props.requestID)
    return
  }
  if ((type === "session.network.replied" || type === "session.network.rejected") && props.requestID) {
    waits.delete(props.requestID)
  }
}

/** Clear all tracked network waits (call on dispose). */
export function clearNetworkWaits() {
  waits.clear()
}
