export * as KiloServer from "./server.js"

export const DEFAULT_API_URL = "https://api.kilo.ai"
export const DEFAULT_AI_GATEWAY_URL = "https://ai-gateway.kilo.ai/api/v1"
const TOKEN = /^(https?:\/\/.+):.+$/

export function fromEnv(env: Record<string, string | undefined> = process.env) {
  return normalize(env.KILO_API_URL?.trim() || DEFAULT_API_URL)
}

// Same as `resolveKiloAiGatewayBase` on main (`packages/kilo-gateway/src/api/constants.ts`):
// KILO_AI_GATEWAY_URL takes precedence; when only KILO_API_URL is set, gateway traffic goes to
// `${KILO_API_URL}/api/gateway/v1`; otherwise defaults to `https://ai-gateway.kilo.ai/api/v1`.
export function aiGatewayFromEnv(env: Record<string, string | undefined> = process.env) {
  const gatewayUrl = env.KILO_AI_GATEWAY_URL?.trim()
  if (gatewayUrl) return normalize(gatewayUrl)
  const apiUrl = env.KILO_API_URL?.trim()
  if (apiUrl) return `${normalize(apiUrl)}/api/gateway/v1`
  return DEFAULT_AI_GATEWAY_URL
}

// Development tokens can carry the backend URL before the final `:`, as in v1 (`auth/token.ts`).
export function fromToken(token: string) {
  const match = TOKEN.exec(token)
  return match?.[1] ? normalize(match[1]) : undefined
}

export function normalize(input: string) {
  const url = parse(input)
  return `${url.origin}${url.pathname}`.replace(/\/+$/, "")
}

function parse(input: string) {
  if (!URL.canParse(input)) throw new Error(`Invalid Kilo API URL: ${input}`)
  const url = new URL(input)
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`Invalid Kilo API URL: ${input}`)
  return url
}

function legacyRoute(raw: string, name: "gateway" | "openrouter") {
  const url = parse(raw)
  url.search = ""
  url.hash = ""
  const parts = url.pathname.split("/").filter(Boolean)
  const api = parts.lastIndexOf("api")
  const prefix = api >= 0 ? parts.slice(0, api) : parts
  url.pathname = `/${[...prefix, "api", name].join("/")}`
  return url.toString().replace(/\/+$/, "")
}

function isConfiguredBase(server: string | undefined, env: Record<string, string | undefined>): boolean {
  if (!server) return true
  const normalized = normalize(server)
  return normalized === fromEnv(env) || normalized === aiGatewayFromEnv(env)
}

// Resolves the AI gateway base URL for inference, matching `resolveKiloGatewayBaseUrl` / `resolveKiloOpenRouterBaseUrl`
// on main (`packages/kilo-gateway/src/api/url.ts`):
// - Uses `aiGatewayFromEnv(env)` (`https://ai-gateway.kilo.ai/api/v1` by default, or `${KILO_API_URL}/api/gateway/v1`,
//   or `KILO_AI_GATEWAY_URL`) when `server` is the configured base.
// - Keeps legacy API app routing (`${prefix}/api/gateway`) for custom or token-embedded server URLs.
export function gateway(server?: string, env: Record<string, string | undefined> = process.env) {
  if (isConfiguredBase(server, env)) return aiGatewayFromEnv(env)
  return legacyRoute(server!, "gateway")
}

export function openrouter(server?: string, env: Record<string, string | undefined> = process.env) {
  if (isConfiguredBase(server, env)) return aiGatewayFromEnv(env)
  return legacyRoute(server!, "openrouter")
}
