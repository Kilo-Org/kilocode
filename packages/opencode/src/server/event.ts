import { EventV2 } from "@opencode-ai/core/event"
import { Schema } from "effect"

export const Event = {
  Connected: EventV2.define({ type: "server.connected", schema: {} }),
  Disposed: EventV2.define({ type: "global.disposed", schema: {} }),
  // kilocode_change - emitted (via GlobalBus) when config updates without a full dispose; EventV2 def to
  // keep this shared file off the legacy Bus. Only its .type string is used; publishers emit to GlobalBus.
  ConfigUpdated: EventV2.define({ type: "global.config.updated", schema: {} }),
}

export const InstanceDisposed = Schema.Struct({
  id: Schema.String,
  type: Schema.Literal("server.instance.disposed"),
  properties: Schema.Struct({ directory: Schema.String }),
}).annotate({ identifier: "Event.server.instance.disposed" })
