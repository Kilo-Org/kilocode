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
  return path.endsWith("/chat/completions")
}

function rewrite(input: unknown): number {
  if (Array.isArray(input)) return input.reduce((count, item) => count + rewrite(item), 0)
  if (!record(input)) return 0

  const count = Object.values(input).reduce((total, value) => total + rewrite(value), 0)
  if (!("oneOf" in input)) return count

  const value = input.oneOf
  delete input.oneOf
  input.anyOf = value
  return count + 1
}

export function sanitizeChatCompletionsBody(input: string | URL | Request, body: BodyInit | null | undefined) {
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
  if (!record(data.provider)) return body
  if (!Array.isArray(data.provider.order)) return body
  if (!data.provider.order.some((item) => typeof item === "string" && item.toLowerCase() === "friendli")) return body
  if (rewrite(data) === 0) return body
  return JSON.stringify(data)
}
