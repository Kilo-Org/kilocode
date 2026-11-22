/**
 * Authentication handlers — extracted from KiloProvider.
 *
 * Manages login (device auth flow), logout, organization switching,
 * and profile refresh. No vscode dependency.
 */

import type { KiloClient } from "@kilocode/sdk/v2/client"
import { getErrorMessage } from "../../kilo-provider-utils"
import type { ProfileData } from "../../../webview-ui/src/types/messages/profile"

export interface AuthContext {
  readonly client: KiloClient | null
  postMessage(msg: unknown): void
  getWorkspaceDirectory(): string
  disposeGlobal(): Promise<void>
  invalidateProviderUsage(): void
  invalidateProviders(): void
  fetchAndSendProviders(): Promise<void>
  fetchAndSendAgents(): Promise<void>
  fetchAndSendSpeechToTextModels(): Promise<void>
}

/**
 * Handle login via the provider OAuth device-auth flow.
 * Sends device auth messages so the webview can display QR code, code, and timer.
 *
 * @param attempt - The current login attempt counter value (pre-incremented by caller).
 * @param getAttempt - Returns the latest attempt counter (may have changed if user cancelled).
 */
export async function handleLogin(ctx: AuthContext, attempt: number, getAttempt: () => number): Promise<void> {
  if (!ctx.client) return

  console.log("[Kilo New] KiloProvider: 🔐 Starting login flow...")

  try {
    const dir = ctx.getWorkspaceDirectory()

    // Step 1: Initiate OAuth authorization
    const { data: auth } = await ctx.client.provider.oauth.authorize(
      { providerID: "kilo", method: 0, directory: dir },
      { throwOnError: true },
    )
    console.log("[Kilo New] KiloProvider: 🔐 Got auth URL:", auth.url)

    // Parse code from instructions (format: "Open URL and enter code: ABCD-1234")
    const match = auth.instructions?.match(/code:\s*(\S+)/i)
    const code = match ? match[1] : undefined

    // Send device auth details to webview
    ctx.postMessage({
      type: "deviceAuthStarted",
      code,
      verificationUrl: auth.url,
      expiresIn: 900, // 15 minutes default
    })

    // Step 2: Wait for callback (blocks until polling completes)
    await ctx.client.provider.oauth.callback({ providerID: "kilo", method: 0, directory: dir }, { throwOnError: true })

    // Check if this attempt was cancelled
    if (attempt !== getAttempt()) return

    console.log("[Kilo New] KiloProvider: 🔐 Login successful")

    ctx.invalidateProviderUsage()
    ctx.invalidateProviders()
    await ctx.disposeGlobal()

    // Step 3: Fetch profile and push to webview
    const { data: profile } = await ctx.client.kilo.profile(undefined, { throwOnError: true })
    ctx.postMessage({ type: "profileData", data: profile })
    ctx.postMessage({ type: "deviceAuthComplete" })
  } catch (error) {
    if (attempt !== getAttempt()) return
    ctx.postMessage({
      type: "deviceAuthFailed",
      error: getErrorMessage(error) || "Login failed",
    })
  }
}

/** Handle logout: remove auth credentials and clear profile. */
export async function handleLogout(ctx: AuthContext): Promise<void> {
  if (!ctx.client) return

  try {
    console.log("[Kilo New] KiloProvider: 🚪 Logging out...")
    await ctx.client.auth.remove({ providerID: "kilo" }, { throwOnError: true })
    console.log("[Kilo New] KiloProvider: 🚪 Logged out successfully")
    ctx.postMessage({ type: "profileData", data: null })

    ctx.invalidateProviderUsage()
    ctx.invalidateProviders()
    await ctx.disposeGlobal()

    await ctx.fetchAndSendProviders()
  } catch (error) {
    console.error("[Kilo New] KiloProvider: ❌ Logout failed:", error)
    ctx.postMessage({
      type: "error",
      message: getErrorMessage(error) || "Failed to logout",
    })
  }
}

/** The non-empty `message` a nested object carries, or nothing. */
function nestedMessage(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || !("message" in value)) return undefined
  const message = value.message
  return typeof message === "string" && message.length > 0 ? message : undefined
}

