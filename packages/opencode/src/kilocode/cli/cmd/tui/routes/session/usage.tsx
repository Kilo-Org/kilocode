import type { RGBA } from "@opentui/core"
import { createMemo, createSignal, onCleanup, onMount, Show } from "solid-js"
import { UsageRow } from "@/kilocode/plugins/sidebar-usage-row"
import {
  aggregateMetrics,
  formatPP,
  formatTG,
  hasMetrics,
  type StepMetrics,
} from "@/kilocode/plugins/model-usage"

export namespace SessionUsagePanel {
  export type Theme = {
    text: RGBA
    textMuted: RGBA
  }

  export type EventPayload = {
    sessionID?: string
    part?: { type?: string; metrics?: unknown; tokens?: unknown }
  }

  export type Deps = {
    sessionID: string
    theme: Theme
    onPartUpdated?: (handler: (sessionID: string, part: EventPayload["part"]) => void) => () => void
  }

  type Sample = { metrics?: StepMetrics; generated: number }

  function isMetrics(value: unknown): value is StepMetrics {
    if (!value || typeof value !== "object") return false
    const source = (value as Record<string, unknown>).source
    return source === "provider" || source === "computed"
  }

  function generated(value: unknown): number {
    if (!value || typeof value !== "object") return 0
    const record = value as Record<string, unknown>
    const output = typeof record.output === "number" ? record.output : 0
    const reasoning = typeof record.reasoning === "number" ? record.reasoning : 0
    return output + reasoning
  }

  /**
   * Subscribes to step-finish events for the given session and renders the
   * aggregated prompt/tokens-per-second rows when at least one step has
   * reported metrics. The row hides opportunistically for providers that
   * never surface timing metadata (Anthropic, OpenAI, Gemini).
   */
  export function View(props: Deps) {
    const [samples, setSamples] = createSignal<Sample[]>([])
    const throughput = createMemo(() => aggregateMetrics(samples()))

    onMount(() => {
      if (!props.onPartUpdated) return
      const off = props.onPartUpdated((sessionID, part) => {
        if (sessionID !== props.sessionID) return
        if (part?.type !== "step-finish") return
        const metrics = isMetrics(part.metrics) ? part.metrics : undefined
        const weight = generated(part.tokens)
        setSamples((current) => [...current, { ...(metrics ? { metrics } : {}), generated: weight }])
      })
      onCleanup(() => off())
    })

    return (
      <Show when={hasMetrics(throughput())}>
        <UsageRow label="PP" value={formatPP(throughput().prompt)} color={props.theme.textMuted} />
        <UsageRow label="TG" value={formatTG(throughput().generation)} color={props.theme.textMuted} />
      </Show>
    )
  }
}