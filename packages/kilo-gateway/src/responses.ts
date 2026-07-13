function record(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input)
}

const LOOKAROUND = /\(\?(?:[=!]|<[=!])/
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

function sanitize(input: unknown): boolean {
  if (Array.isArray(input)) return input.reduce((changed, item) => sanitize(item) || changed, false)
  if (!record(input)) return false

  const found = typeof input.pattern === "string" && LOOKAROUND.test(input.pattern)
  if (found) delete input.pattern
  const maps = MAPS.reduce((changed, key) => {
    const value = input[key]
    if (!record(value)) return changed

    const removed =
      key === "patternProperties"
        ? Object.keys(value).reduce((removed, pattern) => {
            if (!LOOKAROUND.test(pattern)) return removed
            delete value[pattern]
            return true
          }, false)
        : false
    return Object.values(value).reduce<boolean>((nested, item) => sanitize(item) || nested, removed || changed)
  }, found)
  return NODES.reduce((changed, key) => sanitize(input[key]) || changed, maps)
}

function endpoint(input: string | URL | Request) {
  const raw = input instanceof Request ? input.url : input.toString()
  const path = (() => {
    try {
      return new URL(raw).pathname
    } catch {
      return raw.split(/[?#]/, 1)[0]
    }
  })()
  return path.endsWith("/responses")
}

function strip(input: unknown[]) {
  const kept = input.flatMap((item) => {
    if (!record(item)) return [item]
    if (item.type === "item_reference") return []
    if (!("id" in item)) return [item]

    const next = { ...item }
    delete next.id
    return [next]
  })
  const changed = kept.length !== input.length || kept.some((item, index) => item !== input[index])
  return { kept, changed }
}

export function transformRequestBody(
  input: string | URL | Request,
  body: BodyInit | null | undefined,
  value?: "allow" | "deny",
) {
  const responses = endpoint(input)
  if (!responses && !value) return body
  if (typeof body !== "string") return body

  const data = (() => {
    try {
      return JSON.parse(body) as unknown
    } catch {
      return undefined
    }
  })()
  if (!record(data)) return body

  const result = responses && data.store !== true && Array.isArray(data.input) ? strip(data.input) : undefined
  const sanitized =
    responses && Array.isArray(data.tools)
      ? data.tools.reduce((changed, item) => {
          if (!record(item) || item.type !== "function") return changed
          return sanitize(item.parameters) || changed
        }, false)
      : false
  if (!result?.changed && !sanitized && !value) return body

  const provider = record(data.provider) ? data.provider : {}
  return JSON.stringify({
    ...data,
    ...(result?.changed ? { input: result.kept } : {}),
    ...(value ? { provider: { ...provider, data_collection: value } } : {}),
  })
}
