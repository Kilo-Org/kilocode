import type { McpOAuthConfig } from "../../mcp/oauth-provider"

export function clientMetadataUrl(config: McpOAuthConfig, redirect: string): string | undefined {
  // The hosted document describes a public client with this exact callback URI.
  if (config.clientId || config.clientSecret || redirect !== "http://127.0.0.1:19876/mcp/oauth/callback")
    return undefined
  return "https://kilo.ai/docs/oauth/kilo/client.json"
}
