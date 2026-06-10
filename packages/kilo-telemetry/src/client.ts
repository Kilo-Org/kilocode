import { PostHog } from "posthog-node"
import { Identity } from "./identity.js"
import { TelemetryEvent } from "./events.js"

const POSTHOG_API_KEY = "phc_GK2Pxl0HPj5ZPfwhLRjXrtdz8eD7e9MKnXiFrOqnB6z"
const POSTHOG_HOST = "https://us.i.posthog.com"

function isBedrockOnly(): boolean {
  const val = process.env.BEDROCK_ONLY
  return val === "true" || val === "1"
}

export namespace Client {
  let client: PostHog | null = null
  let enabled = true

  export function init() {
    if (isBedrockOnly()) {
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
    if (isBedrockOnly()) {
      enabled = false
      return
    }
    enabled = value
    if (!client) return
    if (value) client.optIn()
    else client.optOut()
  }

  export function isEnabled(): boolean {
    if (isBedrockOnly()) return false
    return enabled && client !== null
  }

  export function capture(event: TelemetryEvent, properties?: Record<string, unknown>) {
    if (isBedrockOnly()) return
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
    if (isBedrockOnly()) return
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
    if (isBedrockOnly()) return
    if (!enabled || !client) return

    client.alias({
      distinctId,
      alias: aliasId,
    })
  }

  export async function shutdown(): Promise<void> {
    if (client) {
      await client.flush()
      await client.shutdown()
      client = null
    }
  }
}
