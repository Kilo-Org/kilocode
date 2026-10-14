export * as KiloServer from "./server.js"

const DEFAULT = "https://api.kilo.ai"
const TOKEN = /^(https?:\/\/.+):.+$/

export function fromEnv(env: Record<string, string | undefined> = process.env) {
  return normalize(env.KILO_API_URL || DEFAULT)
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

export function gateway(server: string) {
  return `${normalize(server)}/api/gateway`
}
