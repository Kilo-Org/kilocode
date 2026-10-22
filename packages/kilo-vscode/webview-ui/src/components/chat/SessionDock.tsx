/** @jsxImportSource solid-js */

/** Working status, session actions, and todos share one dock row. */
import { type Component, type JSX, Show, createEffect, createSignal, onCleanup } from "solid-js"
import { useSession } from "../../context/session"
import { WorkingIndicator } from "../shared/WorkingIndicator"
import { showsWorking } from "../shared/working-indicator-utils"
import { TodoChip, useTodoDock } from "./todo/TodoChip"
import { TODO_TITLE_MAX, todoFit, type TodoFit } from "./todo/todo-dock"

interface SessionDockProps {
  actions?: (todos: JSX.Element) => JSX.Element
  hasActions?: () => boolean
  blocked?: boolean
  onScrollToBottom?: () => void
}

export const SessionDock: Component<SessionDockProps> = (props) => {
  const session = useSession()
  const todo = useTodoDock()
  const working = () => showsWorking(session.status(), session.submitting(), !!props.blocked)
  const actions = () => !working() && !props.blocked && (props.hasActions?.() ?? false)
  const todos = () => !working() && !actions() && !props.blocked && todo.shown()
  const active = () => working() || actions() || todos()
  const [fit, setFit] = createSignal<TodoFit>({ title: TODO_TITLE_MAX, count: true, compact: false })
  const [dock, setDock] = createSignal<HTMLDivElement>()
  const [lane, setLane] = createSignal<HTMLDivElement>()
  const [trail, setTrail] = createSignal<HTMLDivElement>()

  createEffect(() => {
    const el = dock()
    const box = trail()
    const content = lane()
    if (!working() || !todo.shown() || !el || !box || !content || typeof ResizeObserver === "undefined") return
    const measure = () => {
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
      const plan = todoFit({
        space: (el.clientWidth - core(content)) / 2 - 6,
        chip: ring + edge,
        count,
        title,
        gap: Number.parseFloat(getComputedStyle(box).columnGap) || 0,
      })
      setFit(plan)
      content.style.setProperty("--session-trail", `${reserve}px`)
    }
    let frame = 0
    const schedule = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        measure()
      })
    }
    const resize = new ResizeObserver(schedule)
    const mutate = new MutationObserver(schedule)
    resize.observe(el)
    resize.observe(box)
    mutate.observe(box, { childList: true, subtree: true, characterData: true })
    const status = lane()?.querySelector(".working-status")
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
  const idleTodo = chip(false)

  return (
    <div class="session-dock" ref={setDock} data-component="session-dock" data-active={active() ? "" : undefined}>
      <div class="session-dock-state" data-active={working() ? "" : undefined} aria-hidden={!working()}>
        <div class="session-working" ref={setLane} data-todos={todo.shown() ? "" : undefined}>
          <WorkingIndicator onScrollToBottom={props.onScrollToBottom} />
          <div class="session-working-trail" ref={setTrail}>
            {chip(true)}
          </div>
        </div>
      </div>
      <div class="session-dock-state" data-active={actions() ? "" : undefined} aria-hidden={!actions()}>
        {props.actions?.(idleTodo)}
      </div>
      <div class="session-dock-state" data-active={todos() ? "" : undefined} aria-hidden={!todos()}>
        <div class="session-agents">{chip(false)}</div>
      </div>
    </div>
  )
}

const LABEL_MAX = 160

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

function text(el: Element) {
  const range = document.createRange()
  range.selectNodeContents(el)
  return Math.ceil(range.getBoundingClientRect().width)
}
