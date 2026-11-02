/** @jsxImportSource solid-js */

/**
 * The session dock: one row between the transcript and the composer. Both the working and the action state stay
 * mounted in the same grid cell; the inactive one is hidden and out of flow, so the row is exactly as tall as the
 * visible state. Blocking surfaces (permission or question) hide both.
 *
 * The todo chip trails the centered spinner while a turn runs and sits next to the session actions when the session
 * is idle. Its title collapses before the count, so the ring always stays in view.
 */
import { type Component, type ComponentProps, type JSX, createEffect, createSignal, onCleanup, Show } from "solid-js"
import { WorkingIndicator } from "../shared/WorkingIndicator"
import { showsWorking } from "../shared/working-indicator-utils"
import { useTodoSource } from "../../v2/todo"
import { TodoChip, useTodoDock } from "./todo/TodoChip"
import { TODO_TITLE_MAX, todoFit, type TodoFit } from "./todo/todo-dock"

type SessionDockProps = ComponentProps<typeof WorkingIndicator> & {
  /** The open session. The todo chip reads its messages. */
  session?: string
  /** Idle-state content. Renders nothing when no action applies. */
  actions?: (todos: JSX.Element) => JSX.Element
  /** Whether idle-state content exists for this surface. */
  hasActions?: boolean
  /** True while a permission or question owns the row. */
  blocked: boolean
}

export const SessionDock: Component<SessionDockProps> = (props) => {
  const working = () => showsWorking(props.status, props.submitting, props.blocked)
  const actions = () => !working() && !props.blocked && (props.hasActions ?? false)
  const active = () => working() || actions()
  const todo = useTodoDock(useTodoSource(() => props.session))
  const [fit, setFit] = createSignal<TodoFit>({ title: TODO_TITLE_MAX, count: true, compact: false })

  // The chip trails the centered spinner out of flow, as the goal badge does. The lane reserves its width on both
  // sides, so the spinner stays centered and the label truncates before the chip leaves the row. Plan from natural
  // widths, never the painted ones, so a collapse cannot feed back into the next plan.
  const [dock, setDock] = createSignal<HTMLDivElement>()
  const [lane, setLane] = createSignal<HTMLDivElement>()
  const [trail, setTrail] = createSignal<HTMLDivElement>()

  createEffect(() => {
    const el = dock()
    const box = trail()
    const content = lane()
    if (!working() || !todo.shown() || !el || !box || !content || typeof ResizeObserver === "undefined") return
    // Read every value before any write, so one plan does not force a second layout, and let the observers plan at
    // most once per frame.
    let frame = 0
    const measure = () => {
      frame = 0
      const chip = box.querySelector<HTMLElement>('[data-component="todo-chip"]')
      if (!chip) return
      const css = getComputedStyle(chip)
      const edge = Number.parseFloat(css.paddingLeft) + Number.parseFloat(css.paddingRight) + 2
      const ring = chip.querySelector<HTMLElement>('[data-slot="todo-ring"]')?.offsetWidth ?? 16
      const inner = chip.querySelector<HTMLElement>('[data-slot="todo-chip-count-inner"]')
      const count = inner ? text(inner) + (Number.parseFloat(getComputedStyle(inner).paddingInlineStart) || 0) : 0
      const line = chip.querySelector<HTMLElement>('.todo-chip-text > [data-slot="todo-line"]:not([data-old])')
      const hidden = chip.hasAttribute("data-settled")
      const title = line?.textContent && !hidden ? text(line) + 6 : 0
      const reserve = Math.ceil(box.offsetWidth)
      setFit(
        todoFit({
          // A small margin absorbs subpixel rounding and the title transition.
          space: (el.clientWidth - core(content)) / 2 - 6,
          chip: ring + edge,
          count,
          title,
          gap: Number.parseFloat(getComputedStyle(box).columnGap) || 0,
        }),
      )
      content.style.setProperty("--session-trail", `${reserve}px`)
    }
    const schedule = () => {
      if (frame) return
      frame = requestAnimationFrame(measure)
    }
    const resize = new ResizeObserver(schedule)
    const mutate = new MutationObserver(schedule)
    resize.observe(el)
    resize.observe(box)
    mutate.observe(box, { childList: true, subtree: true, characterData: true })
    // The status label is a sibling of the trail. Its width sets the room, so a new label must plan again.
    const status = content.querySelector(".working-status")
    if (status) mutate.observe(status, { childList: true, subtree: true, characterData: true })
    onCleanup(() => {
      cancelAnimationFrame(frame)
      resize.disconnect()
      mutate.disconnect()
      content.style.removeProperty("--session-trail")
    })
    measure()
  })

  const chip = (title: boolean) => (
    <Show when={todo.shown()}>
      <TodoChip state={todo} title={title} width={title ? fit().title : undefined} count={title ? fit().count : true} />
    </Show>
  )

  return (
    <div class="session-dock" ref={setDock} data-component="session-dock" data-active={active() ? "" : undefined}>
      <div class="session-dock-state" data-active={working() ? "" : undefined} aria-hidden={!working()}>
        <div class="session-working" ref={setLane} data-todos={todo.shown() ? "" : undefined}>
          <WorkingIndicator
            status={props.status}
            submitting={props.submitting}
            timing={props.timing}
            text={props.text}
            retry={props.retry}
            onCancel={props.onCancel}
            onScrollToBottom={props.onScrollToBottom}
          />
          <div class="session-working-trail" ref={setTrail}>
            {chip(true)}
          </div>
        </div>
      </div>
      <div class="session-dock-state" data-active={actions() ? "" : undefined} aria-hidden={!actions()}>
        {props.actions?.(chip(false))}
      </div>
    </div>
  )
}

