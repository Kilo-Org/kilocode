/**
 * Background agents in the session dock.
 *
 * The dock is the one row between the transcript and the composer. It shows the working spinner while the main agent
 * runs and the session actions when it is idle. Background agents can outlive the main agent's turn, so their status
 * must read in both states: this stack leads the working spinner and the actions row alike, and stands alone when a
 * surface has no actions.
 *
 * The stack shows every background agent of the session the user did not clear: active ones, and finished ones dimmed.
 * Finished agents stay across follow-up messages and when the user comes back to the session, until the user clears
 * them. A click opens a panel at the stack to open, stop, or stop all agents, and to clear finished ones. Active agents
 * come first and carry the actions. Finished ones sit below, the latest first, with their final status.
 *
 * It appears after a short delay, so a session switch that reloads the agents does not make it flicker.
 */

import {
  type Accessor,
  type Component,
  type ComponentProps,
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
  untrack,
} from "solid-js"
import { AgentAvatar } from "@kilocode/kilo-ui/agent-avatar"
import { Button } from "@kilocode/kilo-ui/button"
import { Icon } from "@kilocode/kilo-ui/icon"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Popover } from "@kilocode/kilo-ui/popover"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { useLanguage } from "../../context/language"
import { mergePromptAgents, type BackgroundAgent, type PromptAgent } from "./background-agents"

const DELAY = 400
// A removed avatar collapses over this span, then leaves the DOM.
const LEAVE = 280
const MAX = 3

/** Running, or waiting on a permission or question: the agent still needs the user or the model. */
const busy = (agent: BackgroundAgent) => agent.status === "running" || agent.waiting

export type AgentStackInput = {
  session: Accessor<string | undefined>
  /** The background agents of the session that the user did not clear. */
  agents: Accessor<BackgroundAgent[]>
  open?: (sessionID: string, title?: string) => void
  stop: (sessionID: string) => void
  dismiss: (ids: string[]) => void
}

export function useAgentStack(input: AgentStackInput) {
  const [items, setItems] = createSignal<PromptAgent[]>([])
  const [shown, setShown] = createSignal(false)
  const [leaving, setLeaving] = createSignal<ReadonlySet<string>>(new Set())
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  let enter: ReturnType<typeof setTimeout> | undefined

  // The list is reconciled in place, so read the fields projected into the stack: an in-place update then reruns what
  // depends on the list, while each agent keeps its store identity for keyed rows.
  const agents = createMemo(() =>
    input.agents().map((agent) => {
      void agent.status
      void agent.waiting
      void agent.description
      void agent.agent
      return agent
    }),
  )
  const live = createMemo(() => agents().filter(busy))
  // The panel holds the stack open, so it does not vanish under the pointer.
  const [hold, setHold] = createSignal(false)

  const reset = () => {
    for (const timer of timers.values()) clearTimeout(timer)
    timers.clear()
    setLeaving(new Set<string>())
    clearTimeout(enter)
    enter = undefined
    setItems([])
    setShown(false)
  }

  // Avatars keep their place. A finished agent dims in place and stays until the user clears it. A cleared agent
  // collapses, then leaves the DOM. A session switch starts over in the same effect, so the reset cannot run after
  // the new session's agents landed in the same update and leave the stack empty.
  createEffect(
    on([input.session, agents] as const, ([session, list], previous) => {
      if (previous && previous[0] !== session) reset()
      const merged = mergePromptAgents(untrack(items), live())
      const known = new Set(merged.map((item) => item.id))
      const done = list.filter((agent) => !busy(agent) && !known.has(agent.id))
      const next = [
        ...merged,
        ...done.map((agent) => ({ id: agent.id, description: agent.description, agent: agent.agent, done: true })),
      ]
      setItems(next)
      const ids = new Set(list.map((agent) => agent.id))
      for (const item of next) {
        const timer = timers.get(item.id)
        if (ids.has(item.id)) {
          clearTimeout(timer)
          timers.delete(item.id)
          if (untrack(leaving).has(item.id)) setLeaving((prev) => without(prev, item.id))
          continue
        }
        if (timer) continue
        setLeaving((prev) => new Set([...prev, item.id]))
        timers.set(
          item.id,
          setTimeout(() => {
            timers.delete(item.id)
            setLeaving((prev) => without(prev, item.id))
            setItems((prev) => prev.filter((entry) => entry.id !== item.id))
          }, LEAVE),
        )
      }
    }),
  )

  const active = createMemo(() => items().some((item) => !item.done))
  // Every avatar collapses: the stack closes with them.
  const closing = createMemo(() => items().length > 0 && items().every((item) => leaving().has(item.id)))

  createEffect(() => {
    if (items().length === 0) {
      clearTimeout(enter)
      enter = undefined
      setShown(false)
      return
    }
    if (shown() || enter) return
    enter = setTimeout(() => {
      enter = undefined
      setShown(true)
    }, DELAY)
  })

  onCleanup(reset)

  return {
    items,
    agents,
    leaving,
    shown: () => shown() || hold(),
    active,
    closing,
    hold: setHold,
    running: createMemo(() => items().filter((item) => !item.done).length),
    waiting: createMemo(() => live().some((agent) => agent.waiting)),
    open: input.open,
    stop: input.stop,
    dismiss: input.dismiss,
  }
}

