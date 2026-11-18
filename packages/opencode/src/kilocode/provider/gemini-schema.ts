// Gemini accepts a single `type` per schema, and an `anyOf` node may only sit
// next to `nullable` and `description`. JSON Schema tool inputs (common in MCP
// servers) use type arrays such as `["string", "null"]` with `enum` or other
// constraints beside them. `lowerTypeArrays` rewrites those nodes before the
// generic Gemini sanitizer runs, while enum values are still their original
// JSON types:
//
// - One non-null type: `type: "<t>"` plus `nullable: true`. No `anyOf`.
// - Two or more: an `anyOf` with one branch per type. Each branch gets the
//   keywords that apply to its type, and only the enum values of its type.
//   The outside keeps `anyOf`, `nullable`, and `description`.
//
// `@ai-sdk/google` and `@ai-sdk/google-vertex` rebuild the schema through
// `convertJSONSchemaToOpenAPISchema`, which drops a `nullable` key it finds on
// the input. It only emits `nullable` for an `anyOf` with a `{ type: "null" }`
// branch, so on those transports null stays a branch and the SDK collapses it.

const plain = (node: unknown): node is Record<string, unknown> =>
  typeof node === "object" && node !== null && !Array.isArray(node)

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

const NATIVE = new Set(["@ai-sdk/google", "@ai-sdk/google-vertex"])

function matches(type: string, value: unknown) {
  if (type === "null") return value === null
  if (type === "string") return typeof value === "string"
  if (type === "boolean") return typeof value === "boolean"
  if (type === "integer") return Number.isInteger(value)
  if (type === "number") return typeof value === "number"
  if (type === "array") return Array.isArray(value)
  if (type === "object") return plain(value)
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
  if (Array.isArray(node.enum)) out.enum = node.enum.filter((value) => matches(type, value))
  if (Array.isArray(node.examples)) out.examples = node.examples.filter((value) => matches(type, value))
  if ("const" in node && matches(type, node.const)) out.const = node.const
  if ("default" in node && matches(type, node.default)) out.default = node.default
  return out
}

function lower(node: Record<string, unknown>, types: string[], native: boolean) {
  const unique = [...new Set(types)]
  const allowed = (type: string) =>
    (!Array.isArray(node.enum) || node.enum.some((value) => matches(type, value))) &&
    (!("const" in node) || matches(type, node.const))
  const filtered = unique.filter(allowed)
  // An unsatisfiable enum or const is the caller's bug. Keep every declared type.
  const live = filtered.length > 0 ? filtered : unique
  const nullable = live.includes("null") || node.nullable === true
  const rest = live.filter((type) => type !== "null")
  const description = "description" in node ? { description: node.description } : {}

  if (rest.length === 0) return { ...branch(node, "null"), ...description }
  if (native && nullable)
    return { anyOf: [...rest.map((type) => branch(node, type)), { type: "null" }], ...description }
  const flag = nullable ? { nullable: true } : {}
  if (rest.length === 1) return { ...branch(node, rest[0]), ...flag, ...description }
  return { anyOf: rest.map((type) => branch(node, type)), ...flag, ...description }
}

// Gemini's sanitizer stringifies enum values, so a JSON null would become the
// string "null". Null leaves the enum here instead. A typed schema only admits
// null through `nullable`, which is already set. Without a `type`, a null value marks the schema nullable.
function strip(node: Record<string, unknown>) {
  if (!Array.isArray(node.enum) || !node.enum.includes(null) || node.type === "null") return node
  const values = node.enum.filter((value) => value !== null)
  const out: Record<string, unknown> = { ...node, enum: values }
  if (values.length === 0) delete out.enum
  if (node.type == null) out.nullable = true
  return out
}

export function lowerTypeArrays(schema: unknown, npm: string | undefined): unknown {
  const native = npm != null && NATIVE.has(npm)
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk)
    if (!plain(node)) return node
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(node)) {
      if (DATA.has(key)) {
        out[key] = value
        continue
      }
      if (MAPS.has(key) && plain(value)) {
        out[key] = Object.fromEntries(Object.entries(value).map(([name, child]) => [name, walk(child)]))
        continue
      }
      out[key] = walk(value)
    }
    const types = out.type
    if (Array.isArray(types) && types.every((type) => typeof type === "string")) return lower(out, types, native)
    return strip(out)
  }
  return walk(schema)
}
