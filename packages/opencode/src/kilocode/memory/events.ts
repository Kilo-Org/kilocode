import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { capture as captureInstance } from "@/kilocode/instance"
import * as Log from "@opencode-ai/core/util/log"
import { MemoryEvents as Core } from "@kilocode/kilo-memory/effect/events"

const log = Log.create({ service: "memory.events" })

/** Host event glue: re-exports the package event payload/builder and binds the package's best-effort
 * event sink to opencode's Bus. The package stays free of the host event system until `install()`. */
export namespace MemoryEvents {
  export const Payload = Core.Payload
  export const status = Core.status

  export type Status = Core.Status
  export type Phase = Core.Phase
  export type Trigger = Core.Trigger
  export type Index = Core.Index
  export type Inspect = Core.Inspect

  export const Status = BusEvent.define("memory.status", Core.Payload)
  export const Updated = BusEvent.define("memory.updated", Core.Payload)
  export const Error = BusEvent.define("memory.error", Core.Payload)

  /** Route the package event sink through the host Bus. Best-effort: events are dropped when no
   * instance context is bound, since Bus.publish requires it. */
  export function install() {
    Core.setSink(async (input) => {
      const def = input.event === "updated" ? Updated : input.event === "error" ? Error : Status
      const ctx = captureInstance() // Bus.publish requires the instance context; events are best-effort if it is absent
      if (!ctx) return
      try {
        await Bus.publish(ctx, def, input.payload)
      } catch (err) {
        log.warn("failed to publish memory event", { err, type: def.type })
      }
    })
  }
}
