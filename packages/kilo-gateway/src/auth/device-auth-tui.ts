import { execFile } from "child_process"
import type { DeviceAuthInitiateResponse, DeviceAuthPollResponse } from "../types.js"
import { poll } from "./polling.js"
import { getKiloProfile, getKiloDefaultModel } from "../api/profile.js"
import { KILO_API_BASE, POLL_INTERVAL_MS } from "../api/constants.js"
import { httpError, networkError } from "./fetch-diag.js"
import type { AuthOuathResult } from "@kilocode/plugin"

/**
 * Initiate device authorization flow
 * @returns Device authorization details
 * @throws Error if initiation fails
 */
async function initiateDeviceAuth(): Promise<DeviceAuthInitiateResponse> {
  const url = `${KILO_API_BASE}/api/device-auth/codes`
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
  }).catch((err) => {
    throw networkError("Failed to initiate device authorization", url, err)
  })

  if (!response.ok) {
    throw await httpError("Failed to initiate device authorization", url, response)
  }

  const data = await response.json()
  return data as DeviceAuthInitiateResponse
}

/**
 * Poll for device authorization status
 * @param code The verification code
 * @returns Poll response with status and optional token
 * @throws Error if polling fails
 */
async function pollDeviceAuth(code: string): Promise<DeviceAuthPollResponse> {
  const url = `${KILO_API_BASE}/api/device-auth/codes/${code}`
  const response = await fetch(url).catch((err) => {
    throw networkError("Failed to poll device authorization", url, err)
  })

  if (response.status === 202) {
    return { status: "pending" }
  }

  if (response.status === 403) {
    return { status: "denied" }
  }

  if (response.status === 410) {
    return { status: "expired" }
  }

  if (!response.ok) {
    throw await httpError("Failed to poll device authorization", url, response)
  }

  const data = await response.json()
  return data as DeviceAuthPollResponse
}

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

  // Step 2: Open browser (windowsHide: true prevents cmd.exe flash on Windows)
  const [cmd, ...args] =
    process.platform === "darwin"
      ? ["open", verificationUrl]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", verificationUrl]
        : ["xdg-open", verificationUrl]
  execFile(cmd, args, { windowsHide: true })

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
