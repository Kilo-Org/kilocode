/**
 * Profile handler, extracted from KiloProvider. No vscode dependency.
 *
 * Login, logout and organization switching are not available with the Kilo v2 server yet: the `kilocode.gateway`
 * RPC reads the profile but has no device auth or organization write method.
 */
import type { KiloClient } from "@kilocode/sdk-v1/v2/client"

export interface AuthContext {
  readonly client: KiloClient | null
  postMessage(msg: unknown): void
}

/** Re-fetch the profile and push it to the webview. */
export async function handleRefreshProfile(ctx: AuthContext): Promise<void> {
  if (!ctx.client) return

  console.log("[Kilo New] KiloProvider: 🔄 Refreshing profile...")
  const result = await ctx.client.kilo.profile().catch(() => ({ data: null }))
  ctx.postMessage({ type: "profileData", data: result.data ?? null })
}
