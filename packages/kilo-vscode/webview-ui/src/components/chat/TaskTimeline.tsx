/** @jsxImportSource solid-js */
/**
 * Horizontal session activity timeline rendered as color-grouped SVG paths.
 * Pointer and keyboard interaction use the same pure bar geometry.
 */

import { Component, For, Show, createMemo, createEffect, createSignal, on, onCleanup } from "solid-js"
import { Portal } from "solid-js/web"
import type { AssistantMessage as SDKAssistantMessage, Part as SDKPart } from "@kilocode/sdk/v2"
import type { UiI18nParams } from "@kilocode/kilo-ui/context"
import { Dialog } from "@kilocode/kilo-ui/dialog"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { ContextMenu } from "@kilocode/kilo-ui/context-menu"
import { useDialog } from "@kilocode/kilo-ui/context/dialog"
import { useLanguage } from "../../context/language"
import { useSession } from "../../context/session"
import { visibleParts } from "../../context/session-queue"
import { color, label } from "../../utils/timeline/colors"
import { resolveMenuIndex, withDividers, type TimelineBar } from "../../utils/timeline/dividers"
import { geometry, hit, navigate } from "../../utils/timeline/geometry"
import { dispatchTimelineHighlight, same, type TimelineHighlight } from "../../utils/timeline/highlight"
import { sizes, pinned, MAX_HEIGHT, DIVIDER_W } from "../../utils/timeline/sizes"
import { isRenderable } from "../../utils/transcript-parts"
import type { Part, Message, StepStartPart, StepFinishPart } from "../../types/messages"

// ── Steps (for the detail dialog) ────────────────────────────────────

export interface TimelineStep {
  index: number
  start?: StepStartPart
  finish?: StepFinishPart
  parts: Part[]
  agent?: string
  provider?: string
  model?: string
}

function buildSteps(messages: Message[], parts: Record<string, Part[]>): TimelineStep[] {
  const fill = (step: TimelineStep, msg: Message) => {
    if (!step.agent && msg.agent) step.agent = msg.agent
    const provider = msg.model?.providerID ?? msg.providerID
    const model = msg.model?.modelID ?? msg.modelID
    if (!step.provider && provider) step.provider = provider
    if (!step.model && model) step.model = model
  }

  const steps: TimelineStep[] = []
  let current: TimelineStep | undefined

  for (const msg of messages) {
    if (msg.role === "user") continue
    const ps = parts[msg.id]
    if (!ps) continue
    for (const p of ps) {
      if (p.type === "step-start") {
        if (current) steps.push(current)
        current = { index: steps.length, start: p, parts: [] }
        fill(current, msg)
      } else if (p.type === "step-finish") {
        if (!current) current = { index: steps.length, parts: [] }
        fill(current, msg)
        current.finish = p
        if (p.model?.providerID) current.provider = p.model.providerID
        if (p.model?.modelID) current.model = p.model.modelID
      } else {
        if (!current) current = { index: steps.length, parts: [] }
        fill(current, msg)
        current.parts.push(p)
      }
    }
  }
  if (current) steps.push(current)
  return steps
}

function stepForPart(steps: TimelineStep[], partId: string): TimelineStep | undefined {
  return steps.find((s) => s.parts.some((p) => p.id === partId) || s.finish?.id === partId || s.start?.id === partId)
}

// ── Formatting ───────────────────────────────────────────────────────

