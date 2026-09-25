import { TelemetryEventName } from "./types"

const FAILURE_SAMPLE_RATE = 0.1

/**
 * Build the merged properties object for a telemetry event.
 * Provider properties are included first so event-specific properties can override them.
 * Retain 10% of autocomplete failures, tagging the rate for weighted reporting.
 * Return null for dropped events so no request reaches the CLI or PostHog.
 */
export function buildTelemetryPayload(
  event: string,
  properties: Record<string, unknown> | undefined,
  providerProperties: Record<string, unknown> | undefined,
): { event: string; properties: Record<string, unknown> } | null {
  const sampled = event === TelemetryEventName.AUTOCOMPLETE_LLM_REQUEST_FAILED
  if (sampled && Math.random() >= FAILURE_SAMPLE_RATE) return null

  return {
    event,
    properties: {
      ...providerProperties,
      ...properties,
      ...(sampled && { autocomplete_failure_sample_rate: FAILURE_SAMPLE_RATE }),
    },
  }
}

/**
 * Build the Authorization header value for the telemetry endpoint.
 */
export function buildTelemetryAuthHeader(password: string): string {
  return `Basic ${Buffer.from(`kilo:${password}`).toString("base64")}`
}
