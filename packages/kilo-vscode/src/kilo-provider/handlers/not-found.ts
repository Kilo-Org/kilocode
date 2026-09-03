export function isNotFoundError(error: unknown, tagged = false): boolean {
  const record = (value: unknown) =>
    value && typeof value === "object" ? (value as Record<string, unknown>) : undefined
  const obj = record(error)
  if (!obj) return false

  const cause = record(obj.cause)
  const body = record(cause?.body)
  return [obj, record(obj.data), cause, body, record(body?.data)].some(
    (value) => value?.name === "NotFoundError" || (tagged && value?._tag === "NotFound") || value?.status === 404,
  )
}
