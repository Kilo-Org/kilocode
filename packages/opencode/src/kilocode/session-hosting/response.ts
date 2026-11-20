function fields(value: unknown) {
  const record = (item: unknown) =>
    item != null && typeof item === "object" ? Object.fromEntries(Object.entries(item)) : undefined
  const root = record(value)
  const error = record(root?.error)
  const json = record(error?.json)
  return [root, error, json, record(error?.data), record(json?.data)]
}

/**
 * Every `error`/`code` string across the tRPC envelope. A real tRPC failure
 * carries a generic transport code (`CONFLICT`) next to the actionable Kilo
 * code, which is usually in `error.message` or `error.json.message`.
 */
export function errorCodes(value: unknown) {
  return fields(value).flatMap((field) =>
    [field?.error, field?.code].filter((item): item is string => typeof item === "string"),
  )
}

/** Every `message` string across the tRPC envelope. */
export function errorMessages(value: unknown) {
  return fields(value).flatMap((field) => (typeof field?.message === "string" ? [field.message] : []))
}

/** Every candidate string, codes first then messages. */
export function errorCandidates(value: unknown) {
  return [...errorCodes(value), ...errorMessages(value)]
}

export function errorCode(value: unknown) {
  const codes = errorCodes(value)
  const messages = errorMessages(value)
  // tRPC can put a generic status code beside the actionable Kilo code in its message.
  return [...codes, ...messages].find((value) => value.startsWith("KILO_")) ?? codes.at(0) ?? messages.at(0)
}
