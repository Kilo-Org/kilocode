/** @jsxImportSource solid-js */

/**
 * The session dock: one row between the transcript and the composer. Every state stays mounted in the same grid cell;
 * the inactive ones are hidden and out of flow, so the row is exactly as tall as the visible state. Blocking surfaces
 * (permission or question) hide all of them.
 *
 * Background agents can keep working after the main agent's turn ends, so the agent stack leads the centered spinner
 * out of flow while a turn runs, takes a line that has room for it in the idle actions row, and keeps the row alive on
 * its own until the agents finish when the surface has no actions.
 *
 * The todo chip trails the spinner: left of the spinner is who works (background agents), right of it is progress.
 * When idle, the chip sits next to the session actions. Its title collapses before the count, so the ring always stays
 * in view.
 *
 * The board button follows the stack: what the agents say sits next to who works. The board belongs to the session,
 * so the button stays in the same place when the agents are cleared or the view reloads.
 */
import { type Component, type ComponentProps, type JSX, createEffect, createSignal, onCleanup, Show } from "solid-js"
import { WorkingIndicator } from "../shared/WorkingIndicator"
import { showsWorking } from "../shared/working-indicator-utils"
import { useTodoSource } from "../../v2/todo"
import type { BackgroundJobs } from "../../v2/background-jobs"
import { AgentStack, useAgentStack } from "./AgentStack"
import { SwarmBoardButton, useSwarmBoard } from "./SwarmBoard"
import { stackFit, stackPlace, stackWidth } from "./background-agents"
import { TodoChip, useTodoDock } from "./todo/TodoChip"
import { TODO_TITLE_MAX, todoFit, type TodoFit } from "./todo/todo-dock"

type SessionDockProps = ComponentProps<typeof WorkingIndicator> & {
  /** The open session. The todo chip reads its messages. */
  session?: string
  /** The subagent jobs of the open session, for the agent stack. */
  jobs: BackgroundJobs
  /** Opens a subagent session from the agent stack or the board. */
  onOpenSession?: (sessionID: string, title?: string) => void
  /** Idle-state content. Renders nothing when no action applies. */
  actions?: (todos: JSX.Element, agents: JSX.Element) => JSX.Element
  /** Whether idle-state content exists for this surface. */
  hasActions?: boolean
  /** True while a permission or question owns the row. */
  blocked: boolean
}

