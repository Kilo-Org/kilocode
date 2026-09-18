export function sanitize(body: RequestInit["body"]) {
  if (typeof body !== "string") return body

  try {
    const parsed = JSON.parse(body) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return body

    const payload = parsed as Record<string, unknown>
    if (typeof payload.model !== "string") return body

    const match = payload.model.match(/^gpt-(\d+)\.(\d+)/)
    if (!match) return body

    const major = Number(match[1])
    const minor = Number(match[2])
    if (major < 5 || (major === 5 && minor < 6)) return body
    if (!("prompt_cache_retention" in payload) && !("prompt_cache_options" in payload)) return body

    delete payload.prompt_cache_retention
    delete payload.prompt_cache_options
    return JSON.stringify(payload)
  } catch {
    return body
  }
}
