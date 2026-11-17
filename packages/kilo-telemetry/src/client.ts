export * as Client from "./client.js"

import { PostHog } from "posthog-node"
import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { Identity } from "./identity.js"

const POSTHOG_API_KEY = "phc_GK2Pxl0HPj5ZPfwhLRjXrtdz8eD7e9MKnXiFrOqnB6z"
export const POSTHOG_HOST = "https://us.i.posthog.com"

const state = {
  client: null as PostHog | null,
  enabled: true,
  directory: "",
  pending: new Set<string>(),
}

/** Create the PostHog client. `host` replaces the PostHog endpoint, for a local stand-in. */
export function init(dir = "", host = POSTHOG_HOST) {
  state.directory = dir
  state.pending.clear()
  const client = new PostHog(POSTHOG_API_KEY, {
    host,
    disableGeoip: false,
  })
  client.on("flush", (messages: { event: string; distinct_id: string; properties: { alias: string } }[]) => {
    if (!state.directory) return
    messages
      .filter((message) => message.event === "$create_alias")
      .forEach((message) => {
        // Remember the link only after a successful upload.
        const file = marker(message.distinct_id, message.properties.alias)
        try {
          writeFileSync(file, "1", { mode: 0o600 })
        } catch (err) {
          if (process.env.KILO_PRINT_LOGS) console.warn("telemetry cache write failed", err)
        }
      })
  })
  client.on("error", () => state.pending.clear())
  state.client = client
  if (!state.enabled) void client.optOut()
}

function marker(id: string, alias: string) {
  const key = createHash("sha256")
    .update(JSON.stringify([id, alias]))
    .digest("hex")
  return path.join(state.directory, `telemetry-alias-${key}`)
}

export function getClient(): PostHog | null {
  return state.client
}

export function setEnabled(value: boolean) {
  state.enabled = value
  if (!state.client) return
  void (value ? state.client.optIn() : state.client.optOut())
}

export function isEnabled(): boolean {
  return state.enabled && state.client !== null
}

export function capture(event: string, properties?: Record<string, unknown>) {
  if (!state.enabled || !state.client) return
  const orgId = Identity.getOrganizationId()
  state.client.capture({
    distinctId: Identity.getDistinctId(),
    event,
    properties: {
      ...properties,
      ...(orgId && { kilocodeOrganizationId: orgId }),
    },
  })
}

export function alias(distinctId: string, aliasId: string) {
  if (!state.enabled || !state.client) return
  const file = marker(distinctId, aliasId)
  if (state.pending.has(file)) return
  if (state.directory && linked(file)) return
  state.pending.add(file)
  state.client.alias({
    distinctId,
    alias: aliasId,
  })
}

function linked(file: string) {
  try {
    return readFileSync(file, "utf8") === "1"
  } catch (err) {
    if (process.env.KILO_PRINT_LOGS) console.warn("telemetry alias marker read failed; retrying link", err)
    return false
  }
}

export async function shutdown(timeoutMs?: number): Promise<void> {
  const client = state.client
  if (!client) return
  state.client = null
  // PostHog's shutdown drains the queue and is bounded by its timeout. An explicit flush() first is unbounded when
  // the endpoint is unreachable (offline, firewall, DNS adblock): it retries before throwing and blocks the exit.
  await client.shutdown(timeoutMs)
}

// Flush queued events in the background without blocking the caller. The unref'd timer never keeps a process alive on
// its own; shutdown() remains the authoritative, error-handled flush.
export function flushInBackground(delayMs = 300): void {
  if (!state.enabled || !state.client) return
  const timer = setTimeout(() => {
    state.client?.flush().catch((err: unknown) => {
      if (process.env.KILO_PRINT_LOGS) console.warn("telemetry background flush failed", err)
    })
  }, delayMs)
  timer.unref?.()
}
