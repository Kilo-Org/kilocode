export * as Command from "./command.js"

import { Schema } from "effect"
import { ConfigModel } from "./config/model.js" // kilocode_change(workflow-model) seam - command model selection schema
import { ephemeral, inventory } from "./event.js"
import { optional } from "./schema.js"

const Updated = ephemeral({ type: "command.updated", schema: {} })

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  name: Schema.String,
  description: Schema.String.pipe(optional),
  template: Schema.String.pipe(optional), // kilocode_change(workflow-model) seam - command template metadata
  model: ConfigModel.Selection.pipe(optional), // kilocode_change(workflow-model) seam - command model metadata
}).annotate({ identifier: "Command.Info" })

export const Event = {
  Updated,
  Definitions: inventory(Updated),
}
