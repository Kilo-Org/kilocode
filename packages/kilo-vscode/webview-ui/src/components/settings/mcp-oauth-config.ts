import type { McpOAuthConfig } from "../../types/messages"

export type OauthMode = "automatic" | "disabled" | "custom"

/** Derive the McpEditView OAuth mode from a server's current `oauth` config. */
export function oauthMode(oauth: McpOAuthConfig | false | null | undefined): OauthMode {
  if (oauth == null) return "automatic"
  if (oauth === false) return "disabled"
  return "custom"
}

export interface OauthFields {
  clientId: string
  clientSecret: string
  scope: string
  callbackPort: string
  redirectUri: string
}

function trimmed(value: string): string | undefined {
  const next = value.trim()
  return next ? next : undefined
}

/**
 * Build the `oauth` patch value for a mode + field set.
 * - automatic: `null`, which `configUnsetPaths` turns into an explicit unset
 *   of the `oauth` key (so an existing custom client is actually removed,
 *   not merely left stale in the draft).
 * - disabled: `false`.
 * - custom: an object with only the non-blank fields set.
 */
export function oauthPatch(mode: OauthMode, fields: OauthFields): McpOAuthConfig | false | null {
  if (mode === "automatic") return null
  if (mode === "disabled") return false
  const port = fields.callbackPort.trim()
  return {
    clientId: trimmed(fields.clientId),
    clientSecret: trimmed(fields.clientSecret),
    scope: trimmed(fields.scope),
    callbackPort: port ? Number(port) : undefined,
    redirectUri: trimmed(fields.redirectUri),
  }
}

export interface OauthValidationErrors {
  callbackPort?: string
  secret?: string
  redirectUri?: string
  clientId?: string
}

function absoluteUri(value: string): boolean {
  try {
    const url = new URL(value)
    return Boolean(url.protocol)
  } catch {
    return false
  }
}

/**
 * Validate custom-client OAuth fields. Only runs for `custom` mode — the
 * other two modes have no fields to validate.
 */
export function validateOauth(mode: OauthMode, fields: OauthFields): OauthValidationErrors {
  if (mode !== "custom") return {}
  const errors: OauthValidationErrors = {}
  const port = fields.callbackPort.trim()
  if (port) {
    const parsed = Number(port)
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
      errors.callbackPort = "settings.agentBehaviour.editMcp.oauth.port.invalid"
    }
  }
  if (fields.clientSecret.trim() && !fields.clientId.trim()) {
    errors.secret = "settings.agentBehaviour.editMcp.oauth.secret.invalid"
  }
  const redirect = fields.redirectUri.trim()
  if (redirect && !absoluteUri(redirect)) {
    errors.redirectUri = "settings.agentBehaviour.editMcp.oauth.redirectUri.invalid"
  }
  return errors
}
