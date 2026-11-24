/** Privacy-safe model bucket for Auto Model preview telemetry (never carries prompt text or custom model IDs). */
export type AutoModelPreviewModelKind = "auto_efficient" | "auto_frontier" | "auto_other" | "explicit" | "unknown"

export type AutoModelPreviewClickAction = "open" | "close" | "refresh" | "retry"

export type AutoModelPreviewDataSource = "cache" | "inflight" | "network" | "none"

/**
 * Structured Auto Model preview usage event forwarded from the webview to the extension host.
 * Captures click volume, cache/dedup efficiency, and prompt-submission adoption without prompt text or PII.
 */
export type AutoModelPreviewTelemetryPayload =
  | {
      readonly kind: "clicked"
      readonly action: AutoModelPreviewClickAction
      readonly source: AutoModelPreviewDataSource
      readonly modelKind: AutoModelPreviewModelKind
      readonly promptLength: number
      readonly clicksForDraft: number
      readonly clicksTotal: number
      readonly stale: boolean
      readonly agent?: string
    }
  | {
      readonly kind: "resolved"
      readonly outcome: "success" | "error"
      readonly durationMs: number
      readonly modelKind: AutoModelPreviewModelKind
      readonly profile?: "efficient" | "frontier"
      readonly illustrative?: boolean
    }
  | {
      readonly kind: "prompt_submitted"
      readonly previewClicks: number
      readonly previewed: boolean
      readonly modelKind: AutoModelPreviewModelKind
    }
