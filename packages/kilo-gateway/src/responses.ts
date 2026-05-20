function record(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input)
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

export function sanitizeResponsesBody(input: string | URL | Request, body: BodyInit | null | undefined) {
  if (!endpoint(input)) return body
  if (typeof body !== "string") return body

  const data = (() => {
    try {
      return JSON.parse(body) as unknown
    } catch {
      return undefined
    }
  })()
  if (!record(data)) return body
  if (data.store === true) return body
  if (!Array.isArray(data.input)) return body

  const result = strip(data.input)
  if (!result.changed) return body
  return JSON.stringify({ ...data, input: result.kept })
}
