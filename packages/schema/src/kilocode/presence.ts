import { Rpc } from "@opencode-ai/schema/rpc"
import { Schema } from "effect"

/**
 * Public contract for Kilo viewer presence (the original `session.viewed` seam,
 * a kilocode_change route in the pinned baseline). This module carries no
 * filesystem, Core, or Server code.
 *
 * A viewer is one extension/TUI instance; `attached` are the sessions its
 * providers retain for remote control, `visible` the ones it visibly renders
 * (a subset of attached). The server records a per-viewer registry with a
 * lease TTL, policy caps, and — when the gateway event-service relay is
 * configured — forwards the aggregated presence to the Kilo cloud. It is a
 * viewer registry, not the native per-session idle read receipt
 * (`POST /api/session/:id/view`), and the two coexist by design.
 */
export namespace KiloPresenceRpc {
  export interface ViewerSnapshot {
    viewer: { id: string; active: boolean }
    attached: string[]
    visible: string[]
  }

  const viewedInput = Schema.toStandardSchemaV1(
    Schema.Struct({
      viewer: Schema.Struct({ id: Schema.String, active: Schema.Boolean }),
      attached: Schema.Array(Schema.String),
      visible: Schema.Array(Schema.String),
    }),
  )
  const rpcErrors = { "kilocode.presence": Schema.toStandardSchemaV1(Schema.Undefined) }

  export const Definition = Rpc.define({
    id: "kilocode.presence",
    methods: {
      viewed: { input: viewedInput, output: Schema.toStandardSchemaV1(Schema.Boolean), errors: rpcErrors },
    },
    events: {},
  })
}
