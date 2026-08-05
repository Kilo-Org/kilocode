export * as ServerEvent from "./server-event"

import { Event } from "./event"

export const Connected = Event.define({ type: "server.connected", schema: {} })
export const Disposed = Event.define({ type: "global.disposed", schema: {} })
// kilocode_change start - emitted (via GlobalBus) when config updates without a full dispose
export const ConfigUpdated = Event.define({ type: "global.config.updated", schema: {} })
// kilocode_change end

export const Definitions = Event.inventory(Connected, Disposed, ConfigUpdated) // kilocode_change
