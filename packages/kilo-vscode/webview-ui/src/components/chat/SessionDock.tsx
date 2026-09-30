/** @jsxImportSource solid-js */

/**
 * One row between the transcript and composer. Both working and action states
 * stay mounted in the same grid cell; the inactive one is hidden and out of
 * flow, so the row is exactly as tall as the visible state. Blocking surfaces
 * hide both.
 *
 * Background agents can keep working after the main agent's turn ends, so the
 * agent stack follows the same pattern as the goal: in the working state it
 * leads the spinner out of flow, as the goal badge trails it, so the spinner
 * stays centered. In the actions state it takes a line that has room for it.
 * On a surface without actions it keeps the row alive until the agents finish.
 */
import { type Component, type JSX, Show, createEffect, createSignal, onCleanup } from "solid-js"
import { useSession } from "../../context/session"
import { WorkingIndicator } from "../shared/WorkingIndicator"
import { showsWorking } from "../shared/working-indicator-utils"
import { useGoalDock } from "./goal/useGoalDock"
import { AgentStack, useAgentStack } from "./AgentStack"
import { stackFit, stackPlace, stackWidth } from "./background-agents"

interface SessionDockProps {
  /** Idle-state content. Renders nothing when no action applies. */
  actions?: (goal: () => JSX.Element, agents: JSX.Element) => JSX.Element
  /** Whether idle-state content exists for this surface. */
  hasActions?: () => boolean
  /** True while a permission, question, suggestion, or requirement owns the row. */
  blocked?: boolean
  onScrollToBottom?: () => void
  readonly?: boolean
}

export const SessionDock: Component<SessionDockProps> = (props) => {
  const session = useSession()
  const stack = useAgentStack()
  const working = () => showsWorking(session.status(), session.submitting(), !!props.blocked)
  const actions = () => !working() && !props.blocked && (props.hasActions?.() ?? false)
  const visible = () => !props.readonly && stack.shown()
  const agents = () => !working() && !actions() && !props.blocked && visible()
  const active = () => working() || actions() || agents()
  const goal = useGoalDock({
    working,
    actions,
    get readonly() {
      return props.readonly
    },
  })

  // Mirrors the goal badge: the goal trails the centered spinner and the stack
  // leads it, both out of flow. The lane reserves the stack width on both
  // sides, so the spinner stays centered and the label truncates before the
  // stack leaves the row. The avatar count depends only on the dock width, so
  // the reserve cannot feed back into it, and both states show the same stack.
  const [dock, setDock] = createSignal<HTMLDivElement>()
  const [lane, setLane] = createSignal<HTMLDivElement>()
  const [lead, setLead] = createSignal<HTMLDivElement>()
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

  const [fit, setFit] = createSignal(3)

  // Created once, so the actions row can rebuild around it without replaying
  // the stack's open animation.
  const idleStack = (
    <Show when={visible()}>
      <AgentStack state={stack} max={Math.min(max(), fit())} rule />
    </Show>
  )

  // The actions row wraps. Put the stack on a line that has room for it, so
  // it does not push an action onto a new line and change the dock height.
  // Only `order` changes, and only when the slot changes, so the observers
  // settle after one pass.
  const [idle, setIdle] = createSignal<HTMLDivElement>()

  createEffect(() => {
    const state = idle()
    if (!actions() || !visible() || !state || typeof ResizeObserver === "undefined") return
    const place = () => {
      const row = state.querySelector<HTMLElement>(".session-actions-row")
      const item = row?.querySelector<HTMLElement>(':scope > [data-component="agent-stack"]')
      if (!row || !item) return
      const all = [...row.children].filter((child): child is HTMLElement => child instanceof HTMLElement)
      const kids = all.filter((child) => child !== item)
      // Boxes as painted, including a running glide, so a new glide starts
      // where the eye last saw each item.
      const first = new Map(all.map((child) => [child, child.getBoundingClientRect()]))
      const gap = Number.parseFloat(getComputedStyle(row).columnGap) || 0
      const width = row.clientWidth
      // Lines from layout boxes, not painted ones: offset metrics ignore the
      // glide transforms, so a running glide cannot feed back into placement.
      const prev = item.style.display
      item.style.display = "none"
      const lines: { last: number; used: number; top: number }[] = []
      kids.forEach((child, index) => {
        const line = lines.at(-1)
        // Items on one line differ by a pixel or so in height, so compare
        // their tops with a tolerance.
        if (line && Math.abs(line.top - child.offsetTop) < child.offsetHeight / 2) {
          line.last = index
          line.used += gap + child.offsetWidth
          return
        }
        lines.push({ last: index, used: child.offsetWidth, top: child.offsetTop })
      })
      item.style.display = prev
      // Show only as many avatars as the roomiest line can take. Plan with the
      // target width, not the measured one, which changes while it animates.
      const count = stack.items().length
      const room = Math.max(0, ...lines.map((line) => width - line.used))
      const size = Math.min(max(), stackFit(room - gap - 1, count), Math.max(1, count))
      setFit(size)
      const slot = stackPlace(
        lines.map((line) => line.used),
        width,
        stackWidth(size, count) + gap + 1,
      )
      kids.forEach((child, index) => {
        const order = String(index * 2 + 2)
        if (child.style.order !== order) child.style.order = order
      })
      const order = slot.end ? String((lines.at(slot.line)?.last ?? 0) * 2 + 3) : "0"
      const side = slot.end ? "end" : "start"
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
    })
    place()
  })

  return (
    <div class="session-dock" ref={setDock} data-component="session-dock" data-active={active() ? "" : undefined}>
      <div class="session-dock-state" ref={goal.row} data-active={working() ? "" : undefined} aria-hidden={!working()}>
        <div
          class="session-working"
          ref={(el) => {
            goal.lane(el)
            setLane(el)
          }}
          data-goal={goal.running() ? "" : undefined}
          data-agents={visible() ? "" : undefined}
        >
          <Show when={visible()}>
            <div class="session-working-lead" ref={setLead}>
              <AgentStack state={stack} max={max()} rule />
            </div>
          </Show>
          <WorkingIndicator onScrollToBottom={props.onScrollToBottom} />
          {goal.status()}
        </div>
      </div>
      <div class="session-dock-state" ref={setIdle} data-active={actions() ? "" : undefined} aria-hidden={!actions()}>
        {props.actions?.(goal.control, idleStack)}
      </div>
      <div class="session-dock-state" data-active={agents() ? "" : undefined} aria-hidden={!agents()}>
        <div class="session-agents">
          <Show when={visible()}>
            <AgentStack state={stack} label />
          </Show>
        </div>
      </div>
    </div>
  )
}

/**
 * Slide items from their old boxes to their new ones after a reorder, so the
 * stack moving to another line reads as one motion instead of a jump.
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
