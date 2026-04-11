import { PostHog } from "posthog-node"
import { Identity } from "./identity.js"
import { TelemetryEvent } from "./events.js"

const POSTHOG_API_KEY = process.env.DEVIL_POSTHOG_API_KEY ?? ""
const POSTHOG_HOST = process.env.DEVIL_POSTHOG_HOST ?? "https://us.i.posthog.com"

export namespace Client {
  let client: PostHog | null = null
  let enabled = true

  export function init() {
    if (!POSTHOG_API_KEY) {
      console.warn("[Telemetry] PostHog API key not configured, telemetry disabled")
      enabled = false
      return
    }
    client = new PostHog(POSTHOG_API_KEY, {
      host: POSTHOG_HOST,
      disableGeoip: false,
    })
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
        ...(orgId && { devilcodeOrganizationId: orgId }),
      },
    })
  }

  export function identify(distinctId: string, properties?: Record<string, unknown>) {
    if (!enabled || !client) return

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

    client.alias({
      distinctId,
      alias: aliasId,
    })
  }

  export async function shutdown(): Promise<void> {
    if (client) {
      // Flush any pending events before shutdown
      await client.flush()
      await client.shutdown()
      client = null
    }
  }
}