/**
 * The trailing group collapses before the status label truncates. A label
 * wider than this truncates first, so one long status cannot hide the todos.
 */
const LABEL_MAX = 160

/**
 * Natural width of the centered working cluster, with its label capped at
 * LABEL_MAX. The painted widths depend on the reserve this plan sets (the
 * lane squeezes the whole cluster), so every part is measured from its text
 * or its own fixed size instead.
 */
function core(lane: HTMLElement | undefined) {
  const box = lane?.querySelector<HTMLElement>(".working-indicator")
  const btn = box?.querySelector<HTMLElement>(".working-indicator-scroll")
  if (!box || !btn) return 160
  const pad = (el: HTMLElement) => {
    const css = getComputedStyle(el)
    return {
      edge: Number.parseFloat(css.paddingLeft) + Number.parseFloat(css.paddingRight),
      gap: Number.parseFloat(css.columnGap) || 0,
    }
  }
  const outer = pad(box)
  const inner = pad(btn)
  const parts = [...btn.children].filter((el) => !el.classList.contains("sr-only"))
  const widths = parts.map((el) => {
    if (el.classList.contains("working-status")) {
      const line = el.querySelector<HTMLElement>(".working-status-line:not([data-old])")
      return Math.min(line ? text(line) : 0, LABEL_MAX)
    }
    if (el instanceof HTMLElement && el.dataset.empty != null) return 0
    // The spinner has no text but a fixed size.
    if (!el.textContent) return el.getBoundingClientRect().width
    return Math.max(text(el), Number.parseFloat(getComputedStyle(el).minWidth) || 0)
  })
  const shown = widths.filter((width) => width > 0)
  const rest = [...box.children].filter((el): el is HTMLElement => el instanceof HTMLElement && el !== btn)
  const extra = rest.reduce((sum, el) => sum + el.offsetWidth + outer.gap, 0)
  return (
    outer.edge +
    inner.edge +
    shown.reduce((sum, width) => sum + width, 0) +
    inner.gap * Math.max(0, shown.length - 1) +
    extra
  )
}

/**
 * Natural width of the text in an element. A box clipped by its parent
 * reports its clipped width, so measure the text itself.
 */
function text(el: Element) {
  const range = document.createRange()
  range.selectNodeContents(el)
  return Math.ceil(range.getBoundingClientRect().width)
}