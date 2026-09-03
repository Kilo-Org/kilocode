type Value = string | number | boolean | bigint | null | readonly Value[]

const raw = (JSON as JSON & { rawJSON(value: string): unknown }).rawJSON

export function serialize(parts: readonly Value[]): string {
  return JSON.stringify(parts, (_, value: unknown) => {
    if (typeof value === "bigint") return raw(String(value))
    return Object.is(value, -0) ? raw("-0") : value
  })
}