/** Read a message out of one parsed response body, whatever shape the backend used. */
function bodyText(body: unknown): string | undefined {
  if (typeof body === "string") return body.length > 0 ? body : undefined
  if (!body || typeof body !== "object") return undefined

  if ("data" in body) {
    const data = nestedMessage(body.data)
    if (data) return data
  }
  if ("message" in body) {
    const message = nestedMessage(body)
    if (message) return message
  }
  if ("error" in body) {
    const nested = body.error
    if (typeof nested === "string") return nested.length > 0 ? nested : undefined
    return nestedMessage(nested)
  }
  return undefined
}

/**
 * Read the backend's own message out of the response body the SDK error
 * interceptor attached to a thrown error. Anything else — no body, an empty
 * body, or a shape that names no message — yields `undefined`, so the webview
 * falls back to its localized copy instead of showing transport prose.
 */
function backendText(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined
  const cause = error.cause
  if (!cause || typeof cause !== "object" || !("body" in cause)) return undefined
  return bodyText(cause.body)
}

/**
 * Handle organization switch.
 * Persists the selection, refreshes profile + providers since both change with
 * org context, and reports one correlated outcome for the request.
 */
export async function handleSetOrganization(
  ctx: AuthContext,
  organizationId: string | null,
  requestID: string,
): Promise<void> {
  if (!ctx.client) {
    // The client is gone, so there is no backend text to report. Leaving `error`
    // out lets the webview show its own localized failure copy.
    ctx.postMessage({
      type: "organizationSwitchResult",
      requestID,
      organizationId,
      ok: false,
      data: null,
    })
    return
  }

  console.log("[Kilo New] KiloProvider: Switching organization:", organizationId ?? "personal")

  let failed = false
  let failure: string | undefined
  try {
    await ctx.client.kilo.organization.set({ organizationId }, { throwOnError: true })
  } catch (error) {
    console.error("[Kilo New] KiloProvider: Failed to switch organization:", error)
    failed = true
    failure = backendText(error)
  }

  if (!failed) {
    ctx.invalidateProviderUsage()
    ctx.invalidateProviders()
    await ctx.disposeGlobal().catch((error) => {
      console.error("[Kilo New] KiloProvider: Failed to dispose global state after org switch:", error)
    })
  }

  // The profile read is the client's confirmation of the applied context, so a
  // failed read leaves the switch unconfirmed even when the write succeeded.
  let profile: ProfileData | null = null
  let readFailed = false
  let profileError: string | undefined
  try {
    const result = await ctx.client.kilo.profile(undefined, { throwOnError: true })
    profile = result.data ?? null
    ctx.postMessage({ type: "profileData", data: profile })
  } catch (error) {
    console.error("[Kilo New] KiloProvider: Failed to refresh profile after org switch:", error)
    readFailed = true
    profileError = backendText(error)
  }

  // Text travels in `error` only when the backend put it in the response body.
  // A transport description is not backend text, so a failure without one stays
  // message-free and the webview shows its localized copy.
  const message = failure ?? profileError
  ctx.postMessage({
    type: "organizationSwitchResult",
    requestID,
    organizationId,
    ok: !failed && !readFailed,
    data: profile,
    ...(message === undefined || message === "" ? {} : { error: message }),
  })

  if (failed) return

  try {
    await ctx.fetchAndSendProviders()
  } catch (error) {
    console.error("[Kilo New] KiloProvider: Failed to refresh providers after org switch:", error)
  }
  try {
    await ctx.fetchAndSendAgents()
  } catch (error) {
    console.error("[Kilo New] KiloProvider: Failed to refresh agents after org switch:", error)
  }
  try {
    await ctx.fetchAndSendSpeechToTextModels()
  } catch (error) {
    console.error("[Kilo New] KiloProvider: Failed to refresh speech-to-text models after org switch:", error)
  }
}

/** Handle profile refresh request. */
export async function handleRefreshProfile(ctx: AuthContext): Promise<void> {
  if (!ctx.client) return

  console.log("[Kilo New] KiloProvider: 🔄 Refreshing profile...")
  const result = await ctx.client.kilo.profile().catch(() => ({ data: null }))
  ctx.postMessage({ type: "profileData", data: result.data ?? null })
}
