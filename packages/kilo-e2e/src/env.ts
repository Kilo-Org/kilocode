import type { FixtureDescriptor, Origins } from "./schema"

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1"])
const SCHEMES = new Set(["http:", "https:", "ws:", "wss:"])
const AMBIENT = /^(KILO_|CLOUD_AGENT_|EVENT_SERVICE_|XDG_)/

export class OriginError extends Error {
  constructor(readonly origin: string) {
    super(`origin is not an explicit loopback origin: ${origin}`)
    this.name = "OriginError"
  }
}

export function isLoopback(origin: string): boolean {
  const parsed = URL.parse(origin)
  if (!parsed) return false
  if (!SCHEMES.has(parsed.protocol)) return false
  const host = parsed.hostname.replace(/^\[/, "").replace(/\]$/, "")
  return LOOPBACK.has(host)
}

export function assertLoopbackOrigins(origins: Origins): void {
  for (const [name, origin] of Object.entries(origins)) {
    if (origin === undefined) continue
    if (!isLoopback(origin)) throw new OriginError(`${name}=${origin}`)
  }
}

function base(extra: Record<string, string | undefined>) {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue
    if (AMBIENT.test(key)) continue
    env[key] = value
  }
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined) env[key] = value
  }
  return env
}

export function descriptorEnv(descriptor: FixtureDescriptor): Record<string, string> {
  assertLoopbackOrigins(descriptor.origins)
  const env: Record<string, string> = {
    KILO_API_URL: descriptor.origins.web,
    KILO_WEB_APP_URL: descriptor.origins.web,
    CLOUD_AGENT_NEXT_BASE_URL: descriptor.origins.cloudAgent,
    KILO_API_KEY: descriptor.credentials.apiKey,
    XDG_DATA_HOME: descriptor.state.data,
    XDG_CONFIG_HOME: descriptor.state.config,
    XDG_STATE_HOME: descriptor.state.state,
    XDG_CACHE_HOME: descriptor.state.cache,
    KILO_DISABLE_AUTOUPDATE: "1",
    KILO_E2E_RUN_ID: descriptor.runId,
  }
  if (descriptor.credentials.orgId) env.KILO_ORG_ID = descriptor.credentials.orgId
  if (descriptor.origins.gateway) env.KILO_AI_GATEWAY_URL = descriptor.origins.gateway
  if (descriptor.origins.sessionIngest) env.KILO_SESSION_INGEST_URL = descriptor.origins.sessionIngest
  else env.KILO_DISABLE_SESSION_INGEST = "1"
  if (descriptor.origins.events) env.EVENT_SERVICE_URL = descriptor.origins.events
  else env.KILO_DISABLE_PRESENCE = "1"
  return env
}

export function providerEnv(extra: Record<string, string> = {}): Record<string, string> {
  return base(extra)
}

export function driverEnv(descriptor: FixtureDescriptor, extra: Record<string, string> = {}): Record<string, string> {
  return base({ ...descriptorEnv(descriptor), ...extra })
}
