/**
 * ContextProgress — three-segment progress bar showing context window usage.
 *
 * Segments:
 *   1. Used tokens (foreground color, turns red when >= 50%)
 *   2. Reserved for output (medium gray)
 *   3. Available (transparent / background)
 *
 * Token counts flanking the bar: used on left, total on right.
 */

import { Component, createMemo, Show } from "solid-js"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { useSession } from "../../context/session"
import { useProvider } from "../../context/provider"

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

export const ContextProgress: Component = () => {
  const session = useSession()
  const provider = useProvider()

  const data = createMemo(() => {
    const usage = session.contextUsage()
    if (!usage || usage.tokens === 0) return undefined

    const sel = session.selected()
    const model = sel ? provider.findModel(sel) : undefined
    const limit = model?.limit?.context ?? model?.contextLength ?? 0
    const output = model?.limit?.output ?? 0

    if (limit === 0) return undefined

    const used = Math.min(usage.tokens, limit)
    const reserved = Math.min(output, limit - used)
    const available = Math.max(0, limit - used - reserved)

    const pctUsed = (used / limit) * 100
    const pctReserved = (reserved / limit) * 100
    const pctAvail = (available / limit) * 100

    return { used, reserved, available, limit, pctUsed, pctReserved, pctAvail, output }
  })

  const tip = createMemo(() => {
    const d = data()
    if (!d) return ""
    const lines = [`${fmt(d.used)} / ${fmt(d.limit)} tokens used`]
    if (d.output > 0) lines.push(`${fmt(d.output)} reserved for output`)
    if (d.available > 0) lines.push(`${fmt(d.available)} available`)
    return lines.join("\n")
  })

  return (
    <Show when={data()}>
      {(d) => (
        <div class="context-progress">
          <span class="context-progress-count">{fmt(d().used)}</span>
          <Tooltip value={tip()} placement="top">
            <div class="context-progress-bar">
              <div
                class="context-progress-used"
                classList={{ "context-progress-used--hot": d().pctUsed >= 50 }}
                style={{ width: `${d().pctUsed}%` }}
              />
              <div class="context-progress-reserved" style={{ width: `${d().pctReserved}%` }} />
              <Show when={d().pctAvail > 0}>
                <div class="context-progress-available" style={{ width: `${d().pctAvail}%` }} />
              </Show>
            </div>
          </Tooltip>
          <span class="context-progress-count">{fmt(d().limit)}</span>
        </div>
      )}
    </Show>
  )
}
