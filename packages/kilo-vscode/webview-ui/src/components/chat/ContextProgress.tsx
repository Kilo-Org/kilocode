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
import { formatCompactCount as fmt } from "../../utils/format"

export const ContextProgress: Component = () => {
  const session = useSession()
  const provider = useProvider()

  const model = createMemo(() => {
    const sel = session.selected()
    return sel ? provider.findModel(sel) : undefined
  })

  const limit = createMemo(() => model()?.limit?.context ?? model()?.contextLength ?? 0)

  const data = createMemo(() => {
    const usage = session.contextUsage()
    const max = limit()
    if (!usage || usage.tokens === 0 || max === 0) return undefined

    const output = model()?.limit?.output ?? 0

    const used = Math.min(usage.tokens, max)
    const reserved = Math.min(output, max - used)
    const available = Math.max(0, max - used - reserved)

    const pctUsed = (used / max) * 100
    const pctReserved = (reserved / max) * 100
    const pctAvail = (available / max) * 100

    return { used, reserved, available, limit: max, pctUsed, pctReserved, pctAvail, output }
  })

  // The skeleton is a loading state, so it shows only while a turn is running
  // and the context is not resolvable yet. The row itself is always rendered to
  // keep the header height fixed. Without a context limit the row stays empty,
  // as it did before, instead of pulsing forever.
  const pending = createMemo(() => session.status() === "busy" && limit() > 0 && !data())

  const tip = createMemo(() => {
    const d = data()
    if (!d) return ""
    const lines = [`${fmt(d.used)} / ${fmt(d.limit)} tokens used`]
    if (d.output > 0) lines.push(`${fmt(d.output)} reserved for output`)
    if (d.available > 0) lines.push(`${fmt(d.available)} available`)
    return lines.join("\n")
  })

  return (
    <Show
      when={data()}
      fallback={
        <div class="context-progress" aria-hidden="true">
          <Show when={pending()}>
            <div class="task-header-skeleton" style={{ width: "32px" }} />
            <div class="task-header-skeleton" style={{ flex: 1, height: "4px" }} />
            <div class="task-header-skeleton" style={{ width: "32px" }} />
          </Show>
        </div>
      }
    >
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
