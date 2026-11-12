export * as KiloPagesRpc from "./pages.js"

import { Schema } from "effect"
import { optional } from "../schema.js"
import { Rpc } from "../rpc.js"

// The `kilocode.pages` RPC: whether Pages is on for a Location and whether it is connected. No method and no field
// carries a Pages token, a Kilo token or a header: the credential never leaves the server process.
const portable = Schema.toStandardSchemaV1

export const Destination = Schema.Literals(["pages", "pages-dev"]).annotate({ identifier: "KiloPages.Destination" })
export type Destination = typeof Destination.Type

export const Config = Schema.Struct({
  enabled: Schema.Boolean.pipe(optional).annotate({
    description: "Use Pages with the Kilo Gateway sign-in (default: off)",
  }),
  destination: Destination.pipe(optional).annotate({
    description:
      "Which Pages deployment to use: pages or pages-dev (default: pages). The KILO_PAGES_DESTINATION environment variable overrides it.",
  }),
}).annotate({ identifier: "KiloPagesConfig", description: "Pages configuration" })
export type Config = typeof Config.Type

export const State = Schema.Literals([
  "disabled", // not enabled, or denied by policy: no token is minted and there is no MCP server
  "starting", // the Gateway has not reported an account yet
  "signed_out", // enabled, no usable Kilo account
  "connecting",
  "connected",
  "retrying", // a temporary failure; the plugin tries again at retryAt
  "needs_login", // the Kilo sign-in was refused or has expired
  "unsupported", // this credential or Kilo server cannot get a Pages token
  "blocked", // Kilo or Pages refused this account
  "manual", // the user configured a `pages` MCP server; Kilo sign-in is not used for it
]).annotate({ identifier: "KiloPages.State" })
export type State = typeof State.Type

export const Reason = Schema.Literals([
  "user",
  "policy",
  "organization_credential",
  "credential_type",
  "kilo_disabled",
  "server",
  "pages_rejected",
]).annotate({ identifier: "KiloPages.Reason" })
export type Reason = typeof Reason.Type

export const Status = Schema.Struct({
  enabled: Schema.Boolean,
  state: State,
  reason: Schema.optional(Reason),
  /** Origin of the Pages deployment, for links to Pages. */
  origin: Schema.String,
  /** The MCP server name in `mcp.list`, to show tool status next to it. */
  server: Schema.String,
  /** Epoch milliseconds of the next attempt, with `retrying`. */
  retryAt: Schema.optional(Schema.Number),
  /** With `signed_out` and `needs_login`: the existing Gateway sign-in. Pages adds no login of its own. */
  signIn: Schema.optional(Schema.Struct({ integrationID: Schema.Literal("kilo"), methodID: Schema.String })),
}).annotate({ identifier: "KiloPages.Status" })
export interface Status extends Schema.Schema.Type<typeof Status> {}

export const Failure = Schema.Struct({ message: Schema.String }).annotate({ identifier: "KiloPages.Failure" })
export interface Failure extends Schema.Schema.Type<typeof Failure> {}

const method = {
  input: portable(Schema.Struct({})),
  output: portable(Status),
  errors: { failed: portable(Failure) },
}

export const Definition = Rpc.define({
  id: "kilocode.pages",
  methods: {
    /** Read the state. Never mints and never changes anything. */
    status: method,
    /** Turn Pages on in the global config, then connect. Refused while policy denies it. */
    enable: method,
    /** Turn Pages off in the global config, drop the cached token and remove the MCP server. */
    disable: method,
    /** Reconcile now and report the state. Never opens a sign-in. */
    ensureConnected: method,
  },
  events: {
    /** The status of the Location changed. */
    changed: { schema: portable(Status) },
  },
})
