/**
 * The three gateway values this engine actually consumes, ported verbatim from
 * Kilo `origin/main@ecccd1f54b62f9bb16e53a2a58b32bb6d98d0fd7`:
 * `packages/kilo-gateway/src/api/constants.ts`, `src/api/url.ts`,
 * `src/auth/token.ts`, and `src/headers.ts`.
 *
 * v1 imported them from `@kilocode/kilo-gateway`. The v2 counterpart
 * `@kilocode/gateway` has no public equivalent: its single export map entry
 * (`.` to `src/index.ts`) exposes `deviceAuth`, `fetchProfile`,
 * `defaultOrganizationID`, `serverUrl`, `createGatewayPlugin`,
 * `registerGateway`, and `registerSessions` only. There are no header helpers,
 * and `serverUrl` only validates and trims a base URL — it does not read
 * `KILO_API_URL`, honor a token-encoded URL prefix, or append the
 * `/api/gateway/` route, and it rejects non-loopback HTTP plus any query or
 * fragment that v1 strips. Reusing it here would change embedder behavior.
 *
 * Divergence to retire: when `@kilocode/gateway` publishes a gateway-URL and
 * request-header surface, delete this module and import from it.
 */
export const HEADER_ORGANIZATIONID = "X-KILOCODE-ORGANIZATIONID"
export const HEADER_FEATURE = "X-KILOCODE-FEATURE"

const DEFAULT_KILO_API_URL = "https://api.kilo.ai"
const USER_AGENT_BASE = "opencode-kilo-provider"
const CONTENT_TYPE = "application/json"
const ENV_KILO_API_URL = "KILO_API_URL"
const ENV_VERSION = "KILOCODE_VERSION"

export const KILO_API_BASE = process.env[ENV_KILO_API_URL] || DEFAULT_KILO_API_URL

type UrlOptions = {
  baseURL?: string
  token?: string
}

/** Some Kilo tokens carry an encoded base URL prefix. */
export function getKiloUrlFromToken(defaultUrl: string, token: string): string {
  if (!token) return defaultUrl

  const match = token.match(/^(https?:\/\/[^:]+(?::\d+)?(?:\/[^:]*)?):/)
  if (!match) return defaultUrl

  try {
    return new URL(match[1]!).toString().replace(/\/+$/, "")
  } catch {
    return defaultUrl
  }
}

export function resolveKiloGatewayBaseUrl(options: UrlOptions = {}): string {
  const url = new URL(getKiloUrlFromToken(options.baseURL ?? KILO_API_BASE, options.token ?? ""))
  const parts = url.pathname.replace(/\/+$/, "").split("/").filter(Boolean)
  const api = parts.lastIndexOf("api")
  url.pathname = `/${[...(api >= 0 ? parts.slice(0, api) : parts), "api", "gateway"].join("/")}/`
  url.search = ""
  url.hash = ""
  return url.toString()
}

function getUserAgent(): string {
  const version = process.env[ENV_VERSION]
  return version ? `${USER_AGENT_BASE}/${version}` : USER_AGENT_BASE
}

export function getDefaultHeaders(): Record<string, string> {
  return {
    "User-Agent": getUserAgent(),
    "Content-Type": CONTENT_TYPE,
  }
}
