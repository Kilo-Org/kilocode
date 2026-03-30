import { BusEvent } from "@/bus/bus-event"
import z from "zod"

export const Event = {
  Connected: BusEvent.define("server.connected", z.object({})),
  Disposed: BusEvent.define("global.disposed", z.object({})),
  // kilocode_change start — emitted when config is updated without a full dispose
  ConfigUpdated: BusEvent.define("global.config.updated", z.object({})),
  // kilocode_change end
}
