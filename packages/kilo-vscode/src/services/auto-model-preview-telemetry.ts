import { env } from "vscode"
import type { AutoModelPreviewTelemetryPayload } from "../shared/auto-model-preview-telemetry"

/**
 * Auto Model preview telemetry event names forwarded to the telemetry transport once registered.
 */
export const AutoModelPreviewTelemetryEvent = {
  PREVIEW_CLICKED: "Auto Model Preview Clicked",
  PREVIEW_RESOLVED: "Auto Model Preview Resolved",
  PREVIEW_PROMPT_SUBMITTED: "Auto Model Preview Prompt Submitted",
} as const

type Capture = (event: string, properties: Record<string, unknown>) => void

let transport: Capture | undefined

/**
 * Register the telemetry transport that forwards Auto Model preview events.
 * No transport exists yet; the default capture drops events after the consent check.
 * The v2 telemetry service registers this sink once its port lands (#15303).
 */
export function setAutoModelPreviewTelemetrySink(fn: Capture | undefined): void {
  transport = fn
}

function format(payload: AutoModelPreviewTelemetryPayload): {
  readonly event: string
  readonly properties: Record<string, unknown>
} {
  if (payload.kind === "clicked") {
    const { kind: _, ...properties } = payload
    return { event: AutoModelPreviewTelemetryEvent.PREVIEW_CLICKED, properties }
  }
  if (payload.kind === "resolved") {
    const { kind: _, ...properties } = payload
    return { event: AutoModelPreviewTelemetryEvent.PREVIEW_RESOLVED, properties }
  }
  const { kind: _, ...properties } = payload
  return { event: AutoModelPreviewTelemetryEvent.PREVIEW_PROMPT_SUBMITTED, properties }
}

/**
 * Emit an Auto Model preview telemetry event through the consent-gated sink.
 */
export function captureAutoModelPreviewTelemetry(
  payload: AutoModelPreviewTelemetryPayload,
  opts?: { readonly telemetryEnabled?: boolean },
): void {
  const allowed = opts?.telemetryEnabled ?? env.isTelemetryEnabled
  if (!allowed) return
  const entry = format(payload)
  transport?.(entry.event, entry.properties)
}
