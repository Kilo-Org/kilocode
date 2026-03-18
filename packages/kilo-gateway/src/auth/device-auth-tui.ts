import open from "open"
import type { DeviceAuthPollResponse } from "../types.js"
import { poll } from "./polling.js"
import { getKiloDefaultModel } from "../api/profile.js"
import { POLL_INTERVAL_MS } from "../api/constants.js"
import type { AuthOuathResult } from "@kilocode/plugin"
import { initiateDeviceAuth, pollDeviceAuth } from "./device-auth-shared.js"

/**
 * TUI-compatible device authorization flow
 *
 * This version is designed to work with the TUI dialog system.
 * It completes the OAuth flow and returns credentials.
 * Organization selection is handled separately by the TUI layer using the profile data.
 */
export async function authenticateWithDeviceAuthTUI(inputs?: Record<string, string>): Promise<AuthOuathResult> {
  // Step 1: Initiate device auth
  const authData = await initiateDeviceAuth()
  const { code, verificationUrl, expiresIn } = authData

  // Step 2: Open browser
  await open(verificationUrl).catch(() => {
    // Silently fail if browser can't be opened - user can manually open URL
  })

  // Step 3: Return instructions and callback for TUI to handle
  return {
    url: verificationUrl,
    instructions: `Open ${verificationUrl} and enter code: ${code}`,
    method: "auto",
    async callback() {
      // Poll for authorization
      const maxAttempts = Math.ceil((expiresIn * 1000) / POLL_INTERVAL_MS)

      const result = await poll<DeviceAuthPollResponse>({
        interval: POLL_INTERVAL_MS,
        maxAttempts,
        pollFn: async () => {
          const pollResult = await pollDeviceAuth(code)

          if (pollResult.status === "approved") {
            return {
              continue: false,
              data: pollResult,
            }
          }

          if (pollResult.status === "denied") {
            return {
              continue: false,
              error: new Error("Authorization denied by user"),
            }
          }

          if (pollResult.status === "expired") {
            return {
              continue: false,
              error: new Error("Authorization code expired"),
            }
          }

          return {
            continue: true,
          }
        },
      })

      if (!result.token || !result.userEmail) {
        return { type: "failed" }
      }

      const token = result.token

      // For TUI version, complete with personal account by default
      // Organization selection is handled by TUI after this callback completes
      // The TUI will fetch the profile separately and show organization dialog if needed
      const organizationId = undefined

      // Fetch default model
      const model = await getKiloDefaultModel(token, organizationId)

      // Return success with OAuth credentials
      return {
        type: "success",
        provider: "kilo",
        refresh: token,
        access: token,
        expires: Date.now() + 365 * 24 * 60 * 60 * 1000, // 1 year
      }
    },
  }
}
