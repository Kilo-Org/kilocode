/** @jsxImportSource solid-js */

/**
 * Todo progress in the session dock.
 *
 * One chip shows the todo list: a ring with one segment per item, the done
 * count, and the item the agent works on now. It trails the working spinner
 * while a turn runs and sits next to the Goal control when the session is
 * idle, so the list stays in view without a header row. A click opens the
 * full list.
 *
 * Changes animate only while the user watches them. A finished item strikes
 * through and the next one slides in, the count rolls, and its ring segment
 * pulses. When the last item finishes, the ring turns into a check with a
 * short burst, then settles. A session switch or a reload never replays any
 * of this, because the chip remounts per session and the hook only reports a
 * finish it saw happen.
 */

import {
  type Accessor,
  type Component,
  type ComponentProps,
  For,
  Index,
  Show,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
} from "solid-js"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Popover } from "@kilocode/kilo-ui/popover"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { useLanguage } from "../../../context/language"
import { useSession } from "../../../context/session"
import { target } from "../../../context/todo-revert"
import type { TodoItem } from "../../../types/messages"
import { TODO_TITLE_MAX, todoFinished, todoStats, todoVisible, type TodoStats } from "./todo-dock"

/** How long the finished state celebrates before it settles. */
const CELEBRATE = 2600
/** Segments above this count read as noise, so the ring fills continuously. */
const SEGMENTS = 12
const R = 8
const C = 2 * Math.PI * R
const EASE = "cubic-bezier(0.22, 1, 0.36, 1)"

function motion() {
  if (typeof window === "undefined") return false
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return false
  return !document.body.classList.contains("vscode-reduce-motion")
}

/** Shared todo state for every chip in the dock. */
export function useTodoDock() {
  const session = useSession()
  const stats = createMemo(() => todoStats(session.todos()))
  const last = createMemo(() => {
    const id = session.currentSessionID()
    if (!id) return undefined
    return session.getSessionToolParts(id).findLast((part) => part.tool === "todowrite")?.messageID
  })
  // A background result arrives as a synthetic user message. It does not
  // start a new run, so it must not hide a finished list.
  const result = (id: string) =>
    session.getParts(id).some((part) => part.type === "text" && part.synthetic && part.metadata?.background === true)
  const user = createMemo(() => session.messages().findLast((msg) => msg.role === "user" && !result(msg.id))?.id)
  const shown = createMemo(() => todoVisible(stats(), last(), user()))

  // Live means this session already showed a list, so a change is one the
  // user can watch. The first list of a session only appears.
  const snap = createMemo(() => ({ id: session.currentSessionID(), stats: stats() }))
  const [live, setLive] = createSignal(false)
  const [celebrate, setCelebrate] = createSignal(false)
  let timer: ReturnType<typeof setTimeout> | undefined
  createEffect(
    on(snap, (next, prev) => {
      const same = !!prev && prev.id === next.id
      if (!same || !next.stats.all) {
        clearTimeout(timer)
        setCelebrate(false)
      }
      if (same && todoFinished(prev.stats, next.stats)) {
        clearTimeout(timer)
        setCelebrate(true)
        timer = setTimeout(() => setCelebrate(false), CELEBRATE)
      }
      setLive(same && prev.stats.total > 0)
    }),
  )
  onCleanup(() => clearTimeout(timer))

  return { stats, shown, live, celebrate }
}

export type TodoDockState = ReturnType<typeof useTodoDock>

/**
 * A line that slides out as the next one slides in. `dir` is 1 when the value
 * moves forward and -1 when it moves back. A struck line draws a strike
 * through itself before it leaves.
 */
