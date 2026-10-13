import { Plugin } from "@opencode/plugin/effect"
import { Effect } from "effect"

export default Plugin.define({
  id: "kilo.probe",
  effect: () => Effect.void,
})
