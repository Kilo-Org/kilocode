/**
 * The agent map button in the session dock.
 *
 * The dock is the one row between the transcript and the composer. It shows
 * the working spinner while the main agent runs and the session actions when
 * it is idle. Background agents can outlive the main agent's turn, so their
 * status must read in both states: this button leads the working spinner and
 * the actions row alike, and stands alone when a surface has no actions.
 *
 * The button shows the agent map icon and how many background agents of the
 * current run still work. It is there while the run has background agents,
 * finished ones included until the next user message, and while the shared
 * board has posts. It marks agents that wait for the user and board posts
 * the user has not read. A click opens the agent map, where agents can be
 * opened or stopped and the board read.
 *
 * It appears after a short delay and stays for a short time after the last
 * agent leaves the run, so agents that finish quickly do not make it flicker.
 */

import { Component, Show, createEffect, createMemo, createSignal, on, onCleanup, onMount, untrack } from "solid-js"
import { Icon } from "@kilocode/kilo-ui/icon"
import { useLanguage } from "../../context/language"
import { useSession } from "../../context/session"
import { useRunBoundary } from "./run-boundary"
import { mergePromptAgents, reverted, taskChildren, type BackgroundAgent, type PromptAgent } from "./background-agents"
import { useBackgroundAgents } from "./background-jobs"
import { useAgentMap } from "./AgentMap"
import type { SwarmBoardState } from "./SwarmBoard"

const DELAY = 400
// An agent that left the run keeps the button for this span.
const LEAVE = 280

/** Running, or waiting on a permission or question: the agent still needs the user or the model. */
const busy = (agent: BackgroundAgent) => agent.status === "running" || !!agent.permission || !!agent.question

/** The active background agents of the current session. */
export function useRunningAgents() {
  const agents = useBackgroundAgents()
  return createMemo(() => agents().filter(busy))
}

/**
 * The background agents of the current run.
 *
 * A run starts with each user message. The dock shows what the run started,
 * finished agents included, so an agent that finished while the user looked
 * away, or too fast to notice, still counts until the next message. Agents
 * that are still running stay from earlier runs. Finished agents of earlier
 * runs belong to the transcript, and finished agents of reverted turns leave,
 * as they leave the agent map.
 */
function useRunAgents() {
  const session = useSession()
  const agents = useBackgroundAgents()
  // Agents seen active in this run. They stay after they finish.
  const [kept, setKept] = createSignal<ReadonlySet<string>>(new Set())
  const { user } = useRunBoundary()
  // Agents the run started, known from their task tool parts. This also
  // covers an agent that finished before the first job poll saw it run.
  const started = createMemo(() => {
    const id = session.currentSessionID()
    const since = user()
    if (!id) return new Set<string>()
    const tools = session.getSessionToolParts(id).filter((part) => !since || (part.messageID ?? "") > since)
    return new Set(taskChildren(tools))
  })
  const undone = createMemo(() => {
    const id = session.currentSessionID()
    return id ? reverted(session.getSessionToolParts(id), session.revert()) : new Set<string>()
  })
  createEffect(on(session.currentSessionID, () => setKept(new Set<string>()), { defer: true }))
  createEffect(
    on(
      user,
      () =>
        setKept(
          new Set(
            untrack(agents)
              .filter(busy)
              .map((agent) => agent.id),
          ),
        ),
      { defer: true },
    ),
  )
  createEffect(() => {
    const ids = agents()
      .filter(busy)
      .map((agent) => agent.id)
    if (ids.every((id) => untrack(kept).has(id))) return
    setKept((prev) => new Set([...prev, ...ids]))
  })
  return createMemo(() =>
    agents().filter(
      (agent) => busy(agent) || ((kept().has(agent.id) || started().has(agent.id)) && !undone().has(agent.id)),
    ),
  )
}

export function useAgentStack() {
  const session = useSession()
  const [items, setItems] = createSignal<PromptAgent[]>([])
  const [shown, setShown] = createSignal(false)
  const [leaving, setLeaving] = createSignal<ReadonlySet<string>>(new Set())
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  let enter: ReturnType<typeof setTimeout> | undefined

  const agents = useRunAgents()
  const live = createMemo(() => agents().filter(busy))

  const reset = () => {
    for (const timer of timers.values()) clearTimeout(timer)
    timers.clear()
    setLeaving(new Set<string>())
    clearTimeout(enter)
    enter = undefined
    setItems([])
    setShown(false)
  }

  createEffect(on(session.currentSessionID, reset, { defer: true }))

  // A finished agent stays for the run. An agent that leaves the run stays a
  // moment longer, so the button does not vanish the instant the run ends.
  createEffect(
    on(agents, (list) => {
      const merged = mergePromptAgents(items(), live())
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

  // Every agent is leaving: the button closes with them.
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
    shown,
    closing,
    running: createMemo(() => items().filter((item) => !item.done).length),
    waiting: createMemo(() => live().some((agent) => agent.permission || agent.question)),
  }
}

export type AgentStackState = ReturnType<typeof useAgentStack>

function without(set: ReadonlySet<string>, id: string) {
  const next = new Set(set)
  next.delete(id)
  return next
}

export const AgentStack: Component<{
  state: AgentStackState
  board?: SwarmBoardState
  label?: boolean
  rule?: boolean
}> = (props) => {
  const language = useLanguage()
  const map = useAgentMap({
    get board() {
      return props.board
    },
  })
  // The button opens once. The actions row can rebuild and move this node,
  // which would replay a CSS animation, so the open animation only applies
  // until the button is ready.
  const [ready, setReady] = createSignal(false)
  onMount(() => {
    const timer = setTimeout(() => setReady(true), 300)
    onCleanup(() => clearTimeout(timer))
  })

  const summary = createMemo(() => {
    const count = props.state.agents().filter(busy).length
    const total = props.state.agents().length
    if (total === 0) return language.t("agentMap.open")
    if (count === 0) return language.t("task.backgroundAgents.finished")
    if (count === total) {
      if (count === 1) return language.t("task.backgroundAgents.running.one")
      return language.t("task.backgroundAgents.running.many", { count: String(count) })
    }
    return language.t("task.backgroundAgents.summary", { running: String(count), total: String(total) })
  })
  const unread = () => !!props.board?.unread()
  // With only board posts and no agents, the summary already names the action.
  const label = () => (props.state.agents().length === 0 ? summary() : `${summary()}. ${language.t("agentMap.open")}`)

  return (
    <button
      type="button"
      data-component="agent-stack"
      data-ready={ready() ? "" : undefined}
      data-idle={props.state.closing() ? "true" : undefined}
      data-rule={props.rule ? "" : undefined}
      data-attention={props.state.waiting() ? "" : undefined}
      data-unread={unread() ? "" : undefined}
      title={label()}
      aria-label={label()}
      onClick={() => map()}
    >
      <span data-slot="agent-stack-body">
        <Icon name="circuit-board" size="small" />
        <Show when={props.state.running() > 0}>
          <span data-slot="agent-stack-count">{props.state.running()}</span>
        </Show>
        <Show when={unread()}>
          <span data-slot="agent-stack-unread" aria-hidden="true" />
        </Show>
        <Show when={props.label}>
          <span data-slot="agent-stack-label">{summary()}</span>
        </Show>
      </span>
    </button>
  )
}
