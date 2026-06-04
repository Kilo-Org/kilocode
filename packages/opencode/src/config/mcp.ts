import { Schema, SchemaGetter } from "effect" // kilocode_change
import { zod } from "@opencode-ai/core/effect-zod"
import { PositiveInt, withStatics } from "@opencode-ai/core/schema"

const LocalCanonical = Schema.Struct({
  // kilocode_change
  type: Schema.Literal("local").annotate({ description: "Type of MCP server connection" }),
  command: Schema.mutable(Schema.Array(Schema.String)).annotate({
    description: "Command and arguments to run the MCP server",
  }),
  environment: Schema.optional(Schema.Record(Schema.String, Schema.String)).annotate({
    description: "Environment variables to set when running the MCP server",
  }),
  enabled: Schema.optional(Schema.Boolean).annotate({
    description: "Enable or disable the MCP server on startup",
  }),
  timeout: Schema.optional(PositiveInt).annotate({
    description: "Timeout in ms for MCP server requests. Defaults to 5000 (5 seconds) if not specified.",
  }),
})

// kilocode_change start - accept `env` as an alias for `environment`
// The input schema admits either key and the transform normalises to the
// canonical `environment` field before validation downstream.
const LocalInput = Schema.Struct({
  type: Schema.Literal("local"),
  command: Schema.mutable(Schema.Array(Schema.String)),
  environment: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  env: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  enabled: Schema.optional(Schema.Boolean),
  timeout: Schema.optional(PositiveInt),
})

const normalizeLocal = (input: Schema.Schema.Type<typeof LocalInput>): Schema.Schema.Type<typeof LocalCanonical> => {
  const env = input.environment ?? input.env
  return {
    type: input.type,
    command: input.command,
    ...(env === undefined ? {} : { environment: env }),
    ...("enabled" in input ? { enabled: input.enabled } : {}),
    ...("timeout" in input ? { timeout: input.timeout } : {}),
  }
}

export const Local = LocalInput.pipe(
  Schema.decodeTo(LocalCanonical, {
    decode: SchemaGetter.transform(normalizeLocal),
    encode: SchemaGetter.passthrough({ strict: false }),
  }),
)
  .annotate({ identifier: "McpLocalConfig" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Local = Schema.Schema.Type<typeof Local>
// kilocode_change end

export const OAuth = Schema.Struct({
  clientId: Schema.optional(Schema.String).annotate({
    description: "OAuth client ID. If not provided, dynamic client registration (RFC 7591) will be attempted.",
  }),
  clientSecret: Schema.optional(Schema.String).annotate({
    description: "OAuth client secret (if required by the authorization server)",
  }),
  scope: Schema.optional(Schema.String).annotate({ description: "OAuth scopes to request during authorization" }),
  redirectUri: Schema.optional(Schema.String).annotate({
    description: "OAuth redirect URI (default: http://127.0.0.1:19876/mcp/oauth/callback).",
  }),
})
  .annotate({ identifier: "McpOAuthConfig" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type OAuth = Schema.Schema.Type<typeof OAuth>

export const Remote = Schema.Struct({
  type: Schema.Literal("remote").annotate({ description: "Type of MCP server connection" }),
  url: Schema.String.annotate({ description: "URL of the remote MCP server" }),
  enabled: Schema.optional(Schema.Boolean).annotate({
    description: "Enable or disable the MCP server on startup",
  }),
  headers: Schema.optional(Schema.Record(Schema.String, Schema.String)).annotate({
    description: "Headers to send with the request",
  }),
  oauth: Schema.optional(Schema.Union([OAuth, Schema.Literal(false)])).annotate({
    description: "OAuth authentication configuration for the MCP server. Set to false to disable OAuth auto-detection.",
  }),
  timeout: Schema.optional(PositiveInt).annotate({
    description: "Timeout in ms for MCP server requests. Defaults to 5000 (5 seconds) if not specified.",
  }),
})
  .annotate({ identifier: "McpRemoteConfig" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Remote = Schema.Schema.Type<typeof Remote>

export const Info = Schema.Union([Local, Remote])
  .annotate({ discriminator: "type" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Info = Schema.Schema.Type<typeof Info>

export * as ConfigMCP from "./mcp"
