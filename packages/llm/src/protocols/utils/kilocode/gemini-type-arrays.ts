import { isRecord } from "../../../utils/record"

// Gemini accepts a single `type` per schema, and an `anyOf` node may only sit
// next to `nullable` and `description`. JSON Schema tool inputs (common in MCP
// servers) use type arrays such as `["string", "null"]` with `enum` or other
// constraints beside them. `lowerTypeArrays` rewrites those nodes before the
// Gemini sanitizer runs, while enum values still hold their JSON types:
//
// - One non-null type: `type: "<t>"` plus `nullable: true`. No `anyOf`.
// - Two or more: an `anyOf` with one branch per type. Each branch gets the
//   keywords that apply to its type, and only the enum values of its type.
//   The outside keeps `anyOf`, `nullable`, and `description`.
// - `null` leaves `enum`, because the sanitizer stringifies enum values and
//   would turn it into the string "null". Nullability lives in `nullable`.

// Values under these keys are data, not subschemas.
const DATA = new Set(["enum", "const", "default", "examples"])

// Values under these keys map names to subschemas.
const MAPS = new Set(["properties", "patternProperties", "$defs", "definitions", "dependentSchemas"])

const NUMERIC = ["format", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf"]

// Keywords that constrain a single JSON type. A branch gets only its own.
const KEYWORDS: Record<string, string[]> = {
  string: ["format", "pattern", "minLength", "maxLength", "contentEncoding", "contentMediaType"],
  number: NUMERIC,
  integer: NUMERIC,
  boolean: [],
  array: ["items", "prefixItems", "minItems", "maxItems", "uniqueItems", "contains", "minContains", "maxContains"],
  object: [
    "properties",
    "required",
    "additionalProperties",
    "patternProperties",
    "propertyNames",
    "minProperties",
    "maxProperties",
    "dependentRequired",
    "dependentSchemas",
  ],
}

const TYPED = new Set(Object.values(KEYWORDS).flat())

// Keys handled explicitly when a type array is lowered.
const OWN = new Set(["type", "nullable", "description", ...DATA])

function matches(type: string, value: unknown) {
  if (type === "null") return value === null
  if (type === "string") return typeof value === "string"
  if (type === "boolean") return typeof value === "boolean"
  if (type === "integer") return Number.isInteger(value)
  if (type === "number") return typeof value === "number"
  if (type === "array") return Array.isArray(value)
  if (type === "object") return isRecord(value)
  return true
}

function branch(node: Record<string, unknown>, type: string) {
  const own = new Set(KEYWORDS[type] ?? [])
  const out: Record<string, unknown> = { type }
  for (const [key, value] of Object.entries(node)) {
    if (OWN.has(key)) continue
    if (TYPED.has(key) && !own.has(key)) continue
    out[key] = value
  }
  // An empty enum allows no value at all, so leave the key off instead.
  for (const key of ["enum", "examples"]) {
    const list = node[key]
    const values = Array.isArray(list) ? list.filter((value) => matches(type, value)) : []
    if (values.length > 0) out[key] = values
  }
  if ("const" in node && matches(type, node.const)) out.const = node.const
  if ("default" in node && matches(type, node.default)) out.default = node.default
  return out
}

// `projectNode` in gemini-tool-schema.ts drops object schemas with no
// properties, which would leave a hole in a generated `anyOf`. Keep this in
// sync with its `emptyObjectSchema`.
const empty = (node: Record<string, unknown>) =>
  node.type === "object" &&
  (!isRecord(node.properties) || Object.keys(node.properties).length === 0) &&
  !node.additionalProperties

function lower(node: Record<string, unknown>, types: string[]) {
  const unique = [...new Set(types)]
  const allowed = (type: string) =>
    (!Array.isArray(node.enum) || node.enum.some((value) => matches(type, value))) &&
    (!("const" in node) || matches(type, node.const))
  const filtered = unique.filter(allowed)
  // An unsatisfiable enum or const is the caller's bug. Keep every declared type.
  const live = filtered.length > 0 ? filtered : unique
  const nullable = live.includes("null") || node.nullable === true
  const description = "description" in node ? { description: node.description } : {}
  const all = live.filter((type) => type !== "null").map((type) => branch(node, type))
  // A lone empty object keeps its usual projection. Beside other types, it goes.
  const kept = all.filter((item) => !empty(item))
  const rest = all.length > 1 && kept.length > 0 ? kept : all

  if (rest.length === 0) return { ...branch(node, "null"), ...description }
  const flag = nullable ? { nullable: true } : {}
  if (rest.length === 1) return { ...rest[0], ...flag, ...description }
  return { anyOf: rest, ...flag, ...description }
}

// A typed schema only admits null through `nullable`, which a type array has
// already set. Without a `type`, a null value marks the schema nullable.
function strip(node: Record<string, unknown>) {
  if (!Array.isArray(node.enum) || !node.enum.includes(null) || node.type === "null") return node
  const values = node.enum.filter((value) => value !== null)
  const out: Record<string, unknown> = { ...node, enum: values }
  if (values.length === 0) delete out.enum
  if (node.type == null) out.nullable = true
  return out
}

export function lowerTypeArrays(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(lowerTypeArrays)
  if (!isRecord(schema)) return schema
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(schema)) {
    if (DATA.has(key)) {
      out[key] = value
      continue
    }
    if (MAPS.has(key) && isRecord(value)) {
      out[key] = Object.fromEntries(Object.entries(value).map(([name, child]) => [name, lowerTypeArrays(child)]))
      continue
    }
    out[key] = lowerTypeArrays(value)
  }
  const types = out.type
  if (Array.isArray(types) && types.every((type) => typeof type === "string")) return lower(out, types)
  return strip(out)
}
