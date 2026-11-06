import { Schema } from "effect"
import { Params, WireParams } from "./params"

// Validation and advertised schema differ on purpose: the wire schema is one flat object for strict providers,
// while `Params` keeps the per-operation union and its cross-field rules.
export const Input = {
  "~standard": {
    ...Schema.toStandardSchemaV1(Params)["~standard"],
    jsonSchema: Schema.toStandardJSONSchemaV1(WireParams)["~standard"].jsonSchema,
  },
}