export const personal = "personal"

let marked = false

export function markDisconnected(input: boolean) {
  marked = input
}

export function wasDisconnected() {
  return marked
}

function text(input: unknown) {
  if (input instanceof Error) return input.message
  if (typeof input === "string") return input
  if (input === undefined || input === null) return ""
  return JSON.stringify(input)
}

export function parseDeviceCode(input: string | undefined) {
  if (!input) return undefined
  const code = input.match(/code:\s*([A-Z0-9-]+)/i)?.[1]
  if (code) return code.toUpperCase()
  return input.match(/\b([A-Z0-9]{4}-[A-Z0-9]{4})\b/i)?.[1]?.toUpperCase()
}

export function authError(input: unknown) {
  const value = text(input).toLowerCase()
  return value.includes("unauthorized") || value.includes("invalid token") || value.includes('status":401')
}

export function money(input: number | null | undefined) {
  if (typeof input !== "number" || !Number.isFinite(input)) return "Unknown"
  return `$${input.toFixed(2)}`
}

export function initials(name: string | undefined, email: string) {
  const parts = (name?.trim() || email)
    .split(/[\s._@-]+/)
    .filter(Boolean)
    .slice(0, 2)
  const value = parts.map((part) => part[0] ?? "").join("")
  return value.toUpperCase() || "KG"
}

export function safeReturn(input: string | null | undefined) {
  if (!input || !input.startsWith("/") || input.startsWith("//")) return "/profile"
  try {
    const url = new URL(input, "http://localhost")
    if (url.origin !== "http://localhost") return "/profile"
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return "/profile"
  }
}

export function page(params: URLSearchParams, path: string, extra?: Record<string, string | null | undefined>) {
  const next = new URLSearchParams()
  const server = params.get("server")
  if (server) next.set("server", server)
  for (const [key, value] of Object.entries(extra ?? {})) {
    if (value) next.set(key, value)
  }
  const query = next.toString()
  return `${path}${query ? `?${query}` : ""}`
}

export function cloud(path = "/profile") {
  return `https://app.kilo.ai${path}`
}

export function usage(id: string | null | undefined) {
  if (!id) return cloud("/usage")
  return cloud(`/organizations/${encodeURIComponent(id)}/usage-details`)
}

export function credits(id: string | null | undefined) {
  if (!id) return cloud("/profile")
  return cloud(`/organizations/${encodeURIComponent(id)}`)
}
