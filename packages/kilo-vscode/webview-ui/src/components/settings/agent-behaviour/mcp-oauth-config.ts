// OAuth mode and field helpers for the MCP edit view. The v2 schema stores a remote server's OAuth client as
// `oauth` on the server: absent is automatic discovery, `false` disables OAuth, and an object is a pre-registered
// client using snake_case keys (`client_id`, `callback_port`, ...).

export type OauthMode = "automatic" | "disabled" | "custom"

export interface OauthFields {
  clientId: string
  clientSecret: string
  scope: string
  callbackPort: string
  redirectUri: string
}

/** The OAuth value written to a server: `false` disables OAuth, an object configures a client, `undefined` is automatic. */
export interface OauthValue {
  client_id?: string
  client_secret?: string
  scope?: string
  callback_port?: number
  redirect_uri?: string
}

export const EMPTY_OAUTH_FIELDS: OauthFields = {
  clientId: "",
  clientSecret: "",
  scope: "",
  callbackPort: "",
  redirectUri: "",
}

/** Derive the edit view's OAuth mode from a server's current `oauth` value. */
export function oauthMode(oauth: OauthValue | false | null | undefined): OauthMode {
  if (oauth == null) return "automatic"
  if (oauth === false) return "disabled"
  return "custom"
}

export function oauthFields(oauth: OauthValue | false | null | undefined): OauthFields {
  if (oauth == null || oauth === false) return EMPTY_OAUTH_FIELDS
  return {
    clientId: oauth.client_id ?? "",
    clientSecret: oauth.client_secret ?? "",
    scope: oauth.scope ?? "",
    callbackPort: oauth.callback_port ? String(oauth.callback_port) : "",
    redirectUri: oauth.redirect_uri ?? "",
  }
}

function trimmed(value: string): string | undefined {
  const next = value.trim()
  return next ? next : undefined
}

/**
 * Build the `oauth` value for a mode and field set.
 * - automatic: `undefined`, so the caller removes the key and discovery runs again.
 * - disabled: `false`.
 * - custom: an object with only the non-blank fields set.
 */
export function oauthPatch(mode: OauthMode, fields: OauthFields): OauthValue | false | undefined {
  if (mode === "automatic") return undefined
  if (mode === "disabled") return false
  const port = fields.callbackPort.trim()
  return {
    client_id: trimmed(fields.clientId),
    client_secret: trimmed(fields.clientSecret),
    scope: trimmed(fields.scope),
    callback_port: port ? Number(port) : undefined,
    redirect_uri: trimmed(fields.redirectUri),
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

/** Validate custom-client OAuth fields. Returns no errors for the automatic and disabled modes. */
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
