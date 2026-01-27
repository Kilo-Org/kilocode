import type { Plugin, AuthAccount } from "@opencode-ai/plugin"
import { KILO_API_BASE, TOKEN_EXPIRATION_MS, POLL_INTERVAL_MS } from "./constants.js"
import type { DeviceAuthInitiateResponse, DeviceAuthPollResponse } from "./types.js"

/**
 * Kilo Gateway Authentication Plugin
 *
 * Provides device authorization flow for Kilo Gateway
 * to integrate with OpenCode's auth system.
 */
export const KiloAuthPlugin: Plugin = async (ctx) => {
  return {
    auth: {
      provider: "kilo",
      async loader(getAuth, providerInfo) {
        // Get the stored auth
        const auth = await getAuth()
        if (!auth) return {}

        // For API auth, the key is the token directly
        if (auth.type === "api") {
          return {
            kilocodeToken: auth.key,
          }
        }

        // For OAuth auth, access token contains the Kilo token
        // The accountId field is in OpenCode's Auth type but not exposed to SDK
        // so we access it as a property on the auth object
        if (auth.type === "oauth") {
          const result: Record<string, string> = {
            kilocodeToken: auth.access,
          }
          // accountId is present in OpenCode's OAuth schema but not in SDK's
          const maybeAccountId = (auth as any).accountId
          if (maybeAccountId) {
            result.kilocodeOrganizationId = maybeAccountId
          }
          return result
        }

        return {}
      },
      methods: [
        {
          type: "oauth",
          label: "Kilo Gateway",
          async authorize() {
            // Step 1: Initiate device auth - this returns immediately
            const response = await fetch(`${KILO_API_BASE}/api/device-auth/codes`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
            })

            if (!response.ok) {
              if (response.status === 429) {
                throw new Error("Too many pending authorization requests. Please try again later.")
              }
              throw new Error(`Failed to initiate device authorization: ${response.status}`)
            }

            const authData = (await response.json()) as DeviceAuthInitiateResponse
            const { code, verificationUrl, expiresIn } = authData

            // Return authorization info for the TUI to display
            // The callback will be called to poll for completion
            return {
              url: verificationUrl,
              instructions: `Enter code: ${code}`,
              method: "auto" as const,
              async callback() {
                // Poll for authorization completion
                const maxAttempts = Math.ceil((expiresIn * 1000) / POLL_INTERVAL_MS)

                for (let attempt = 0; attempt < maxAttempts; attempt++) {
                  const pollResponse = await fetch(`${KILO_API_BASE}/api/device-auth/codes/${code}`)

                  if (pollResponse.status === 202) {
                    // Still pending, wait and continue
                    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
                    continue
                  }

                  if (pollResponse.status === 403) {
                    // Denied by user
                    return { type: "failed" as const }
                  }

                  if (pollResponse.status === 410) {
                    // Code expired
                    return { type: "failed" as const }
                  }

                  if (!pollResponse.ok) {
                    return { type: "failed" as const }
                  }

                  const pollData = (await pollResponse.json()) as DeviceAuthPollResponse

                  if (pollData.status === "approved" && pollData.token) {
                    // Build accounts from organizations in poll response
                    let accounts: AuthAccount[] | undefined
                    if (pollData.organizations && pollData.organizations.length > 0) {
                      accounts = [
                        { id: "", name: "Personal Account", hint: "Use your personal account" },
                        ...pollData.organizations.map((org) => ({
                          id: org.id,
                          name: org.name,
                          hint: "Organization",
                        })),
                      ]
                    }

                    // Success! Return the auth result
                    return {
                      type: "success" as const,
                      provider: "kilo",
                      refresh: pollData.token,
                      access: pollData.token,
                      expires: Date.now() + TOKEN_EXPIRATION_MS,
                      accounts,
                    }
                  }

                  if (pollData.status === "denied" || pollData.status === "expired") {
                    return { type: "failed" as const }
                  }

                  // Still pending, wait and continue
                  await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
                }

                // Timed out
                return { type: "failed" as const }
              },
            }
          },
        },
      ],
    },
  }
}

export default KiloAuthPlugin
