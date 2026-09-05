export * as Telemetry from "./telemetry.js"

import { Effect, Scope } from "effect"
import manifest from "../package.json"

export interface TelemetryConfig {
  readonly enabled: boolean
  readonly endpoint?: string
  readonly headers?: string
  readonly client?: string
  readonly version?: string
  readonly channel?: string
}

export const defaultConfig: TelemetryConfig = {
  enabled: false,
  client: "kilo-cli",
  version: manifest.version,
  channel: "interactive",
}

export const SAFE_EVENT_TYPES = Object.freeze([
  "agent.updated",
  "catalog.updated",
  "command.updated",
  "config.updated",
] as const)

export type SafeEventType = (typeof SAFE_EVENT_TYPES)[number]

// Host/session/execution lifecycle names, verified to be emitted on the public
// server stream: server.connected in packages/server/src/handlers/event.ts:16,
// session.created in packages/core/src/session.ts:262, session.deleted in
// packages/core/src/session.ts:362, session.execution.* in
// packages/core/src/session/execution.ts:109-134. Only names are exported;
// payloads stay unread.
export const LIFECYCLE_EVENT_TYPES = Object.freeze([
  "server.connected",
  "session.created",
  "session.deleted",
  "session.execution.started",
  "session.execution.succeeded",
  "session.execution.failed",
  "session.execution.interrupted",
] as const)

export type LifecycleEventType = (typeof LIFECYCLE_EVENT_TYPES)[number]

export const EXPORTABLE_EVENT_TYPES = Object.freeze([...SAFE_EVENT_TYPES, ...LIFECYCLE_EVENT_TYPES])

export interface EventSubscriberClient {
  readonly event: {
    readonly subscribe: (options?: { signal?: AbortSignal }) => AsyncIterable<{ readonly type: string }>
  }
}

function parseHeaders(value?: string): Record<string, string> {
  if (!value) return {}
  return value.split(",").reduce(
    (acc, entry) => {
      const [key, ...rest] = entry.split("=")
      if (key && key.trim()) acc[key.trim()] = rest.join("=").trim()
      return acc
    },
    {} as Record<string, string>,
  )
}

function validateEndpoint(endpoint?: string): string | undefined {
  if (!endpoint || typeof endpoint !== "string") return undefined
  const trimmed = endpoint.trim()
  if (!trimmed) return undefined
  try {
    const url = new URL(trimmed)
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined
    return trimmed.replace(/\/+$/, "")
  } catch {
    return undefined
  }
}

export function resolveConfig(input?: Partial<TelemetryConfig>, env: NodeJS.ProcessEnv = process.env): TelemetryConfig {
  const explicitOptIn =
    input?.enabled === true ||
    (input?.enabled === undefined && (env.KILO_TELEMETRY_ENABLED === "1" || env.KILO_TELEMETRY_ENABLED === "true"))

  if (!explicitOptIn) return defaultConfig

  const rawEndpoint = input?.endpoint ?? env.KILO_TELEMETRY_ENDPOINT ?? env.OTEL_EXPORTER_OTLP_ENDPOINT
  const endpoint = validateEndpoint(rawEndpoint)
  if (!endpoint) return defaultConfig

  const headers = input?.headers ?? env.KILO_TELEMETRY_HEADERS ?? env.OTEL_EXPORTER_OTLP_HEADERS
  const client = input?.client ?? env.KILO_TELEMETRY_CLIENT ?? defaultConfig.client
  const version = input?.version ?? env.KILO_TELEMETRY_VERSION ?? defaultConfig.version
  const channel = input?.channel ?? env.KILO_TELEMETRY_CHANNEL ?? defaultConfig.channel

  return {
    enabled: true,
    endpoint,
    headers,
    client,
    version,
    channel,
  }
}

async function sendOtlpLog(
  endpoint: string,
  eventType: string,
  config: TelemetryConfig,
  runID: string,
  signal?: AbortSignal,
): Promise<void> {
  const nowNano = String(BigInt(Date.now()) * 1_000_000n)
  const payload = {
    resourceLogs: [
      {
        resource: {
          attributes: [
            { key: "service.name", value: { stringValue: "kilo-cli" } },
            { key: "service.version", value: { stringValue: config.version ?? manifest.version } },
            { key: "deployment.environment.name", value: { stringValue: config.channel ?? "interactive" } },
            { key: "opencode.client", value: { stringValue: config.client ?? "kilo-cli" } },
            { key: "opencode.run", value: { stringValue: runID } },
            { key: "service.instance.id", value: { stringValue: runID } },
          ],
        },
        scopeLogs: [
          {
            scope: {
              name: "kilo-cli-activity",
              version: config.version ?? manifest.version,
            },
            logRecords: [
              {
                timeUnixNano: nowNano,
                severityNumber: 9,
                severityText: "INFO",
                body: { stringValue: eventType },
                attributes: [{ key: "event.type", value: { stringValue: eventType } }],
              },
            ],
          },
        ],
      },
    ],
  }

  const headers = {
    "content-type": "application/json",
    ...parseHeaders(config.headers),
  }

  const timeoutSignal = AbortSignal.timeout(5000)
  const fetchSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal

  await fetch(`${endpoint}/v1/logs`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal: fetchSignal,
  }).catch(() => undefined)
}

export function startActivityExporter(
  client: EventSubscriberClient,
  config?: Partial<TelemetryConfig>,
  env: NodeJS.ProcessEnv = process.env,
  signal?: AbortSignal,
): { stop: () => Promise<void> } {
  const resolved = resolveConfig(config, env)
  if (!resolved.enabled || !resolved.endpoint) {
    return { stop: async () => {} }
  }

  const controller = new AbortController()
  const onExternalAbort = () => controller.abort()
  if (signal) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener("abort", onExternalAbort, { once: true })
  }

  const runID = crypto.randomUUID().slice(0, 8)
  const task = (async () => {
    try {
      for await (const event of client.event.subscribe({ signal: controller.signal })) {
        if (controller.signal.aborted) break
        if (!EXPORTABLE_EVENT_TYPES.some((type) => type === event.type)) continue
        await sendOtlpLog(resolved.endpoint!, event.type, resolved, runID, controller.signal)
      }
    } catch {
      // stream terminated or aborted
    }
  })()

  return {
    stop: async () => {
      if (signal) signal.removeEventListener("abort", onExternalAbort)
      controller.abort()
      await task
    },
  }
}

export function exportActivity(
  client: EventSubscriberClient,
  config?: Partial<TelemetryConfig>,
  env: NodeJS.ProcessEnv = process.env,
): Effect.Effect<void, never, Scope.Scope> {
  return Effect.acquireRelease(
    Effect.sync(() => startActivityExporter(client, config, env)),
    (exporter) => Effect.promise(() => exporter.stop()),
  ).pipe(Effect.asVoid)
}
