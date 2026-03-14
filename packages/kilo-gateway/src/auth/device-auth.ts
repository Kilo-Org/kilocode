/**
 * LEGACY CLI VERSION - NOT CURRENTLY USED
 *
 * This file contains the original CLI-based device authorization flow using @clack/prompts.
 * It has been replaced by device-auth-tui.ts which provides a universal flow compatible
 * with both CLI and TUI contexts.
 *
 * Kept for reference and potential future use.
 */

import open from "open"
import { spinner } from "@clack/prompts"
import type { DeviceAuthPollResponse } from "../types.js"
import { poll, formatTimeRemaining } from "./polling.js"
import { getKiloProfile, getKiloDefaultModel, promptOrganizationSelection } from "../api/profile.js"
import { POLL_INTERVAL_MS } from "../api/constants.js"
import { initiateDeviceAuth, pollDeviceAuth } from "./device-auth-shared.js"

export interface DeviceAuthResult {
  token: string
  organizationId?: string
  model: string
}

/**
 * Execute the device authorization flow
 * @returns Authentication result with token, org ID, and model
 * @throws Error if authentication fails
 */
export async function authenticateWithDeviceAuth(): Promise<DeviceAuthResult> {
  console.log("\n🔐 Starting browser-based authentication...\n")

  // Step 1: Initiate device auth
  const s = spinner()
  s.start("Initiating device authorization")

  const authData = await initiateDeviceAuth()

  const { code, verificationUrl, expiresIn } = authData
  s.stop("Device authorization initiated")

  // Step 2: Display instructions and open browser
  console.log("\n📋 Verification Details:")
  console.log(`   URL: ${verificationUrl}`)
  console.log(`   Code: ${code}`)
  console.log(`   Expires: ${Math.floor(expiresIn / 60)}:${String(expiresIn % 60).padStart(2, "0")}\n`)

  console.log("Opening browser for authentication...")

  // Open browser
  await open(verificationUrl).catch((err) => {
    console.log("\n⚠️  Could not open browser automatically. Please open the URL manually.")
    console.error(err)
  })

  // Step 3: Poll for authorization
  const startTime = Date.now()
  const maxAttempts = Math.ceil((expiresIn * 1000) / POLL_INTERVAL_MS)

  s.start("Waiting for authorization")

  let token: string
  let userEmail: string

  const result = await poll<DeviceAuthPollResponse>({
    interval: POLL_INTERVAL_MS,
    maxAttempts,
    pollFn: async () => {
      const pollResult = await pollDeviceAuth(code)

      // Update progress display
      const timeRemaining = formatTimeRemaining(startTime, expiresIn)
      s.message(`Waiting for authorization (${timeRemaining} remaining)`)

      if (pollResult.status === "approved") {
        // Success!
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

      // Still pending, continue polling
      return {
        continue: true,
      }
    },
  })

  if (!result.token || !result.userEmail) {
    s.stop("Authentication failed")
    throw new Error("Invalid response from authorization server")
  }

  token = result.token
  userEmail = result.userEmail

  s.stop(`✓ Authenticated as ${userEmail}`)

  // Step 4: Fetch profile to get organizations
  s.start("Fetching profile")
  const profileData = await getKiloProfile(token)
  s.stop("Profile fetched")

  // Step 5: Prompt for organization selection
  let organizationId: string | undefined
  if (profileData.organizations && profileData.organizations.length > 0) {
    console.log() // Add spacing
    organizationId = await promptOrganizationSelection(profileData.organizations)
  }

  // Step 6: Fetch default model
  s.start("Fetching default model")
  const model = await getKiloDefaultModel(token, organizationId)
  s.stop(`Default model: ${model}`)

  // Step 7: Return auth result
  return {
    token,
    organizationId,
    model,
  }
}
