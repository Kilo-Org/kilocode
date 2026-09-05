import { Rpc } from "@opencode-ai/schema/rpc"
import { Schema } from "effect"
import { z } from "zod"
import {
  AgentSendRequestSchema,
  AgentSendResponseSchema,
  AgentStartRequestSchema,
  AgentStartResponseSchema,
  CloudAgentSessionIdSchema,
  GetMessageResultInputSchema,
  GetMessageResultOutputSchema,
} from "./cloud/contracts"

// Wire contract for the host-side Cloud Agent RPC surface. The zod schemas in
// src/cloud/contracts.ts are the single authoritative wire shape; they are
// Standard Schema conformant, so they serve directly as the RPC method
// input/output validators. The RPC framework validates each input once at this
// boundary; handlers receive decoded, typed values and do not re-parse.

// start and send are admissions: their inputs arrive without a caller-supplied
// message id, which the adapter assigns. The start input additionally omits
// options.kilocodeOrganizationId: the resolved organization is injected
// host-side from the selected account, so a caller cannot override org
// selection through the wire. Both omits are structural — the field is absent
// from the validated input, not merely ignored after decode.
const StartInput = AgentStartRequestSchema.extend({
  message: z.object({ prompt: z.string().min(1).max(100_000) }).strict(),
  options: z.object({ createdOnPlatform: z.literal("kilo-cli") }).strict(),
})
const SendInput = AgentSendRequestSchema.extend({
  message: z.object({ prompt: z.string().min(1).max(100_000) }).strict(),
})

// stream.prepare resolves the WebSocket target for an admitted session. The
// caller may pass the streamUrl from a private start admission; it is validated
// and pinned to the agent origin before any ticket fetch. When absent, a scoped
// stream ticket is fetched under the current resolved account. The output is
// {origin, streamUrl}; the CLI then opens the existing WebSocket transport
// itself. The session-scoped ticket crosses the authenticated local RPC to its
// real consumer; the account bearer token never does.
const StreamPrepareInput = z
  .object({
    cloudAgentSessionId: CloudAgentSessionIdSchema,
    streamUrl: z.string().min(1).optional(),
  })
  .strict()
const StreamPrepareOutput = z.object({
  origin: z.string().min(1),
  streamUrl: z.string().min(1),
})

// Admissions return the full source response including any server-provided
// streamUrl. The stream ticket it carries is an expiring, session-scoped
// credential delivered over the authenticated local RPC to its real CLI
// consumer; it is never the account bearer token, and the parent sanitizes CLI
// stdout. Streaming preparation is a separate concern (see the parity ledger).
const StartOutput = AgentStartResponseSchema
const SendOutput = AgentSendResponseSchema

const errors = {
  "kilocode.cloud": Schema.toStandardSchemaV1(Schema.Undefined),
  "kilocode.cloud_unavailable": Schema.toStandardSchemaV1(Schema.Undefined),
}

/** Public host-side Cloud Agent RPCs. The bearer token never crosses this boundary. */
export namespace CloudRpc {
  export const Definition = Rpc.define({
    id: "kilocode.cloud",
    methods: {
      start: { input: StartInput, output: StartOutput, errors },
      send: { input: SendInput, output: SendOutput, errors },
      status: { input: GetMessageResultInputSchema, output: GetMessageResultOutputSchema, errors },
      result: { input: GetMessageResultInputSchema, output: GetMessageResultOutputSchema, errors },
      "stream.prepare": { input: StreamPrepareInput, output: StreamPrepareOutput, errors },
    },
    events: {},
  })
}
