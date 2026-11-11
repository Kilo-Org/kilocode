import { createEffect, createMemo, createSignal, on, onCleanup, Show } from "solid-js"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import type { SessionMessageAssistantReasoning } from "@opencode/client"
import { useI18n } from "../context/i18n"
import { Collapsible } from "./collapsible"
import { Icon } from "./icon"
import { Markdown } from "./markdown"
import { reasoningHeading, reasoningSummary } from "./reasoning-heading"
import { reasoningOpenState, type ReasoningDisplay } from "./reasoning-open"
import { createSmoothText, useCollapsible } from "./tool-utils"

// A line glides into view within this time, however slowly the stream arrives.
const GLIDE_MAX_MS = 200

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
  const display = createSmoothText(
    () => props.item.text.replace("[REDACTED]", "").trim(),
    () => !done(),
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
  const [mounted, setMounted] = createSignal(start)
  createEffect(() => {
    if (open()) setMounted(true)
  })
  useCollapsible({ content, body: frame, open, defer: true })
  // While the capped preview streams, its content is anchored to the bottom of the box (see message-part.css) and
  // never scrolls. Each new line is placed where it belongs at once and then glides up from below with a transform
  // animation. The compositor runs that animation, so the motion stays smooth even when the main thread is busy,
  // and its speed follows how fast lines arrive, so a steady stream moves at a steady pace.
  const [follow, setFollow] = createSignal(true)
  const following = () => capped() && !done() && !manual() && follow()
  const [pinned, setPinned] = createSignal(following())
  const glide = { height: 0, grown: 0, rate: 0, offset: 0, duration: 0, anim: undefined as Animation | undefined }
  const remaining = () => {
    const anim = glide.anim
    if (!anim || anim.playState !== "running") return 0
    return glide.offset * Math.max(0, 1 - Number(anim.currentTime ?? 0) / glide.duration)
  }
  const unpin = (wait: boolean) => {
    const finish = () => {
      if (following()) return
      glide.anim?.cancel()
      glide.anim = undefined
      setPinned(false)
      // The box is a scroll viewport again; rest it at the end, where the anchored content was.
      const node = viewport()
      if (node) node.scrollTop = node.scrollHeight
    }
    const anim = glide.anim
    if (wait && anim && anim.playState === "running") return void anim.finished.then(finish, finish)
    finish()
  }
  createEffect(
    on(following, (value) => {
      if (!value) return unpin(follow())
      glide.height = body()?.offsetHeight ?? 0
      glide.grown = 0
      glide.rate = 0
      setPinned(true)
    }),
  )
  createResizeObserver(body, (rect) => {
    const node = viewport()
    const el = body()
    if (!capped() || !node || !el) return
    if (!pinned()) {
      if (done() && follow()) node.scrollTop = node.scrollHeight
      return
    }
    if (!glide.height) {
      glide.height = rect.height
      return
    }
    const delta = rect.height - glide.height
    glide.height = rect.height
    // Until the content outgrows the box, the box itself grows and nothing needs to move. Overflow above an
    // anchored box is not scrollable, so `scrollHeight` cannot tell; the box reaching its cap can.
    if (delta <= 0 || node.offsetHeight < parseFloat(getComputedStyle(node).maxHeight) - 0.5) return
    const now = performance.now()
    const gap = glide.grown ? Math.min(500, Math.max(8, now - glide.grown)) : 0
    glide.grown = now
    if (gap) glide.rate = glide.rate ? glide.rate * 0.9 + (delta / gap) * 0.1 : delta / gap
    const offset = Math.min(node.clientHeight, remaining() + delta)
    // The measured growth rate keeps the pace steady; the pull drains what is left of a burst.
    const speed = glide.rate + offset / GLIDE_MAX_MS
    glide.offset = offset
    glide.duration = offset / speed
    glide.anim?.cancel()
    glide.anim = el.animate([{ transform: `translateY(${offset}px)` }, { transform: "none" }], {
      duration: glide.duration,
      easing: "linear",
    })
    // Start on this frame's clock instead of pending until the next one, so a glide that is replaced every frame
    // still advances and `remaining` reads where it really is.
    glide.anim.startTime = document.timeline.currentTime
  })
  onCleanup(() => glide.anim?.cancel())
  return (
    <Show when={view().title || view().body}>
      <div
        data-component="reasoning-part"
        data-streaming={!done() ? "" : undefined}
        data-auto-collapse={capped() ? "" : undefined}
        data-headline={headline() ? "" : undefined}
        data-manual={manual() ? "" : undefined}
        data-follow={pinned() ? "" : undefined}
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
                    // The anchored preview cannot scroll, so a wheel or a touch up hands it back to the user as a normal
                    // scroll viewport. Scrolling back to the end anchors it again.
                    onScroll={(event) => {
                      if (follow() || done()) return
                      const node = event.currentTarget
                      if (node.scrollHeight - node.clientHeight - node.scrollTop < 10) setFollow(true)
                    }}
                    onWheel={(event) => {
                      if (event.deltaY < 0) setFollow(false)
                    }}
                    onTouchStart={() => setFollow(false)}
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
