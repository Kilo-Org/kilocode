export * as KiloMcpGuardrailsRpc from "./mcp-guardrails.js"

import { Schema } from "effect"
import { Rpc } from "../rpc.js"
import { optional } from "../schema.js"

// The `kilocode.mcp-guardrails` RPC contract. The MCP guardrails plugin in packages/kilo-plugin registers it;
// other Kilo plugins (the marketplace) and clients import this contract from `@opencode/schema/kilocode/mcp-guardrails`.
const portable = Schema.toStandardSchemaV1

/** The parts of an MCP server config that decide whether the organization allows it. */
export const Server = Schema.Union([
  Schema.Struct({ type: Schema.Literal("remote"), url: Schema.String }),
  Schema.Struct({ type: Schema.Literal("local"), command: Schema.Array(Schema.String) }),
])
export type Server = typeof Server.Type

export const Enforcement = Schema.Literals(["off", "shadow", "enforce"])
export type Enforcement = typeof Enforcement.Type

export const Reason = Schema.Literals(["not_allowed", "below_min_version", "unsupported_target"])
export type Reason = typeof Reason.Type

export const Verdict = Schema.Struct({
  decision: Schema.Literals(["allowed", "denied"]),
  reason: optional(Reason),
})
export type Verdict = typeof Verdict.Type

export const Definition = Rpc.define({
  id: "kilocode.mcp-guardrails",
  methods: {
    /** Decides servers against the active organization's allow list. Everything is allowed while no policy applies. */
    evaluate: {
      input: portable(Schema.Struct({ servers: Schema.Array(Server) })),
      output: portable(Schema.Struct({ enforcement: Enforcement, results: Schema.Array(Verdict) })),
    },
  },
  events: {},
})