function fmtTime(ms?: number): string {
  if (ms === undefined || ms === null) return "—"
  return new Date(ms).toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

function fmtDuration(ms?: number): string {
  if (ms === undefined || ms === null || ms < 0) return "—"
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}m ${s % 60}s`
}

function fmtCost(c?: number): string {
  if (c === undefined || c === null) return "—"
  return `$${c.toFixed(4)}`
}

function fmtCount(n?: number): string {
  if (n === undefined || n === null) return "0"
  return n.toLocaleString()
}

function stepTip(step: TimelineStep | undefined, t: (key: string, params?: UiI18nParams) => string): string {
  if (!step) return ""
  const out = [t("timeline.step.label", { step: step.index + 1 })]
  const start = step.start?.time?.start ?? step.finish?.time?.start
  const end = step.finish?.time?.end
  if (start !== undefined && start !== null && end !== undefined && end !== null) out.push(fmtDuration(end - start))
  if (step.finish?.cost !== undefined && step.finish?.cost !== null) out.push(fmtCost(step.finish.cost))
  if (end === undefined || end === null) out.push(t("timeline.step.inProgress"))
  return out.join(" · ")
}

function collect(messages: Message[], parts: Record<string, Part[]>): TimelineBar[] {
  const result: { msg: Message; part: Part }[] = []

  for (const msg of messages) {
    if (msg.role === "user") continue
    const ps = parts[msg.id]
    if (!ps) continue
    for (const p of ps) {
      if (p.type === "step-start" || p.type === "step-finish") continue
      result.push({ msg, part: p })
    }
  }

  const sz = sizes(result.map((item) => item.part))
  return result.map((item, i) => ({
    bg: color(item.part),
    tip: label(item.part, item.msg),
    width: sz[i]!.width,
    height: sz[i]!.height,
    idx: i,
    msgId: item.msg.id,
    partId: item.part.id,
    type: item.part.type,
  }))
}

export const TaskTimeline: Component = () => {
  const session = useSession()
  const { t } = useLanguage()
  let ref: HTMLDivElement | undefined
  let dragging = false
  let dragMoved = false
  let startX = 0
  let startScroll = 0
  let allowMenuFromLeftClick = false
  const [hover, setHover] = createSignal(-1)
  const [active, setActive] = createSignal(-1)
  const [menu, setMenu] = createSignal(-1)
  const [tip, setTip] = createSignal<{ text: string; x: number; y: number }>()

  const messages = () => session.visibleMessages()
  const allParts = () => {
    const msgs = messages()
    const revert = session.revert() ?? undefined
    const qs = session.questions()
    const result: Record<string, Part[]> = {}
    for (const m of msgs) {
      if (m.role === "user") continue
      const p = visibleParts(m.id, session.getParts(m.id), revert).filter((part) => {
        if (part.type === "step-start" || part.type === "step-finish") return true
        if (!isRenderable(part as SDKPart, m as SDKAssistantMessage)) return false
        if (part.type !== "tool" || part.tool !== "question") return true
        if (part.state.status !== "pending" && part.state.status !== "running") return true
        const call = (part as SDKPart & { callID: string }).callID
        return qs.some((item) => item.tool?.callID === call && item.tool?.messageID === m.id)
      })
      if (p.length > 0) result[m.id] = p
    }
    return result
  }

  const bars = createMemo(() => collect(messages(), allParts()))
  const steps = createMemo(() => buildSteps(messages(), allParts()))
  const ends = createMemo(() =>
    steps()
      .map((step) => step.parts[step.parts.length - 1]?.id)
      .filter((id): id is string => Boolean(id)),
  )
  const busy = () => session.status() === "busy"
  const geoBars = createMemo(() => withDividers(bars(), ends(), busy()))
  const layout = createMemo(() => geometry(geoBars(), MAX_HEIGHT))
  const items = () => layout().items
  const dialog = useDialog()
  const selected = () => {
    const idx = active()
    if (idx >= 0 && idx < items().length) return idx
    return items().length - 1
  }
  const aria = () => {
    const idx = selected()
    const bar = bars()[idx]
    if (!bar) return "No activity"
    return `Bar ${idx + 1} of ${items().length}: ${bar.tip}`
  }
  const value = () => Math.max(0, selected() + 1)

  let prev = 0
  let frame: number | undefined
  let follow = true
  const onScroll = () => {
    if (ref) follow = pinned(ref)
  }
  createEffect(
    on(
      () => items().length,
      (len) => {
        if (active() >= len) setActive(len - 1)
        if (len > prev && ref && follow && frame === undefined) {
          frame = requestAnimationFrame(() => {
            frame = undefined
            if (!ref || !follow) return
            ref.scrollLeft = ref.scrollWidth
          })
        }
        prev = len
      },
    ),
  )
  onCleanup(() => {
    if (frame !== undefined) cancelAnimationFrame(frame)
  })

  const hideTip = () => {
    setHover(-1)
    setTip(undefined)
  }

  createEffect(
    on(
      bars,
      (next, previous) => {
        const idx = hover()
        if (idx < 0 || same(previous?.[idx], next[idx])) return
        hideTip()
      },
      { defer: true },
    ),
  )

  // Highlight the chat part behind the hovered/focused bar, using its own
  // color, so it's easy to follow which bar belongs to which tool call.
  createEffect<TimelineHighlight | undefined>((previous) => {
    const idx = hover()
    const bar = idx >= 0 ? bars()[idx] : undefined
    const next = bar ? { msgId: bar.msgId, partId: bar.partId } : undefined
    if (same(previous, next)) return previous
    dispatchTimelineHighlight(next)
    return next
  })
  onCleanup(() => dispatchTimelineHighlight(undefined))

  const showTip = (idx: number) => {
    const item = layout().items[idx]
    const bar = bars()[idx]
    if (!ref || !item || !bar) return hideTip()
    const rect = ref.getBoundingClientRect()
    const margin = Math.min(160, window.innerWidth / 2)
    const detail = stepTip(stepForPart(steps(), bar.partId), t)
    setHover(idx)
    setTip({
      text: detail ? `${bar.tip} · ${detail}` : bar.tip,
      x: Math.max(margin, Math.min(window.innerWidth - margin, rect.left + item.x - ref.scrollLeft + item.width / 2)),
      y: rect.top + MAX_HEIGHT - item.height,
    })
  }

  const pointIndex = (clientX: number) => {
    if (!ref) return -1
    const rect = ref.getBoundingClientRect()
    return hit(layout().items, clientX - rect.left + ref.scrollLeft)
  }

  const pointerIndex = (e: PointerEvent) => {
    return pointIndex(e.clientX)
  }

  const menuIndex = (clientX: number) => {
    return resolveMenuIndex(pointIndex(clientX), selected(), items().length)
  }

  const onPointerDown = (e: PointerEvent) => {
    if (e.button === 2) {
      const idx = pointerIndex(e)
      select(idx)
      return
    }
    if (e.button !== 0) return
    hideTip()
    if (!ref) return
    dragging = true
    dragMoved = false
    startX = e.clientX
    startScroll = ref.scrollLeft
    ref.setPointerCapture(e.pointerId)
    ref.style.cursor = "grabbing"
    ref.style.userSelect = "none"
  }

  const openStep = (partId: string) => {
    const step = stepForPart(steps(), partId)
    if (!step) return
    dialog.show(() => <StepDetailsDialog step={step} />)
  }

  const jump = (idx: number) => {
    const bar = bars()[idx]
    if (!bar || bar.divider) return
    setActive(idx)
    window.dispatchEvent(new CustomEvent("scrollToMessage", { detail: { id: bar.msgId, partId: bar.partId } }))
    showTip(idx)
  }

  const select = (idx: number) => {
    jump(idx)
  }

  const onContextMenu = (e: MouseEvent) => {
    if (!allowMenuFromLeftClick) {
      e.preventDefault()
      e.stopPropagation()
      return
    }
    allowMenuFromLeftClick = false
    const idx = menuIndex(e.clientX)
    setMenu(idx)
    if (idx < 0) return
    setActive(idx)
    showTip(idx)
  }

  const openMenuAt = (idx: number, x: number, y: number) => {
    if (idx < 0 || !ref) return
    allowMenuFromLeftClick = true
    ref.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        button: 2,
        buttons: 2,
      }),
    )
  }

  const openMenuForIndex = (idx: number) => {
    if (!ref) return
    const item = layout().items[idx]
    if (!item) return
    const rect = ref.getBoundingClientRect()
    openMenuAt(idx, rect.left + item.x - ref.scrollLeft + item.width / 2, rect.top + MAX_HEIGHT / 2)
  }

  const menuBar = () => {
    const idx = menu()
    if (idx < 0) return undefined
    return bars()[idx]
  }

  const goToMenuPart = () => {
    const idx = menu()
    if (idx < 0) return
    jump(idx)
  }

  const openMenuStepDetails = () => {
    const bar = menuBar()
    if (!bar) return
    openStep(bar.partId)
  }

  const onPointerMove = (e: PointerEvent) => {
    if (!ref) return
    if (!dragging) {
      const idx = pointerIndex(e)
      if (idx === hover()) return
      if (idx < 0) return hideTip()
      return showTip(idx)
    }
    if (Math.abs(e.clientX - startX) > 3) dragMoved = true
    ref.scrollLeft = startScroll - (e.clientX - startX)
  }

  const onPointerUp = (e: PointerEvent) => {
    if (e.button !== 0) return
    if (!ref) return
    const wasDragging = dragging
    dragging = false
    if (ref.hasPointerCapture(e.pointerId)) ref.releasePointerCapture(e.pointerId)
    ref.style.cursor = "grab"
    ref.style.userSelect = ""
    if (!wasDragging || dragMoved) return
    const idx = pointerIndex(e)
    openMenuAt(idx, e.clientX, e.clientY)
  }

  const onWheel = (e: WheelEvent) => {
    hideTip()
    if (!ref) return
    e.preventDefault()
    ref.scrollLeft += e.deltaY || e.deltaX
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if ((e.key === "Enter" && e.shiftKey) || e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) {
      e.preventDefault()
      openMenuForIndex(selected())
      return
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault()
      select(selected())
      return
    }
    if (!ref || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return
    e.preventDefault()
    const idx = navigate(selected(), items().length, e.key)
    setActive(idx)
    const item = layout().items[idx]
    if (!item) return
    const left = item.x
    const right = item.x + item.width
    if (left < ref.scrollLeft) ref.scrollLeft = left
    if (right > ref.scrollLeft + ref.clientWidth) ref.scrollLeft = right - ref.clientWidth
    showTip(idx)
  }

  createEffect(() => {
    const el = ref
    if (!el) return
    el.addEventListener("wheel", onWheel, { passive: false })
    onCleanup(() => el.removeEventListener("wheel", onWheel))
  })

  const overlay = (idx: number, pulse = false) => {
    const item = layout().items[idx]
    if (!item) return null
    return (
      <div
        class="task-timeline-bar"
        classList={{ "task-timeline-bar--active": pulse }}
        aria-hidden="true"
        style={{
          left: `${item.x}px`,
          width: `${item.width}px`,
          height: `${item.height}px`,
          "--timeline-color": item.bg,
        }}
      />
    )
  }

  return (
    <>
      <ContextMenu>
        <ContextMenu.Trigger as="div" style={{ display: "contents" }}>
          <div class="task-timeline-outer">
            <div
              ref={ref}
              class="task-timeline"
              data-timeline-count={items().length}
              role="slider"
              tabIndex={0}
              aria-label="Session activity timeline"
              aria-keyshortcuts="ArrowLeft ArrowRight Home End Enter Space Shift+Enter Shift+F10 ContextMenu"
              aria-valuemin={items().length > 0 ? 1 : 0}
              aria-valuemax={items().length}
              aria-valuenow={value()}
              aria-valuetext={aria()}
              style={{ height: `${MAX_HEIGHT}px` }}
              onKeyDown={onKeyDown}
              onBlur={hideTip}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onPointerLeave={hideTip}
              onScroll={onScroll}
              onContextMenu={onContextMenu}
            >
              <div class="task-timeline-content" style={{ width: `${layout().width}px`, height: `${MAX_HEIGHT}px` }}>
                <svg
                  class="task-timeline-svg"
                  width={layout().width}
                  height={MAX_HEIGHT}
                  viewBox={`0 0 ${layout().width} ${MAX_HEIGHT}`}
                  aria-hidden="true"
                >
                  <For each={layout().paths}>{(path) => <path d={path.d} fill={path.bg} />}</For>
                </svg>
                <For each={layout().dividers}>
                  {(d) => (
                    <div
                      class="task-timeline-divider"
                      aria-hidden="true"
                      style={{
                        left: `${d.x + (d.width - DIVIDER_W) / 2}px`,
                        width: `${DIVIDER_W}px`,
                        height: `${d.height}px`,
                      }}
                    />
                  )}
                </For>
                <Show when={hover() >= 0}>{overlay(hover())}</Show>
                <Show when={busy() && items().length > 0}>{overlay(items().length - 1, true)}</Show>
              </div>
            </div>
          </div>
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content class="task-timeline-menu">
            <ContextMenu.Item disabled={menu() < 0} onSelect={goToMenuPart}>
              <ContextMenu.ItemLabel>{t("timeline.menu.goToPart")}</ContextMenu.ItemLabel>
            </ContextMenu.Item>
            <ContextMenu.Item disabled={menu() < 0} onSelect={openMenuStepDetails}>
              <ContextMenu.ItemLabel>{t("timeline.menu.stepDetails")}</ContextMenu.ItemLabel>
            </ContextMenu.Item>
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu>
      <Show when={tip()}>
        {(current) => (
          <Portal>
            <div
              data-component="tooltip"
              class="task-timeline-tooltip"
              role="tooltip"
              style={{ left: `${current().x}px`, top: `${current().y}px` }}
            >
              {current().text}
            </div>
          </Portal>
        )}
      </Show>
    </>
  )
}

function StepDetailsDialog(props: { step: TimelineStep }) {
  const dialog = useDialog()
  const { t } = useLanguage()
  const s = props.step
  const step = t("timeline.step.label", { step: s.index + 1 })
  const title = t("timeline.details.title", { step })
  const start = s.start?.time?.start ?? s.finish?.time?.start
  const end = s.finish?.time?.end
  const duration = start !== undefined && start !== null && end !== undefined && end !== null ? end - start : undefined
  const tokens = () => s.finish?.tokens
  const rate = () => {
    const tok = tokens()
    const cache = tok?.cache
    if (!tok || !cache) return "-"
    const total = tok.input + cache.read
    if (total === 0) return "-"
    return `${((cache.read / total) * 100).toFixed(1)}%`
  }
  return (
    <Dialog
      title={title}
      action={<IconButton icon="close" variant="ghost" aria-label="Close" onClick={() => dialog.close()} />}
    >
      <div class="task-timeline-detail">
        <section class="task-timeline-detail-summary">
          <div class="task-timeline-detail-body task-timeline-detail-summary-body">
            <dl class="task-timeline-detail-grid">
              <dt>{t("timeline.details.agent")}</dt>
              <dd>{s.agent ?? "—"}</dd>
              <dt>{t("timeline.details.provider")}</dt>
              <dd>{s.provider ?? "—"}</dd>
              <dt>{t("timeline.details.model")}</dt>
              <dd>{s.model ?? "—"}</dd>
              <dt>{t("timeline.details.started")}</dt>
              <dd>{fmtTime(start)}</dd>
              <dt>{t("timeline.details.finished")}</dt>
              <dd>{fmtTime(end)}</dd>
              <dt>{t("timeline.details.duration")}</dt>
              <dd>{fmtDuration(duration)}</dd>
              <dt>{t("timeline.details.totalCost")}</dt>
              <dd>{fmtCost(s.finish?.cost)}</dd>
            </dl>
            <Show when={tokens()}>
              {(tok) => {
                const cache = tok().cache
                return (
                  <div class="task-timeline-detail-tokens">
                    <div class="task-timeline-detail-token-label">{t("timeline.details.tokens")}</div>
                    <div class="task-timeline-detail-token-line">
                      {t("timeline.details.tokens.summary", {
                        input: fmtCount(tok().input),
                        output: fmtCount(tok().output),
                        reasoning: fmtCount(tok().reasoning),
                      })}
                    </div>
                    <Show when={cache}>
                      <div class="task-timeline-detail-token-line">
                        {t("timeline.details.tokens.cacheSummary", {
                          read: fmtCount(cache?.read),
                          write: fmtCount(cache?.write),
                          rate: rate(),
                        })}
                      </div>
                    </Show>
                  </div>
                )
              }}
            </Show>
          </div>
        </section>
      </div>
    </Dialog>
  )
}
