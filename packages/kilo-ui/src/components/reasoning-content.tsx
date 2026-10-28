import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import type { SessionMessageAssistantReasoning } from "@opencode/client"
import { useI18n } from "../context/i18n"
import { Collapsible } from "./collapsible"
import { Icon } from "./icon"
import { Markdown } from "./markdown"
import { reasoningHeading, reasoningSummary } from "./reasoning-heading"
import { reasoningOpenState, type ReasoningDisplay } from "./reasoning-open"
import {
  createThrottledValue,
  STREAMING_TEXT_RENDER_THROTTLE_MS,
  TEXT_RENDER_THROTTLE_MS,
  useCollapsible,
} from "./tool-utils"

const collapsed = new Set<string>()
const streamed = new Set<string>()
const opened = new Set<string>()

function remember(set: Set<string>, id: string) {
  set.delete(id)
  set.add(id)
  if (set.size <= 1000) return
  const first = set.values().next().value
  if (first !== undefined) set.delete(first)
}

export function ReasoningContent(props: {
  item: SessionMessageAssistantReasoning
  id: string
  settled?: boolean
  mode?: ReasoningDisplay
}) {
  const i18n = useI18n()
  const done = () => !!props.settled || props.item.time?.completed !== undefined
  const display = createThrottledValue(
    () => props.item.text.replace("[REDACTED]", "").trim(),
    () => (done() ? TEXT_RENDER_THROTTLE_MS : STREAMING_TEXT_RENDER_THROTTLE_MS),
  )
  const view = createMemo(() => reasoningHeading(display(), !done()))
  if (!done()) remember(streamed, props.id)
  const mode = () => props.mode ?? "expanded"
  const capped = () => mode() === "preview"
  const headline = () => mode() === "headline"
  const trackable = () => capped() || headline()
  const derive = () =>
    reasoningOpenState({
      mode: mode(),
      streamed: streamed.has(props.id),
      userOpened: opened.has(props.id),
      userCollapsed: collapsed.has(props.id),
    })
  const [open, setOpen] = createSignal(derive())
  const start = open()
  createEffect(() => {
    if (opened.has(props.id) || collapsed.has(props.id)) return
    setOpen(derive())
  })
  const [manual, setManual] = createSignal(capped() && opened.has(props.id))
  const title = () => {
    if (view().title) return view().title
    if (headline() && !open()) return reasoningSummary(view().body)
    if (!done() || open()) return ""
    return reasoningSummary(view().body)
  }
  const Header = () => (
    <div data-slot="reasoning-header">
      <Icon name="brain" size="small" />
      <span data-slot="reasoning-label">{i18n.t("ui.reasoning.label" as never)}</span>
      <Show when={title()}>{(value) => <span data-slot="reasoning-title">{value()}</span>}</Show>
    </div>
  )
  const track = (value: boolean) => {
    if (value) collapsed.delete(props.id)
    if (!value) remember(collapsed, props.id)
    if (trackable()) {
      if (value) remember(opened, props.id)
      if (!value) opened.delete(props.id)
      setManual(value)
    }
    setOpen(value)
  }
  const [content, setContent] = createSignal<HTMLDivElement>()
  const [frame, setFrame] = createSignal<HTMLDivElement>()
  const [viewport, setViewport] = createSignal<HTMLDivElement>()
  const [body, setBody] = createSignal<HTMLDivElement>()
  const scroll = { away: false, top: 0, frame: undefined as number | undefined }
  const stop = () => {
    if (scroll.frame === undefined) return
    cancelAnimationFrame(scroll.frame)
    scroll.frame = undefined
  }
  const [mounted, setMounted] = createSignal(start)
  createEffect(() => {
    if (open()) setMounted(true)
  })
  useCollapsible({ content, body: frame, open, defer: true })
  const bottom = () => {
    const node = viewport()
    return node ? Math.max(0, node.scrollHeight - node.clientHeight) : 0
  }
  const tick = () => {
    scroll.frame = undefined
    const node = viewport()
    if (done() || scroll.away || !node) return
    const rest = bottom() - node.scrollTop
    if (Math.abs(rest) < 0.5) {
      node.scrollTop = bottom()
      return
    }
    node.scrollTop += rest * 0.25
    scroll.frame = requestAnimationFrame(tick)
  }
  createResizeObserver(body, () => {
    const node = viewport()
    if (!capped() || scroll.away || !node) return
    if (!done()) {
      scroll.frame ??= requestAnimationFrame(tick)
      return
    }
    node.scrollTop = bottom()
  })
  onCleanup(stop)
  return (
    <Show when={view().title || view().body}>
      <div
        data-component="reasoning-part"
        data-streaming={!done() ? "" : undefined}
        data-auto-collapse={capped() ? "" : undefined}
        data-headline={headline() ? "" : undefined}
        data-manual={manual() ? "" : undefined}
      >
        <Show
          when={view().body || !done()}
          fallback={
            <div data-slot="collapsible-trigger" data-static="">
              <Header />
            </div>
          }
        >
          <Collapsible open={open()} onOpenChange={track} forceMount class="tool-collapsible">
            <Collapsible.Trigger>
              <Header />
              <Collapsible.Arrow />
            </Collapsible.Trigger>
            <Collapsible.Content>
              <div
                ref={setContent}
                style={{ overflow: "clip", height: start ? "auto" : "0px", display: start ? "" : "none" }}
              >
                <div ref={setFrame} data-slot="reasoning-details">
                  <div
                    data-slot="reasoning-content"
                    ref={setViewport}
                    onScroll={(event) => {
                      const node = event.currentTarget
                      if (node.scrollHeight - node.clientHeight - node.scrollTop < 10) scroll.away = false
                      if (node.scrollTop < scroll.top - 1) scroll.away = true
                      scroll.top = node.scrollTop
                    }}
                    onWheel={(event) => {
                      if (event.deltaY >= 0) return
                      scroll.away = true
                      stop()
                    }}
                  >
                    <div data-slot="reasoning-body" ref={setBody}>
                      <Show when={mounted()}>
                        <Markdown text={view().body} cacheKey={props.id} streaming={!done()} />
                      </Show>
                    </div>
                  </div>
                </div>
              </div>
            </Collapsible.Content>
          </Collapsible>
        </Show>
      </div>
    </Show>
  )
}
