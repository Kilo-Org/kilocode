export * as KiloServer from "./server.js"

export const DEFAULT = "https://api.kilo.ai"

/** The Kilo API server: `KILO_API_URL`, or production. */
export function fromEnv(env: Record<string, string | undefined> = process.env) {
  return normalize(env.KILO_API_URL || DEFAULT)
}

/**
 * Some tokens start with the server that issued them, for example `https://host:3000:<secret>`.
 * Same rule as v1 `getKiloUrlFromToken`.
 */
export function fromToken(token: string) {
  const match = token.match(/^(https?:\/\/[^:]+(?::\d+)?(?:\/[^:]*)?):/)
  if (!match || !URL.canParse(match[1])) return undefined
  return normalize(match[1])
}

/** Removes trailing slashes, a query and a fragment. Throws for a value that is not an HTTP(S) URL. */
export function normalize(input: string) {
  const url = URL.parse(input)
  if (!url || (url.protocol !== "https:" && url.protocol !== "http:")) throw new Error(`Invalid Kilo API URL: ${input}`)
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`
}

/** Base URL of the OpenAI-compatible Gateway endpoints. */
export function gateway(server: string) {
  return `${server}/api/gateway`
}
