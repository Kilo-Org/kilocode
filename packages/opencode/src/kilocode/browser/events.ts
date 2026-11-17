import { Schema } from "effect"
import { BusEvent } from "@/bus/bus-event"

const Payload = Schema.Struct({
  backend: Schema.Literals(["playwright", "extension"]),
  reason: Schema.String,
  hint: Schema.String,
})

/** Tells clients to show the setup hint; never reaches the model. */
export namespace BrowserEvents {
  export const Unavailable = BusEvent.define("browser.unavailable", Payload)
}
