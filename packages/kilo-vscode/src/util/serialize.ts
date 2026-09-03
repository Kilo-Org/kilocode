type Value = string | number | boolean | bigint | null | readonly Value[]

const raw = (JSON as JSON & { rawJSON(value: string): unknown }).rawJSON

function encode(value: Value): unknown {
  if (Array.isArray(value)) return [[], ...value.map(encode)]
  if (typeof value === "bigint") return [0, String(value)]
  return Object.is(value, -0) ? raw("-0") : value
}

export function serialize(parts: readonly Value[]): string {
  return JSON.stringify(parts.map(encode))
}
