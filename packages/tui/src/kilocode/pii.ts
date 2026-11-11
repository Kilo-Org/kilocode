// Privacy mode for Kilo TUI code: the redaction markers and the one read of the `privacy_mode` config key, so every
// surface that hides account details or paths applies the same rule.
import type { LocationRef, OpenCodeClient } from "@opencode/client"
import { KiloPrivacyRpc } from "@opencode/schema/kilocode/privacy"

export const REDACTED_BALANCE = "•••"
export const REDACTED_PATH = "•••"

/**
 * Whether privacy mode is on for a location: any effective config document sets `privacy_mode: true`. A failed or
 * malformed answer counts as on, so a read error never reveals what privacy mode hides. Read it again after the
 * `config.updated` event to follow config edits.
 */
export function privacyMode(client: OpenCodeClient, location: LocationRef, signal?: AbortSignal) {
  return client
    .rpc(KiloPrivacyRpc.Definition)
    .get({}, { location: { directory: location.directory }, signal })
    .then((result) => result.enabled !== false)
    .catch(() => true)
}
