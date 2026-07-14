/** @jsxImportSource solid-js */
/**
 * Horizontal session activity timeline rendered as color-grouped SVG paths.
 * Pointer and keyboard interaction use the same pure bar geometry.
 */

import { Component, For, Show, Switch, Match, createMemo, createEffect, createSignal, on, onCleanup } from "solid-js"
import { Portal } from "solid-js/web"
import type { AssistantMessage as SDKAssistantMessage, Part as SDKPart } from "@kilocode/sdk/v2"
import { Dialog } from "@kilocode/kilo-ui/dialog"
import { useDialog } from "@kilocode/kilo-ui/context/dialog"
import { useSession } from "../../context/session"
import { visibleParts } from "../../context/session-queue"
import { color, label } from "../../utils/timeline/colors"
import { geometry, hit, navigate } from "../../utils/timeline/geometry"
import { dispatchTimelineHighlight, same, type TimelineHighlight } from "../../utils/timeline/highlight"
import { sizes, pinned, MAX_HEIGHT, DIVIDER_W } from "../../utils/timeline/sizes"
import { isRenderable } from "../../utils/transcript-parts"
import type { Part, Message, StepStartPart, StepFinishPart, ToolPart, TextPart, ReasoningPart } from "../../types/messages"

export interface TimelineBar {
  bg: string
  tip: string
  width: number
  height: number
  idx: number
  msgId: string
  partId: string
  type?: string
  divider?: boolean
}

// ── Steps (for the detail dialog) ────────────────────────────────────

export interface TimelineStep {
  index: number
  start?: StepStartPart
  finish?: StepFinishPart
  parts: Part[]
}

function buildSteps(messages: Message[], parts: Record<string, Part[]>): TimelineStep[] {
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
      } else if (p.type === "step-finish") {
        if (!current) current = { index: steps.length, parts: [] }
        current.finish = p
      } else {
        if (!current) current = { index: steps.length, parts: [] }
        current.parts.push(p)
      }
    }
  }
  if (current) steps.push(current)
  return steps
}

function stepForPart(steps: TimelineStep[], partId: string): TimelineStep | undefined {
  return steps.find(
    (s) => s.parts.some((p) => p.id === partId) || s.finish?.id === partId || s.start?.id === partId,
  )
}

// Insert a divider after every step-finish bar; its height matches the tallest bar.
function withDividers(bars: TimelineBar[]): TimelineBar[] {
  const tallest = bars.reduce((max, b) => Math.max(max, b.height), 0)
  const out: TimelineBar[] = []
  for (const bar of bars) {
    out.push(bar)
    if (bar.type === "step-finish") {
      out.push({
        bg: "",
        tip: "",
        width: DIVIDER_W,
        height: tallest,
        idx: -1,
        msgId: "",
        partId: "",
        type: "divider",
        divider: true,
      })
    }
  }
  return out
}

// ── Formatting ───────────────────────────────────────────────────────

function fmtTime(ms?: number): string {
  if (ms == null) return "—"
  return new Date(ms).toLocaleTimeString()
}

