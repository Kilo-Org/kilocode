export function errorCode(value: unknown) {
  const record = (value: unknown) =>
    value != null && typeof value === "object" ? Object.fromEntries(Object.entries(value)) : undefined
  const root = record(value)
  const error = record(root?.error)
  const json = record(error?.json)
  const fields = [root, error, json, record(error?.data), record(json?.data)]

  const codes = fields.flatMap((field) => [field?.error, field?.code].filter((value) => typeof value === "string"))
  const messages = fields.flatMap((field) => (typeof field?.message === "string" ? [field.message] : []))
  // tRPC can put a generic status code beside the actionable Kilo code in its message.
  return [...codes, ...messages].find((value) => value.startsWith("KILO_")) ?? codes.at(0) ?? messages.at(0)
}
