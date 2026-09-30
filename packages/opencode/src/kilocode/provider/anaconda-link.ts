/**
 * Anaconda account linking orchestration.
 *
 * After a successful Kilo login, checks whether the user is already logged
 * into Anaconda. If not, links the accounts and saves the API key to the
 * shared anaconda-cli keyring (~/.anaconda/keyring).
 *
 * If the user IS already logged into Anaconda but with a different email
 * than their Kilo account, we track the mismatch via telemetry.
 *
 * This module lives in kilocode/ (Kilo-owned) so it can import both
 * kilo-gateway (for the anaconda functions) and kilo-telemetry (for tracking)
 * without affecting the shared upstream provider/auth.ts beyond a single
 * kilocode_change call site.
 */

import { checkAnacondaLogin, linkAnacondaAccount, getKiloProfile } from "@kilocode/kilo-gateway"
import { Telemetry } from "@kilocode/kilo-telemetry"

/**
 * Run the Anaconda link flow after a successful Kilo auth.
 *
 * Fetches the Kilo profile to get the user's email for mismatch detection.
 * The profile call is lightweight and the token is already validated at this point.
 *
 * @param kiloToken - The Kilo auth token
 */
export async function handleAnacondaLink(kiloToken: string): Promise<void> {
  const anacondaEmail = await checkAnacondaLogin().catch(() => null)

  if (anacondaEmail) {
    // User is already logged into Anaconda — check for email mismatch
    const profile = await getKiloProfile(kiloToken).catch(() => undefined)
    if (profile?.email && anacondaEmail !== profile.email) {
      Telemetry.trackAnacondaEmailMismatch()
    }
    return
  }

  // Not logged into Anaconda — create the link
  const linked = await linkAnacondaAccount(kiloToken)
  if (linked) {
    Telemetry.trackAnacondaLinkCreated()
  }
}
