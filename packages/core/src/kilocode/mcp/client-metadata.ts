// kilocode_change - new file
export * as McpClientMetadata from "./client-metadata.js"

import type { McpHost } from "../../mcp/host.js"
import { binding } from "./oauth-issuer.js"

const defaultPort = 19876
const defaultPath = "/mcp/oauth/callback"

/** Hosted Client ID Metadata Document: servers that support CIMD accept this URL as the `client_id`. */
export const clientMetadataUrl = "https://kilo.ai/docs/oauth/kilo/client.json"

/** The loopback callback the hosted document lists. */
export const callbackUrl = `http://127.0.0.1:${defaultPort}${defaultPath}`

/**
 * The redirect the attempt will actually use. A configured `callback_port` without a `redirect_uri` keeps
 * upstream's `/callback` path on that port, so it is deliberately not the hosted document's loopback.
 */
function loopback(config: McpHost.OAuthConfig | undefined): string | undefined {
  if (config?.redirect_uri) return config.redirect_uri
  if (config?.callback_port) return undefined
  return callbackUrl
}

/**
 * The hosted document describes a public client with the default loopback redirect, so it can only be offered
 * when the attempt configures no client of its own and redirects to that loopback.
 */
export function document(config: McpHost.OAuthConfig | undefined): string | undefined {
  if (config?.client_id || config?.client_secret) return undefined
  return loopback(config) === callbackUrl ? clientMetadataUrl : undefined
}

/**
 * The redirect a non-interactive registration must record. Only the hosted document's loopback is fixed, so only
 * that attempt pins it; everything else keeps upstream's placeholder and relies on a login-time registration.
 */
export function redirectUrl(config: McpHost.OAuthConfig | undefined): string | undefined {
  return document(config) ? callbackUrl : undefined
}

/**
 * The loopback the attempt must listen on, or undefined to keep the caller's own default chain. A configured
 * `redirect_uri` owns the port and path and wins over `callback_port`, as it did in v1. The fixed port is only
 * bound for the hosted document; anything else keeps an ephemeral port so parallel or repeated logins do not
 * contend for one port.
 */
export function callback(config: McpHost.OAuthConfig | undefined): { port: number; path: string } | undefined {
  if (config?.redirect_uri) {
    const url = new URL(config.redirect_uri)
    return {
      port: url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80,
      path: url.pathname || defaultPath,
    }
  }
  if (!document(config)) return undefined
  return { port: defaultPort, path: defaultPath }
}

export const oauth: McpHost.OAuth = {
  name: "Kilo",
  uri: "https://kilo.ai",
  document,
  callback,
  redirectUrl,
  binding,
}
