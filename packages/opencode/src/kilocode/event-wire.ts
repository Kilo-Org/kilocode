import { DateTime, Schema } from "effect"

const codec = (schema: Schema.Top) => schema as Schema.Codec<unknown, unknown>

function wire(value: unknown): unknown {
  if (DateTime.isDateTime(value)) return DateTime.toEpochMillis(value)
  if (Array.isArray(value)) return value.map(wire)
  if (!value || typeof value !== "object") return value
  const json = (value as { toJSON?: () => unknown }).toJSON
  if (typeof json === "function") {
    const result = json.call(value)
    if (result !== value) return wire(result)
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, wire(item)]),
  )
}

function legacy(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value
  const timestamp = (value as { timestamp?: unknown }).timestamp
  if (typeof timestamp !== "string") return value
  const millis = Date.parse(timestamp)
  if (!Number.isFinite(millis)) return value
  return { ...value, timestamp: millis }
}

export function encode<S extends Schema.Top>(schema: S, value: unknown): S["Encoded"] {
  const target = codec(schema)
  const decoded = Schema.decodeUnknownSync(target)(wire(value))
  return Schema.encodeUnknownSync(target)(decoded) as S["Encoded"]
}

export function decode<S extends Schema.Top>(schema: S, value: unknown): S["Type"] {
  const target = codec(schema)
  try {
    return Schema.decodeUnknownSync(target)(value) as S["Type"]
  } catch {
    return Schema.decodeUnknownSync(target)(legacy(value)) as S["Type"]
  }
}
