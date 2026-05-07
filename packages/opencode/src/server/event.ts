import { BusEvent } from "@/bus/bus-event"
import { Schema } from "effect"

export const Event = {
  Connected: BusEvent.define("server.connected", Schema.Struct({})),
  Disposed: BusEvent.define("global.disposed", Schema.Struct({})),
  // kilocode_change start — emitted when config is updated without a full dispose
  ConfigUpdated: BusEvent.define("global.config.updated", Schema.Struct({})),
  // kilocode_change end
}