export const SessionDock: Component<SessionDockProps> = (props) => {
  const session = () => props.session
  const stack = useAgentStack({
    session,
    agents: props.jobs.agents,
    boundary: props.jobs.boundary,
    started: props.jobs.started,
    open: (id, title) => props.onOpenSession?.(id, title),
    stop: props.jobs.cancel,
    dismiss: props.jobs.dismiss,
  })
  const board = useSwarmBoard({ session, open: (id, title) => props.onOpenSession?.(id, title) })
  const todo = useTodoDock(useTodoSource(session))
  const working = () => showsWorking(props.status, props.submitting, props.blocked)
  const actions = () => !working() && !props.blocked && (props.hasActions ?? false)
  const visible = () => stack.shown()
  // The stack, the board button, or both lead the spinner.
  const front = () => visible() || board.shown()
  const agents = () => !working() && !actions() && !props.blocked && (front() || todo.shown())
  const active = () => working() || actions() || agents()
  const [fit, setFit] = createSignal<TodoFit>({ title: TODO_TITLE_MAX, count: true, compact: false })

  // The stack leads the centered spinner out of flow. The lane reserves the stack width on both sides, so the
  // spinner stays centered and the label truncates before the stack leaves the row. The avatar count depends only on
  // the dock width, so the reserve cannot feed back into it, and both states show the same stack.
  const [dock, setDock] = createSignal<HTMLDivElement>()
  const [lane, setLane] = createSignal<HTMLDivElement>()
  const [lead, setLead] = createSignal<HTMLDivElement>()
  const [trail, setTrail] = createSignal<HTMLDivElement>()
  const [max, setMax] = createSignal(1)

  createEffect(() => {
    const el = dock()
    if (!visible() || !el || typeof ResizeObserver === "undefined") return
    const count = stack.items().length
    const measure = () => setMax(stackFit((el.clientWidth - 200) / 2, count))
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    onCleanup(() => observer.disconnect())
    measure()
  })

  createEffect(() => {
    const content = lane()
    const el = lead()
    if (!working() || !content || !el || typeof ResizeObserver === "undefined") return
    const measure = () => content.style.setProperty("--session-lead", `${Math.ceil(el.offsetWidth)}px`)
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    onCleanup(() => {
      observer.disconnect()
      content.style.removeProperty("--session-lead")
    })
    measure()
  })

  // The chip trails the centered spinner out of flow. The lane reserves its width on both sides, so the spinner stays
  // centered and the label truncates before the chip leaves the row. Plan from natural widths, never the painted ones,
  // so a collapse cannot feed back into the next plan.
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

  const [room, setRoom] = createSignal(3)

  // Created once, so the actions row can rebuild around it without replaying the stack's open animation.
  const idleStack = (
    <>
      <Show when={visible()}>
        <AgentStack state={stack} max={Math.min(max(), room())} rule={!board.shown()} />
      </Show>
      <SwarmBoardButton state={board} rule active={actions()} />
    </>
  )

  // The actions row wraps. Put the stack on a line that has room for it, so it does not push an action onto a new
  // line and change the dock height. Only `order` changes, and only when the slot changes, so the observers settle
  // after one pass.
  const [idle, setIdle] = createSignal<HTMLDivElement>()

  createEffect(() => {
    const state = idle()
    if (!actions() || !visible() || !state || typeof ResizeObserver === "undefined") return
    const place = () => {
      const row = state.querySelector<HTMLElement>(".session-actions-row")
      const item = row?.querySelector<HTMLElement>(':scope > [data-component="agent-stack"]')
      if (!row || !item) return
      // The board button travels with the stack, right after it.
      const tail = row.querySelector<HTMLElement>(':scope > [data-component="board-trigger"]')
      const all = [...row.children].filter((child): child is HTMLElement => child instanceof HTMLElement)
      const kids = all.filter((child) => child !== item && child !== tail)
      // Boxes as painted, including a running glide, so a new glide starts where the eye last saw each item.
      const first = new Map(all.map((child) => [child, child.getBoundingClientRect()]))
      const gap = Number.parseFloat(getComputedStyle(row).columnGap) || 0
      const width = row.clientWidth
      // Lines from layout boxes, not painted ones: offset metrics ignore the glide transforms, so a running glide
      // cannot feed back into placement. Take the stack out of flow with `position`, not `display: none`. A forced
      // layout under `display: none` cancels the avatar pulses, so they restart and jump out of phase on every pass.
      const prev = item.style.position
      item.style.position = "absolute"
      if (tail) tail.style.position = "absolute"
      const lines: { last: number; used: number; top: number }[] = []
      kids.forEach((child, index) => {
        const line = lines.at(-1)
        // Items on one line differ by a pixel or so in height, so compare their tops with a tolerance.
        if (line && Math.abs(line.top - child.offsetTop) < child.offsetHeight / 2) {
          line.last = index
          line.used += gap + child.offsetWidth
          return
        }
        lines.push({ last: index, used: child.offsetWidth, top: child.offsetTop })
      })
      item.style.position = prev
      tail?.style.removeProperty("position")
      // The button, plus the spacing and gap that follow it.
      const extra = tail ? tail.offsetWidth + 4 + gap : 0
      // Show only as many avatars as the roomiest line can take. Plan with the target width, not the measured one,
      // which changes while it animates.
      const count = stack.items().length
      const space = Math.max(0, ...lines.map((line) => width - line.used))
      const size = Math.min(max(), stackFit(space - gap - 1 - extra, count), Math.max(1, count))
      setRoom(size)
      const slot = stackPlace(
        lines.map((line) => line.used),
        width,
        stackWidth(size, count) + gap + 1 + extra,
      )
      kids.forEach((child, index) => {
        const order = String(index * 2 + 2)
        if (child.style.order !== order) child.style.order = order
      })
      const order = slot.end ? String((lines.at(slot.line)?.last ?? 0) * 2 + 3) : "0"
      const side = slot.end ? "end" : "start"
      if (tail) {
        const next = String(Number(order) + 1)
        if (tail.style.order !== next) tail.style.order = next
        tail.dataset.place = side
      }
      if (item.style.order === order && item.dataset.place === side) return
      // The first placement happens while the stack opens, so only later moves glide.
      const moved = item.dataset.place != null
      item.style.order = order
      item.dataset.place = side
      if (moved) glide(all, first)
    }
    const resize = new ResizeObserver(place)
    const mutate = new MutationObserver(place)
    resize.observe(state)
    mutate.observe(state, { childList: true, subtree: true })
    onCleanup(() => {
      resize.disconnect()
      mutate.disconnect()
      for (const child of state.querySelectorAll<HTMLElement>(".session-actions-row > *"))
        child.style.removeProperty("order")
      state.querySelector('.session-actions-row > [data-component="board-trigger"]')?.removeAttribute("data-place")
    })
    place()
  })

  return (
    <div class="session-dock" ref={setDock} data-component="session-dock" data-active={active() ? "" : undefined}>
      <div class="session-dock-state" data-active={working() ? "" : undefined} aria-hidden={!working()}>
        <div
          class="session-working"
          ref={setLane}
          data-agents={front() ? "" : undefined}
          data-todos={todo.shown() ? "" : undefined}
        >
          <Show when={front()}>
            <div class="session-working-lead" ref={setLead}>
              <Show when={visible()}>
                <AgentStack state={stack} max={max()} rule={!board.shown()} />
              </Show>
              <SwarmBoardButton state={board} rule active={working()} />
            </div>
          </Show>
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
      <div class="session-dock-state" ref={setIdle} data-active={actions() ? "" : undefined} aria-hidden={!actions()}>
        {props.actions?.(chip(false), idleStack)}
      </div>
      <div class="session-dock-state" data-active={agents() ? "" : undefined} aria-hidden={!agents()}>
        <div class="session-agents">
          <Show when={visible()}>
            <AgentStack state={stack} label />
          </Show>
          <SwarmBoardButton state={board} active={agents()} />
          {chip(false)}
        </div>
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
/**
 * Slide items from their old boxes to their new ones after a reorder, so the stack moving to another line reads as
 * one motion instead of a jump.
 */
function glide(items: HTMLElement[], first: Map<HTMLElement, DOMRect>) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
  if (document.body.classList.contains("vscode-reduce-motion")) return
  for (const item of items) {
    const prev = first.get(item)
    if (!prev) continue
    const next = item.getBoundingClientRect()
    const x = prev.left - next.left
    const y = prev.top - next.top
    if (Math.abs(x) < 0.5 && Math.abs(y) < 0.5) continue
    item.animate([{ transform: `translate(${x}px, ${y}px)` }, { transform: "none" }], {
      duration: 260,
      easing: "cubic-bezier(0.22, 1, 0.36, 1)",
    })
  }
}
