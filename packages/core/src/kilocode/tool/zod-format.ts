export * as KiloZodFormat from "./zod-format.js"

import type { StandardJSONSchemaV1, StandardSchemaV1 } from "@standard-schema/spec"
import type { ToJSONSchemaParams } from "zod/v4/core"

// Zod 4.6+ emits these next to the equivalent `pattern` for `startsWith`, `endsWith` and `includes`.
// They are not JSON Schema formats, and strict providers reject a tool schema that contains them.
const nonStandard = new Set(["starts_with", "ends_with", "includes"])

/** Zod `override` that drops the non-standard string-check formats; `pattern` and standard formats stay. */
export const override: NonNullable<ToJSONSchemaParams["override"]> = (ctx) => {
  if (typeof ctx.jsonSchema.format === "string" && nonStandard.has(ctx.jsonSchema.format)) delete ctx.jsonSchema.format
}

/** Standard JSON Schema options carrying the override; `libraryOptions` are vendor-specific, so only for Zod. */
export const options = (schema: StandardSchemaV1<any, any>): Pick<StandardJSONSchemaV1.Options, "libraryOptions"> =>
  schema["~standard"].vendor === "zod" ? { libraryOptions: { override } } : {}
