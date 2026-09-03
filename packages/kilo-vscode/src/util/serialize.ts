type Value = string | number | boolean | bigint | null | undefined | readonly Value[]

const types = ["bigint", "boolean", "number", "string", "object", "undefined"]

function encode(value: Value): unknown {
  if (Array.isArray(value)) return value.map(encode)
  return `${types.indexOf(typeof value)}:${Object.is(value, -0) ? "-0" : String(value)}`
}

export function serialize(parts: readonly Value[]): string {
  return JSON.stringify(parts.map(encode))
}
