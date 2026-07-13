import { asSchema, jsonSchema, type JSONSchema7, type Tool } from "ai"

const MAPS = ["$defs", "definitions", "dependencies", "dependentSchemas", "patternProperties", "properties"]
const DANGERS = ["contains", "if", "not", "oneOf"]
const NODES = [
  "additionalItems",
  "additionalProperties",
  "allOf",
  "anyOf",
  "contentSchema",
  "else",
  "extends",
  "items",
  "prefixItems",
  "propertyNames",
  "then",
  "unevaluatedItems",
  "unevaluatedProperties",
]

function record(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input)
}

function lookaround(input: string) {
  let inside = false

  for (let i = 0; i < input.length; i++) {
    const char = input[i]
    if (char === "\\") {
      i++
      continue
    }
    if (inside) {
      if (char === "]") inside = false
      continue
    }
    if (char === "[") {
      inside = true
      continue
    }
    if (char !== "(") continue
    if (
      input.startsWith("(?=", i) ||
      input.startsWith("(?!", i) ||
      input.startsWith("(?<=", i) ||
      input.startsWith("(?<!", i)
    )
      return true
  }
  return false
}

function reference(input: unknown, danger = false): boolean {
  if (Array.isArray(input)) return input.some((item) => reference(item, danger))
  if (!record(input)) return false
  if (danger && typeof input.$ref === "string") return true
  return Object.entries(input).some(([key, value]) => reference(value, danger || DANGERS.includes(key)))
}

function walk(input: unknown): { value: unknown; changed: boolean; dynamic: boolean; hazard: boolean } {
  if (Array.isArray(input)) {
    const items = input.map(walk)
    const changed = items.some((item) => item.changed)
    return {
      value: changed ? items.map((item) => item.value) : input,
      changed,
      dynamic: items.some((item) => item.dynamic),
      hazard: items.some((item) => item.hazard),
    }
  }
  if (!record(input)) return { value: input, changed: false, dynamic: false, hazard: false }

  const next = { ...input }
  const found = typeof input.pattern === "string" && lookaround(input.pattern)
  if (found) delete next.pattern

  const maps = MAPS.reduce(
    (state, key) => {
      const value = input[key]
      if (!record(value)) return state

      const items = Object.entries(value).map(([name, item]) => {
        const result = walk(item)
        const removed = key === "patternProperties" && lookaround(name)
        return {
          changed: removed || result.changed,
          dynamic: removed || result.dynamic,
          hazard: result.hazard,
          entry: removed ? undefined : ([name, result.value] as const),
        }
      })
      const changed = items.some((item) => item.changed)
      if (changed) next[key] = Object.fromEntries(items.flatMap((item) => (item.entry ? [item.entry] : [])))
      return {
        changed: changed || state.changed,
        dynamic: items.some((item) => item.dynamic) || state.dynamic,
        hazard: items.some((item) => item.hazard) || state.hazard,
      }
    },
    { changed: found, dynamic: false, hazard: false },
  )

  const nodes = NODES.reduce((state, key) => {
    const result = walk(input[key])
    if (result.changed) next[key] = result.value
    return {
      changed: result.changed || state.changed,
      dynamic: result.dynamic || state.dynamic,
      hazard: result.hazard || state.hazard,
    }
  }, maps)

  const dangers = DANGERS.reduce((state, key) => {
    const result = walk(input[key])
    if (result.changed) next[key] = result.value
    return {
      changed: result.changed || state.changed,
      dynamic: result.dynamic || state.dynamic,
      hazard: result.changed || result.hazard || state.hazard,
    }
  }, nodes)
  return { value: dangers.changed ? next : input, ...dangers }
}

export async function sanitize(input: Record<string, Tool>): Promise<Record<string, Tool>> {
  const items = await Promise.all(
    Object.entries(input).map(async ([name, item]) => {
      if (item.type === "provider") return { name, tool: item, changed: false }
      const source = asSchema(item.inputSchema)
      const original = await source.jsonSchema
      const result = walk(original)
      if (!result.changed) return { name, tool: item, changed: false }
      // Tool inputs are object-root schemas. Complex widening falls back to accepting any object.
      const fallback = result.dynamic || result.hazard || reference(original)
      const schema = fallback ? { type: "object" as const, additionalProperties: true } : result.value
      return {
        name,
        tool: { ...item, inputSchema: jsonSchema(schema as JSONSchema7, { validate: source.validate }) },
        changed: true,
      }
    }),
  )
  if (!items.some((item) => item.changed)) return input
  return Object.fromEntries(items.map((item) => [item.name, item.tool]))
}

export * as KiloToolSchema from "./tool-schema"
