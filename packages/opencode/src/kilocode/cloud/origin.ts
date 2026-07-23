import { CloudError } from "./errors"

export const DEFAULT_CLOUD_AGENT_ORIGIN = "https://cloud-agent-next.kilosessions.ai"
export const DEFAULT_WEB_APP_ORIGIN = "https://kilo.ai"

export type ServiceOrigin = string
export type CloudEnvironment = Readonly<Record<string, string | undefined>>

export interface ParseServiceOriginOptions {
  readonly allowHttpLoopback?: boolean
}

export function parseServiceOrigin(value: string, options: ParseServiceOriginOptions = {}): ServiceOrigin {
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/?#\\]+\/?$/.test(value) || value.includes("%") || /\p{Cc}/u.test(value)) {
    throw new CloudError("Service URL must contain only an origin")
  }

  const url = parse(value)
  if (
    url.username !== "" ||
    url.password !== "" ||
    url.hostname.endsWith(".") ||
    (url.pathname !== "" && url.pathname !== "/") ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new CloudError("Service URL must contain only an origin")
  }

  const secure = url.protocol === "https:"
  const loopback = options.allowHttpLoopback === true && url.protocol === "http:" && isLoopback(url.hostname)
  if (!secure && !loopback) {
    throw new CloudError("Service URL must use HTTPS unless it is an explicit loopback override")
  }

  return url.origin
}

export function resolveCloudAgentOrigin(env: CloudEnvironment = process.env) {
  const value = env.CLOUD_AGENT_NEXT_BASE_URL
  return parseServiceOrigin(value ?? DEFAULT_CLOUD_AGENT_ORIGIN, {
    allowHttpLoopback: value !== undefined,
  })
}

export function resolveWebAppOrigin(env: CloudEnvironment = process.env) {
  const value = env.KILO_WEB_APP_URL
  return parseServiceOrigin(value ?? DEFAULT_WEB_APP_ORIGIN, {
    allowHttpLoopback: value !== undefined,
  })
}

function parse(value: string) {
  try {
    return new URL(value)
  } catch {
    throw new CloudError("Service URL must be a valid origin")
  }
}

function isLoopback(host: string) {
  if (host === "localhost" || host === "[::1]") return true
  const parts = host.split(".")
  return parts.length === 4 && parts[0] === "127" && parts.every(isPart)
}

function isPart(part: string) {
  if (!/^(?:0|[1-9][0-9]{0,2})$/.test(part)) return false
  return Number(part) <= 255
}
