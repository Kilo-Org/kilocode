import { PostHog } from "posthog-node"
import { Identity } from "./identity.js"
import { TelemetryEvent } from "./events.js"
import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

const POSTHOG_API_KEY = "phc_GK2Pxl0HPj5ZPfwhLRjXrtdz8eD7e9MKnXiFrOqnB6z"
const POSTHOG_HOST = "https://us.i.posthog.com"

export namespace Client {
  let client: PostHog | null = null
  let enabled = true
  let directory = ""
  const pending = new Map<string, string>()

  export function init(dataPath = "") {
    directory = dataPath
    pending.clear()
    client = new PostHog(POSTHOG_API_KEY, {
      host: POSTHOG_HOST,
      disableGeoip: false,
    })
    client.on("flush", (messages) => {
      if (!directory) return
      for (const message of messages) {
        if (message.event !== "$identify" && message.event !== "$create_alias") continue
        const [file, value] = fingerprint(message.event, message.distinct_id, message.properties)
        try {
          // Persist only successful uploads. A partial write just causes a resend.
          writeFileSync(file, value, { mode: 0o600 })
        } catch (err) {
          if (process.env.KILO_PRINT_LOGS) console.warn("telemetry cache write failed", err)
        }
      }
    })
    client.on("error", () => pending.clear())
  }

  function fingerprint(event: string, id: string, properties: Record<string, unknown>) {
    const hash = (value: unknown) =>
      createHash("sha256")
        .update(JSON.stringify(value) ?? "null")
        .digest("hex")
    const key = hash([event, id, properties.alias])
    return [
      path.join(directory, `telemetry-delivery-${key}`),
      hash(event === "$identify" ? properties.$set : properties.alias),
    ] as const
  }

  function duplicate(event: string, id: string, properties: Record<string, unknown>) {
    const [file, value] = fingerprint(event, id, properties)
    try {
      const previous = pending.get(file) ?? (directory ? readFileSync(file, "utf8") : undefined)
      if (previous === value) return true
    } catch {
      // Missing or unreadable caches must not prevent identification.
    }
    pending.set(file, value)
    return false
  }

  export function getClient(): PostHog | null {
    return client
  }

  export function setEnabled(value: boolean) {
    enabled = value
    if (!client) return
    if (value) client.optIn()
    else client.optOut()
  }

  export function isEnabled(): boolean {
    return enabled && client !== null
  }

  export function capture(event: TelemetryEvent, properties?: Record<string, unknown>) {
    if (!enabled || !client) return

    const distinctId = Identity.getDistinctId()
    const orgId = Identity.getOrganizationId()

    client.capture({
      distinctId,
      event,
      properties: {
        ...properties,
        ...(orgId && { kilocodeOrganizationId: orgId }),
      },
    })
  }

  export function identify(distinctId: string, properties?: Record<string, unknown>) {
    if (!enabled || !client) return
    if (duplicate("$identify", distinctId, { $set: properties })) return

    client.capture({
      distinctId,
      event: "$identify",
      properties: {
        $set: properties,
      },
    })
  }

  export function alias(distinctId: string, aliasId: string) {
    if (!enabled || !client) return
    if (duplicate("$create_alias", distinctId, { alias: aliasId })) return

    client.alias({
      distinctId,
      alias: aliasId,
    })
  }

  export async function shutdown(timeoutMs?: number): Promise<void> {
    if (client) {
      try {
        // PostHog's shutdown drains the queue internally and is bounded by
        // shutdownTimeoutMs. Calling flush() first is redundant and unbounded:
        // when the endpoint is unreachable (offline, firewall, DNS adblock),
        // flush retries up to 3x with 3s delays plus 10s per attempt before
        // throwing, blocking process exit before shutdown's outer cap kicks in.
        await client.shutdown(timeoutMs)
      } finally {
        client = null
      }
    }
  }

  // Flush queued events in the background without blocking the caller. The
  // flush is delayed slightly so commands that exit immediately pay only the
  // single shutdown() flush instead of an in-flight flush plus a follow-up
  // flush for CLI_EXIT. For commands that outlive the delay, the upload
  // overlaps with execution, so by the time shutdown() runs the queue is
  // usually empty (or the connection is still warm) and process exit is not
  // delayed by a network round trip. The unref'd timer never keeps a process
  // alive on its own. The authoritative, error-handled flush still happens in
  // shutdown(); failures here are retried there, so they are only surfaced
  // when debug logging is on.
  export function flushInBackground(delayMs = 300): void {
    if (!enabled || !client) return
    const timer = setTimeout(() => {
      if (!client) return
      client.flush().catch((err) => {
        if (process.env.KILO_PRINT_LOGS) console.warn("telemetry background flush failed", err)
      })
    }, delayMs)
    timer.unref?.()
  }
}
