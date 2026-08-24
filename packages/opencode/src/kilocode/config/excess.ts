import { Schema } from "effect"

export namespace Excess {
  export function keys(schema: Schema.Top, input: unknown) {
    if (typeof input !== "object" || input === null || Array.isArray(input)) return []
    if (schema.ast._tag !== "Objects" || schema.ast.indexSignatures.length > 0) return []
    const known = new Set(schema.ast.propertySignatures.map((item) => String(item.name)))
    return Object.keys(input).filter((key) => !known.has(key))
  }

  export function issue(keys: readonly string[]) {
    return `Unrecognized key${keys.length === 1 ? "" : "s"}: ${keys.join(", ")}`
  }
}