const Ticker: Component<{ value: string; live: boolean; dir: number; strike: boolean; class: string }> = (props) => {
  let key = 0
  const [lines, setLines] = createSignal([{ key, text: props.value, dir: 1, still: true, late: false }])
  const [old, setOld] = createSignal<ReadonlyMap<number, boolean>>(new Map())
  const timers = new Set<ReturnType<typeof setTimeout>>()
  onCleanup(() => timers.forEach(clearTimeout))
  createEffect(
    on(
      () => props.value,
      (text) => {
        key += 1
        const line = { key, text, dir: props.dir, still: false, late: props.strike }
        if (!props.live || !motion()) {
          setOld(new Map())
          setLines([{ ...line, still: true }])
          return
        }
        const strike = props.strike
        const gone = lines().filter((item) => !old().has(item.key))
        setOld((prev) => new Map([...prev, ...gone.map((item) => [item.key, strike] as const)]))
        setLines((prev) => [...prev, line])
        const timer = setTimeout(
          () => {
            timers.delete(timer)
            const keys = new Set(gone.map((item) => item.key))
            setLines((prev) => prev.filter((item) => !keys.has(item.key)))
            setOld((prev) => new Map([...prev].filter(([id]) => !keys.has(id))))
          },
          strike ? 560 : 340,
        )
        timers.add(timer)
      },
      { defer: true },
    ),
  )
  return (
    <span class={props.class} data-slot="todo-ticker">
      <For each={lines()}>
        {(line) => (
          <span
            data-slot="todo-line"
            dir="auto"
            data-still={line.still ? "" : undefined}
            data-late={line.late ? "" : undefined}
            data-old={old().has(line.key) ? "" : undefined}
            data-strike={old().get(line.key) ? "" : undefined}
            style={{ "--todo-dir": String(line.dir) }}
          >
            {line.text}
          </span>
        )}
      </For>
    </span>
  )
}

const Segment: Component<{ item: Accessor<TodoItem>; index: number; count: number; live: boolean }> = (props) => {
  const gap = () => (props.count > 1 ? 1.9 : 0)
  const length = () => C / props.count - gap()
  const turn = () => -90 + (props.index * 360) / props.count + (gap() / C) * 180
  let el: SVGCircleElement | undefined
  // Pulse a segment when its own item finishes, not when a replaced list puts
  // a done item in the same place.
  createEffect(
    on(
      () => [props.item().id, props.item().status] as const,
      (next, prev) => {
        if (!prev || !props.live || !el || !motion()) return
        if (next[0] !== prev[0] || next[1] !== "completed" || prev[1] === "completed") return
        el.animate(
          [
            { strokeWidth: 4.2, opacity: 0.3 },
            { strokeWidth: 2.2, opacity: 1 },
          ],
          {
            duration: 480,
            easing: EASE,
          },
        )
      },
    ),
  )
  return (
    <circle
      ref={el}
      data-slot="todo-segment"
      data-status={props.item().status}
      cx="10"
      cy="10"
      r={R}
      stroke-dasharray={`${length()} ${C}`}
      transform={`rotate(${turn()} 10 10)`}
    />
  )
}

const Ring: Component<{ stats: TodoStats; live: boolean; celebrate: boolean }> = (props) => {
  let el: HTMLSpanElement | undefined
  createEffect(
    on(
      () => props.stats.done,
      (done, prev) => {
        if (prev == null || done <= prev || !props.live || !el || !motion()) return
        const big = props.stats.all
        el.animate(
          [{ transform: "scale(1)" }, { transform: `scale(${big ? 1.25 : 1.16})` }, { transform: "scale(1)" }],
          {
            duration: big ? 460 : 340,
            easing: EASE,
          },
        )
      },
      { defer: true },
    ),
  )
  createEffect(() => {
    if (!props.celebrate || !el || !motion()) return
    burst(el)
  })
  const offset = () => C * (1 - props.stats.done / Math.max(1, props.stats.total))
  return (
    <span ref={el} data-slot="todo-ring" aria-hidden="true">
      <svg viewBox="0 0 20 20">
        <Show
          when={!props.stats.all}
          fallback={
            <>
              <circle data-slot="todo-check-bg" cx="10" cy="10" r={R} />
              <path data-slot="todo-check" d="M6.3 10.3 L8.9 12.8 L13.8 7.7" />
            </>
          }
        >
          <Show
            when={props.stats.total <= SEGMENTS}
            fallback={
              <>
                <circle data-slot="todo-track" cx="10" cy="10" r={R} />
                <circle
                  data-slot="todo-fill"
                  cx="10"
                  cy="10"
                  r={R}
                  stroke-dasharray={String(C)}
                  stroke-dashoffset={String(offset())}
                  transform="rotate(-90 10 10)"
                />
              </>
            }
          >
            <Index each={props.stats.live}>
              {(item, index) => <Segment item={item} index={index} count={props.stats.total} live={props.live} />}
            </Index>
          </Show>
        </Show>
      </svg>
    </span>
  )
}