export type AgentStackState = ReturnType<typeof useAgentStack>

function without(set: ReadonlySet<string>, id: string) {
  const next = new Set(set)
  next.delete(id)
  return next
}

export const AgentStack: Component<{ state: AgentStackState; label?: boolean; max?: number; rule?: boolean }> = (
  props,
) => {
  const language = useLanguage()
  // The stack opens once. The actions row can rebuild and move this node, which would replay a CSS animation, so the
  // open animation only applies until the stack is ready. Avatars that join later grow in on their own.
  const [ready, setReady] = createSignal(false)
  onMount(() => {
    const timer = setTimeout(() => setReady(true), 300)
    onCleanup(() => clearTimeout(timer))
  })

  // Avatars keep their order, so a finished one dims and collapses in place. Only when some are hidden do running
  // agents move to the front, so a finished avatar never hides a running one.
  const stack = createMemo(() => {
    const list = props.state.items()
    const max = props.max ?? MAX
    if (list.length <= max) return list
    return [...list.filter((item) => !item.done), ...list.filter((item) => item.done)].slice(0, max)
  })
  const ids = createMemo(() => stack().map((item) => item.id))
  const byId = createMemo(() => new Map(stack().map((item) => [item.id, item])))
  // A new avatar grows in only when the stack gains one. When it replaces another at the same count, it fades in and
  // the width stays.
  let size = 0
  createEffect(() => {
    size = ids().length
  })
  // One avatar shows the total count, so "3" reads as three agents. More avatars show how many are hidden, as "+7".
  const count = () => {
    const total = props.state.items().length
    if (total === stack().length) return undefined
    if (stack().length === 1) return String(total)
    return `+${total - stack().length}`
  }

  const active = createMemo(() => props.state.agents().filter(busy))
  // The latest finished agent is the one the user most likely wants to check.
  const finished = createMemo(() =>
    props.state
      .agents()
      .filter((agent) => !busy(agent))
      .toSorted((a, b) => (b.finishedAt ?? b.startedAt) - (a.finishedAt ?? a.startedAt)),
  )
  const running = createMemo(() => active().filter((agent) => agent.status === "running"))

  const summary = createMemo(() => {
    const value = active().length
    const total = props.state.agents().length
    if (value === 0) return language.t("task.backgroundAgents.finished")
    if (value === total) {
      if (value === 1) return language.t("task.backgroundAgents.running.one")
      return language.t("task.backgroundAgents.running.many", { count: String(value) })
    }
    return language.t("task.backgroundAgents.summary", { running: String(value), total: String(total) })
  })

  const name = (agent: BackgroundAgent) =>
    agent.description ?? agent.agent ?? language.t("task.backgroundAgents.untitled")
  const status = (agent: BackgroundAgent) =>
    agent.waiting
      ? language.t("task.backgroundAgents.needsInput")
      : language.t(`task.backgroundAgents.status.${agent.status}`)

  const [open, setOpen] = createSignal(false)
  createEffect(() => props.state.hold(open()))
  onCleanup(() => props.state.hold(false))
  createEffect(() => {
    if (props.state.agents().length === 0) setOpen(false)
  })

  const show = (agent: BackgroundAgent) => {
    setOpen(false)
    props.state.open?.(agent.id, agent.description)
  }
  const showAll = () => {
    setOpen(false)
    for (const agent of props.state.agents()) props.state.open?.(agent.id, agent.description)
  }
  // The same stop as the task card: only this agent and anything it started.
  const stop = (agent: BackgroundAgent) => props.state.stop(agent.id)
  const stopAll = () => running().forEach(stop)

  // Data attributes are not part of the button prop type, so they go through a plain record. Popover spreads it onto
  // its trigger button.
  const attrs = createMemo(
    () =>
      ({
        type: "button",
        "data-component": "agent-stack",
        "data-ready": ready() ? "" : undefined,
        "data-idle": props.state.closing() ? "true" : undefined,
        "data-rule": props.rule ? "" : undefined,
        "data-attention": props.state.waiting() ? "" : undefined,
        "aria-label": `${summary()}. ${language.t("prompt.agents.show")}`,
      }) as Record<string, string | undefined> as ComponentProps<"button">,
  )

  const row = (agent: BackgroundAgent) => (
    <div data-slot="agent-panel-row" data-status={agent.waiting ? "waiting" : agent.status}>
      <button
        type="button"
        data-slot="agent-panel-main"
        aria-label={`${language.t("task.backgroundAgents.open")}: ${name(agent)}`}
        disabled={!props.state.open}
        onClick={() => show(agent)}
      >
        <AgentAvatar id={agent.id} status={agent.status === "running" ? "running" : undefined} />
        <span data-slot="agent-panel-label" dir="auto">
          {name(agent)}
        </span>
        <span data-slot="agent-panel-status">{status(agent)}</span>
      </button>
      <Show when={agent.status === "running"}>
        <Tooltip value={language.t("task.backgroundAgents.cancel")} placement="top">
          <IconButton
            icon="stop"
            variant="ghost"
            size="small"
            aria-label={`${language.t("task.backgroundAgents.cancel")}: ${name(agent)}`}
            onClick={() => stop(agent)}
          />
        </Tooltip>
      </Show>
    </div>
  )

  // Popover reads its trigger again when the trigger props change. Built once here, the avatars keep their nodes, so
  // their pulse does not restart.
  const body = (
    <span data-slot="agent-stack-body">
      <span data-slot="agent-stack-avatars">
        <For each={ids()}>
          {(id) => {
            const done = () => byId().get(id)?.done ?? false
            const enter = untrack(() => (ready() ? (ids().length > size ? "grow" : "fade") : undefined))
            return (
              <span
                data-slot="agent-stack-avatar"
                data-enter={enter}
                onAnimationEnd={(event) => event.currentTarget.removeAttribute("data-enter")}
                data-done={done() ? "true" : undefined}
                data-leaving={props.state.leaving().has(id) ? "" : undefined}
              >
                <AgentAvatar id={id} status={done() ? undefined : "running"} />
              </span>
            )
          }}
        </For>
      </span>
      <Show when={count()}>
        <span data-slot="agent-stack-extra">{count()}</span>
      </Show>
      <Show when={props.label}>
        <span data-slot="agent-stack-label">{summary()}</span>
      </Show>
    </span>
  )

  return (
    <Popover
      open={open()}
      onOpenChange={setOpen}
      placement="top-start"
      gutter={6}
      class="agent-panel"
      contentLabel={summary()}
      triggerAs="button"
      triggerProps={attrs()}
      trigger={body}
    >
      <div data-slot="agent-panel">
        <div data-slot="agent-panel-header">
          <span data-slot="agent-panel-title">{summary()}</span>
          <Show when={props.state.open}>
            <Tooltip value={language.t("task.backgroundAgents.openAll")} placement="top">
              <IconButton
                icon="square-arrow-top-right"
                variant="ghost"
                size="small"
                aria-label={language.t("task.backgroundAgents.openAll")}
                onClick={showAll}
              />
            </Tooltip>
          </Show>
        </div>
        <Show when={props.state.waiting()}>
          <div data-slot="agent-panel-attention">
            <Icon name="warning" size="small" />
            <span>{language.t("task.backgroundAgents.waiting")}</span>
          </div>
        </Show>
        <Show when={active().length > 0}>
          <div data-slot="agent-panel-list">
            <For each={active()}>{row}</For>
          </div>
        </Show>
        <Show when={running().length > 1}>
          <Button variant="ghost" size="small" icon="stop" data-slot="agent-panel-stop-all" onClick={stopAll}>
            {language.t("task.backgroundAgents.stopAll", { count: String(running().length) })}
          </Button>
        </Show>
        <Show when={finished().length > 0}>
          <div data-slot="agent-panel-list" data-finished="">
            <For each={finished()}>{row}</For>
          </div>
          <Button
            variant="ghost"
            size="small"
            data-slot="agent-panel-clear"
            onClick={() => props.state.dismiss(finished().map((agent) => agent.id))}
          >
            {language.t("task.backgroundAgents.clearFinished")}
          </Button>
        </Show>
      </div>
    </Popover>
  )
}