function fmtDuration(ms?: number): string {
  if (ms == null || ms < 0) return "—"
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}m ${s % 60}s`
}

function fmtCost(c?: number): string {
  if (c == null) return "—"
  return `$${c.toFixed(4)}`
}

function truncate(text: string, max = 400): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function collect(messages: Message[], parts: Record<string, Part[]>): TimelineBar[] {
  const result: { msg: Message; part: Part }[] = []

  for (const msg of messages) {
    if (msg.role === "user") continue
    const ps = parts[msg.id]
    if (!ps) continue
    for (const p of ps) {
      if (p.type === "step-start") continue
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
  let ref: HTMLDivElement | undefined
  let dragging = false
  let dragMoved = false
  let startX = 0
  let startScroll = 0
  const [hover, setHover] = createSignal(-1)
  const [active, setActive] = createSignal(-1)
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
  const geoBars = createMemo(() => withDividers(bars()))
  const layout = createMemo(() => geometry(geoBars(), MAX_HEIGHT))
  const items = () => layout().items
  const dialog = useDialog()
  const busy = () => session.status() === "busy"
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
    setHover(idx)
    setTip({
      text: bar.tip,
      x: Math.max(margin, Math.min(window.innerWidth - margin, rect.left + item.x - ref.scrollLeft + item.width / 2)),
      y: rect.top + MAX_HEIGHT - item.height,
    })
  }

  const pointerIndex = (e: PointerEvent) => {
    if (!ref) return -1
    const rect = ref.getBoundingClientRect()
    return hit(layout().items, e.clientX - rect.left + ref.scrollLeft)
  }

  const onPointerDown = (e: PointerEvent) => {
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
    const part = step.parts.find((p) => p.id === partId)
    dialog.show(() => <StepDetailsDialog step={step} part={part} />)
  }

  const select = (idx: number) => {
    const bar = bars()[idx]
    if (!bar || bar.divider) return
    setActive(idx)
    window.dispatchEvent(new CustomEvent("scrollToMessage", { detail: { id: bar.msgId, partId: bar.partId } }))
    showTip(idx)
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
    if (!ref) return
    const wasDragging = dragging
    dragging = false
    if (ref.hasPointerCapture(e.pointerId)) ref.releasePointerCapture(e.pointerId)
    ref.style.cursor = "grab"
    ref.style.userSelect = ""
    if (!wasDragging || dragMoved) return
    const idx = pointerIndex(e)
    select(idx)
  }

  const onWheel = (e: WheelEvent) => {
    hideTip()
    if (!ref) return
    e.preventDefault()
    ref.scrollLeft += e.deltaY || e.deltaX
  }

  const onKeyDown = (e: KeyboardEvent) => {
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
      <div class="task-timeline-outer">
        <div
          ref={ref}
          class="task-timeline"
          data-timeline-count={items().length}
          role="slider"
          tabIndex={0}
          aria-label="Session activity timeline"
          aria-keyshortcuts="ArrowLeft ArrowRight Home End Enter Space"
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
                  style={{ left: `${d.x}px`, width: `${d.width}px`, height: `${d.height}px` }}
                />
              )}
            </For>
            <Show when={hover() >= 0}>{overlay(hover())}</Show>
            <Show when={busy() && items().length > 0}>{overlay(items().length - 1, true)}</Show>
          </div>
        </div>
      </div>
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

function partTitle(part: Part): string {
  switch (part.type) {
    case "tool":
      return part.tool
    case "text":
      return "Text"
    case "reasoning":
      return "Reasoning"
    case "step-start":
      return "Step start"
    case "step-finish":
      return "Step finish"
    default:
      return part.type
  }
}

function toolDetail(tp: ToolPart) {
  const st = tp.state
  if (st.status === "completed") {
    return (
      <>
        <div class="task-timeline-detail-meta">status: completed</div>
        <pre class="task-timeline-detail-pre">{truncate(JSON.stringify(st.input ?? {}, null, 2))}</pre>
        <pre class="task-timeline-detail-pre">{truncate(st.output)}</pre>
      </>
    )
  }
  if (st.status === "error") {
    return (
      <>
        <div class="task-timeline-detail-meta">status: error</div>
        <pre class="task-timeline-detail-pre">{truncate(JSON.stringify(st.input ?? {}, null, 2))}</pre>
        <pre class="task-timeline-detail-pre">{truncate(st.error)}</pre>
      </>
    )
  }
  return <div class="task-timeline-detail-meta">status: {st.status}</div>
}

function StepPartDetails(props: { part?: Part }) {
  const part = () => props.part
  return (
    <Show when={part()}>
      {(p) => (
        <div class="task-timeline-detail-part">
          <h4>{partTitle(p())}</h4>
          <Switch>
            <Match when={p().type === "tool"}>{toolDetail(p() as ToolPart)}</Match>
            <Match when={p().type === "text"}>
              <pre class="task-timeline-detail-pre">{truncate((p() as TextPart).text)}</pre>
            </Match>
            <Match when={p().type === "reasoning"}>
              <pre class="task-timeline-detail-pre">{truncate((p() as ReasoningPart).text)}</pre>
            </Match>
            <Match when={p().type === "step-finish"}>
              <div class="task-timeline-detail-meta">Step finished</div>
            </Match>
            <Match when={p().type === "step-start"}>
              <div class="task-timeline-detail-meta">Step started</div>
            </Match>
          </Switch>
        </div>
      )}
    </Show>
  )
}

function StepDetailsDialog(props: { step: TimelineStep; part?: Part }) {
  const s = props.step
  const start = s.start?.time?.start ?? s.finish?.time?.start
  const end = s.finish?.time?.end
  const duration = start != null && end != null ? end - start : undefined
  const tokens = () => s.finish?.tokens
  const title = `Step ${s.index + 1}${s.finish?.model?.modelID ? ` · ${s.finish.model.modelID}` : ""}`
  return (
    <Dialog title={title}>
      <div class="task-timeline-detail">
        <dl class="task-timeline-detail-grid">
          <dt>Started</dt>
          <dd>{fmtTime(start)}</dd>
          <dt>Finished</dt>
          <dd>{fmtTime(end)}</dd>
          <dt>Duration</dt>
          <dd>{fmtDuration(duration)}</dd>
          <dt>Total cost</dt>
          <dd>{fmtCost(s.finish?.cost)}</dd>
        </dl>
        <Show when={tokens()}>
          {(tok) => (
            <div class="task-timeline-detail-tokens">
              tokens · in {tok().input} / out {tok().output}
              {tok().reasoning ? ` / reasoning ${tok().reasoning}` : ""}
              {tok().cache ? ` · cache ${tok().cache.read}/${tok().cache.write}` : ""}
            </div>
          )}
        </Show>
        <StepPartDetails part={props.part} />
      </div>
    </Dialog>
  )
}
