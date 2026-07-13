import { asSchema, jsonSchema, type JSONSchema7, type Tool } from "ai"

const MAPS = ["$defs", "definitions", "dependencies", "dependentSchemas", "patternProperties", "properties"]
const NODES = [
  "additionalItems",
  "additionalProperties",
  "allOf",
  "anyOf",
  "contains",
  "contentSchema",
  "else",
  "extends",
  "if",
  "items",
  "not",
  "oneOf",
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

function walk(input: unknown): { value: unknown; changed: boolean } {
  if (Array.isArray(input)) {
    const items = input.map(walk)
    const changed = items.some((item) => item.changed)
    return { value: changed ? items.map((item) => item.value) : input, changed }
  }
  if (!record(input)) return { value: input, changed: false }

  const next = { ...input }
  const found = typeof input.pattern === "string" && lookaround(input.pattern)
  if (found) delete next.pattern

  const maps = MAPS.reduce((changed, key) => {
    const value = input[key]
    if (!record(value)) return changed

    const items = Object.entries(value).map(([name, item]) => {
      if (key === "patternProperties" && lookaround(name)) return { changed: true }
      const result = walk(item)
      return { changed: result.changed, entry: [name, result.value] as [string, unknown] }
    })
    const nested = items.some((item) => item.changed)
    if (nested) next[key] = Object.fromEntries(items.flatMap((item) => (item.entry ? [item.entry] : [])))
    return nested || changed
  }, found)

  const changed = NODES.reduce((changed, key) => {
    const result = walk(input[key])
    if (result.changed) next[key] = result.value
    return result.changed || changed
  }, maps)
  return { value: changed ? next : input, changed }
}

export async function sanitize(input: Record<string, Tool>): Promise<Record<string, Tool>> {
  const items = await Promise.all(
    Object.entries(input).map(async ([name, item]) => {
      if (item.type === "provider") return { name, tool: item, changed: false }
      const source = asSchema(item.inputSchema)
      const result = walk(await source.jsonSchema)
      if (!result.changed) return { name, tool: item, changed: false }
      return {
        name,
        tool: { ...item, inputSchema: jsonSchema(result.value as JSONSchema7, { validate: source.validate }) },
        changed: true,
      }
    }),
  )
  if (!items.some((item) => item.changed)) return input
  return Object.fromEntries(items.map((item) => [item.name, item.tool]))
}

export * as KiloToolSchema from "./tool-schema"