/** A few dots burst out of the ring once. They live in the ring, so they move with it. */
function burst(el: HTMLElement) {
  const colors = ["--todo-ok", "--todo-accent", "--todo-goal", "--todo-ok", "--todo-accent"]
  for (let i = 0; i < 12; i++) {
    const dot = document.createElement("span")
    dot.setAttribute("data-slot", "todo-spark")
    dot.style.background = `var(${colors[i % colors.length]})`
    const size = 3 + (i % 3)
    dot.style.width = `${size}px`
    dot.style.height = `${size}px`
    el.appendChild(dot)
    const angle = (i / 12) * Math.PI * 2 + (i % 2 ? 0.2 : -0.1)
    const dist = 15 + (i % 4) * 4
    const x = Math.cos(angle) * dist
    const y = Math.sin(angle) * dist
    dot
      .animate(
        [
          { transform: "translate(-50%, -50%) scale(1)", opacity: 1 },
          { transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px)) scale(0.2)`, opacity: 0 },
        ],
        { duration: 700 + (i % 3) * 90, delay: 140, easing: "cubic-bezier(0.1, 0.8, 0.3, 1)", fill: "backwards" },
      )
      .finished.then(
        () => dot.remove(),
        () => dot.remove(),
      )
  }
}

interface TodoChipProps {
  state: TodoDockState
  /** The session the chip shows. A new session remounts the chip. */
  session: string
  /** Show the current item. The idle row shows the ring and count only. */
  title?: boolean
  /** Title cap in px from the dock fit. Zero hides the title. */
  width?: number
  /** False hides the count when the dock runs out of room. */
  count?: boolean
  readonly?: boolean
}

export const TodoChip: Component<TodoChipProps> = (props) => {
  const session = useSession()
  const language = useLanguage()
  const stats = () => props.state.stats()
  const celebrate = () => props.state.celebrate()
  const [open, setOpen] = createSignal(false)

  // Direction of the last change, so a step back rolls the other way.
  const [dir, setDir] = createSignal(1)
  const [strike, setStrike] = createSignal(false)
  createEffect(
    on(
      () => [stats().done, stats().active?.id] as const,
      (next, prev) => {
        if (!prev) return
        setDir(next[0] < prev[0] ? -1 : 1)
        setStrike(next[0] > prev[0])
      },
    ),
  )

  const title = () => {
    if (celebrate()) return language.t("task.todos.done")
    return stats().active?.content ?? ""
  }
  const settled = () => stats().all && !celebrate()
  const hidden = () => props.width === 0 || settled() || !title()
  const label = createMemo(() => {
    if (stats().all) return language.t("task.todos.allDone", { count: String(stats().total) })
    const value = language.t("task.todos.progress", { done: String(stats().done), total: String(stats().total) })
    const item = stats().active?.content
    return item ? `${value}: ${item}` : value
  })

  const items = () => session.todos()
  const done = (idx: number) =>
    items().at(idx)?.status === "completed"
      ? target({ messages: session.messages(), parts: session.allParts() }, idx)
      : undefined
  const revert = (idx: number) => {
    if (props.readonly || session.status() !== "idle") return
    const part = done(idx)
    if (part?.type !== "tool" || !part.messageID) return
    setOpen(false)
    session.revertSession(part.messageID, part.id)
  }

  const attrs = createMemo(
    () =>
      ({
        type: "button",
        "data-component": "todo-chip",
        "data-session": props.session,
        "data-celebrate": celebrate() ? "" : undefined,
        "data-settled": settled() ? "" : undefined,
        "aria-label": label(),
      }) as Record<string, string | undefined> as ComponentProps<"button">,
  )

  const body = (
    <span data-slot="todo-chip-body">
      <Ring stats={stats()} live={props.state.live()} celebrate={celebrate()} />
      <span data-slot="todo-chip-count" data-hidden={props.count === false ? "" : undefined}>
        <span data-slot="todo-chip-count-inner">
          <Ticker
            class="todo-chip-num"
            value={String(stats().done)}
            live={props.state.live()}
            dir={dir()}
            strike={false}
          />
          <span data-slot="todo-chip-total">/{stats().total}</span>
        </span>
      </span>
      <Show when={props.title}>
        <span
          data-slot="todo-chip-title"
          data-hidden={hidden() ? "" : undefined}
          style={{ "max-width": `${hidden() ? 0 : (props.width ?? TODO_TITLE_MAX)}px` }}
        >
          <span data-slot="todo-chip-title-inner">
            <Ticker
              class="todo-chip-text"
              value={title()}
              live={props.state.live()}
              dir={dir()}
              strike={strike() || celebrate()}
            />
          </span>
        </span>
      </Show>
    </span>
  )

  return (
    <Popover
      open={open()}
      onOpenChange={setOpen}
      placement="top-end"
      gutter={6}
      class="todo-panel"
      contentLabel={language.t("task.todos.title")}
      triggerAs="button"
      triggerProps={attrs()}
      trigger={body}
    >
      <div data-slot="todo-panel">
        <div data-slot="todo-panel-header">
          <span data-slot="todo-panel-title">{language.t("task.todos.title")}</span>
          <span data-slot="todo-panel-count">
            {stats().done}/{stats().total}
          </span>
        </div>
        <div data-slot="todo-panel-progress" aria-hidden="true">
          <span style={{ width: `${(stats().done / Math.max(1, stats().total)) * 100}%` }} />
        </div>
        <div data-slot="todo-panel-list">
          <For each={items()}>
            {(item, idx) => {
              const part = createMemo(() => (props.readonly ? undefined : done(idx())))
              const row = (
                <div
                  data-slot="todo-panel-row"
                  data-status={item.status}
                  data-revert={part() ? "" : undefined}
                  style={{ "--todo-i": String(idx()) }}
                  role={part() ? "button" : undefined}
                  tabIndex={part() ? 0 : undefined}
                  onClick={() => revert(idx())}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return
                    event.preventDefault()
                    revert(idx())
                  }}
                >
                  <span data-slot="todo-panel-icon">
                    <Show when={item.status === "completed"}>
                      <Icon name="check-small" size="small" />
                    </Show>
                    <Show when={item.status === "cancelled"}>
                      <Icon name="close-small" size="small" />
                    </Show>
                    <Show when={item.status === "in_progress"}>
                      <span data-slot="todo-panel-spin" />
                    </Show>
                    <Show when={item.status === "pending"}>
                      <span data-slot="todo-panel-open" />
                    </Show>
                  </span>
                  <span data-slot="todo-panel-text" dir="auto">
                    {item.content}
                  </span>
                </div>
              )
              return (
                <Show when={part()} fallback={row}>
                  <Tooltip value={language.t("settings.checkpoints.title")} placement="left">
                    {row}
                  </Tooltip>
                </Show>
              )
            }}
          </For>
        </div>
      </div>
    </Popover>
  )
}
