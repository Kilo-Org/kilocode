/**
 * Background agent status for the session dock.
 *
 * The dock is the one row between the transcript and the composer. It shows
 * the working spinner while the main agent runs and the session actions when
 * it is idle. Background agents can outlive the main agent's turn, so their
 * status must read in both states: this stack leads the working spinner and
 * the actions row alike, and stands alone when a surface has no actions.
 *
 * Hover names the state. A click opens the agents in a menu at the stack, the
 * same way the Goal control opens its menu in this row. It appears after a short delay and stays
 * for a short time after the last agent finishes, so agents that finish
 * quickly do not make it flicker.
 */

import { Component, For, Show, createEffect, createMemo, createSignal, on, onCleanup, onMount, untrack } from "solid-js"
import { AgentAvatar } from "@kilocode/kilo-ui/agent-avatar"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { DropdownMenu } from "@kilocode/kilo-ui/dropdown-menu"
import { Icon } from "@kilocode/kilo-ui/icon"
import { useLanguage } from "../../context/language"
import { useSession } from "../../context/session"
import { useVSCode } from "../../context/vscode"
import { useWorktreeMode } from "../../context/worktree-mode"
import type { BackgroundJobInfo } from "../../types/messages"
import { backgroundAgents, backgroundJobAgents, mergePromptAgents, type PromptAgent } from "./background-agents"
import { openSubagent } from "./open-subagent"

const DELAY = 400
const LINGER = 1500
// A finished avatar collapses over this span at the end of its linger.
const LEAVE = 240
const MAX = 3
const ROWS = 6

/**
 * The running background agents of the current session.
 *
 * The background agent strip polls the job list every second. This reads the
 * same replies instead of polling again. Job status is the source of truth.
 * Child session status is the fallback until a reply arrives or after a failed
 * one, the same as the strip, because a webview does not always receive status
 * for every child session.
 */
export function useRunningAgents() {
  const session = useSession()
  const vscode = useVSCode()
  const [jobs, setJobs] = createSignal<BackgroundJobInfo[]>()
  createEffect(on(session.currentSessionID, () => setJobs(undefined), { defer: true }))
  onCleanup(
    vscode.onMessage((message) => {
      if (message.type !== "backgroundJobsLoaded") return
      if (message.sessionID !== session.currentSessionID()) return
      setJobs(message.error ? undefined : message.jobs)
    }),
  )
  return createMemo(() => {
    const id = session.currentSessionID()
    if (!id) return []
    const list = jobs()
    if (!list) return backgroundAgents(session.getSessionToolParts(id), session.allStatusMap())
    return backgroundJobAgents(list, id).filter((agent) => agent.status === "running")
  })
}

export function useAgentStack() {
  const session = useSession()
  const [items, setItems] = createSignal<PromptAgent[]>([])
  const [shown, setShown] = createSignal(false)
  const [leaving, setLeaving] = createSignal<ReadonlySet<string>>(new Set())
  const timers = new Map<string, ReturnType<typeof setTimeout>[]>()
  let enter: ReturnType<typeof setTimeout> | undefined

  const live = useRunningAgents()

  const reset = () => {
    for (const list of timers.values()) list.forEach(clearTimeout)
    timers.clear()
    setLeaving(new Set<string>())
    clearTimeout(enter)
    enter = undefined
    setItems([])
    setShown(false)
  }

  createEffect(on(session.currentSessionID, reset, { defer: true }))

  createEffect(
    on(live, (list) => {
      const next = mergePromptAgents(items(), list)
      setItems(next)
      for (const item of next) {
        const list = timers.get(item.id)
        if (!item.done) {
          list?.forEach(clearTimeout)
          timers.delete(item.id)
          if (untrack(leaving).has(item.id)) setLeaving((prev) => without(prev, item.id))
          continue
        }
        if (list) continue
        // Hold the finished glyph, collapse it, then remove it.
        timers.set(item.id, [
          setTimeout(() => setLeaving((prev) => new Set([...prev, item.id])), LINGER - LEAVE),
          setTimeout(() => {
            timers.delete(item.id)
            setLeaving((prev) => without(prev, item.id))
            setItems((prev) => prev.filter((entry) => entry.id !== item.id || !entry.done))
          }, LINGER),
        ])
      }
    }),
  )

  const active = createMemo(() => items().some((item) => !item.done))

  createEffect(() => {
    if (items().length === 0) {
      clearTimeout(enter)
      enter = undefined
      setShown(false)
      return
    }
    if (!active()) {
      // A run shorter than the delay never shows the stack.
      clearTimeout(enter)
      enter = undefined
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
    leaving,
    shown,
    active,
    running: createMemo(() => items().filter((item) => !item.done).length),
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
  const session = useSession()
  const language = useLanguage()
  const vscode = useVSCode()
  const worktree = useWorktreeMode()
  // The stack opens once. The actions row can rebuild and move this node,
  // which would replay a CSS animation, so the open animation only applies
  // until the stack is ready. Avatars that join later grow in on their own.
  const [ready, setReady] = createSignal(false)
  onMount(() => {
    const timer = setTimeout(() => setReady(true), 300)
    onCleanup(() => clearTimeout(timer))
  })

  // Avatars keep their order, so a finished one dims and collapses in place.
  // Only when some are hidden do running agents move to the front, so a
  // finished avatar never hides a running one.
  const stack = createMemo(() => {
    const list = props.state.items()
    const max = props.max ?? MAX
    if (list.length <= max) return list
    return [...list.filter((item) => !item.done), ...list.filter((item) => item.done)].slice(0, max)
  })
  const ids = createMemo(() => stack().map((item) => item.id))
  const byId = createMemo(() => new Map(stack().map((item) => [item.id, item])))
  // A new avatar grows in only when the stack gains one. When it replaces
  // another at the same count, it fades in and the width stays.
  let size = 0
  createEffect(() => {
    size = ids().length
  })
  // One avatar shows the total count, so "3" reads as three agents. More
  // avatars show how many are hidden, as "+7".
  const count = () => {
    const total = props.state.items().length
    if (total === stack().length) return undefined
    if (stack().length === 1) return String(total)
    return `+${total - stack().length}`
  }
  const summary = createMemo(() => {
    const count = props.state.running()
    if (count === 0) return language.t("task.backgroundAgents.finished")
    if (count === 1) return language.t("task.backgroundAgents.running.one")
    return language.t("task.backgroundAgents.running.many", { count: String(count) })
  })

  const name = (item: PromptAgent) => item.description ?? item.agent ?? language.t("task.backgroundAgents.untitled")

  const status = (item: PromptAgent) =>
    language.t(item.done ? "task.backgroundAgents.status.completed" : "task.backgroundAgents.status.running")

  // Click opens the agents right at the stack, the same way the Goal control
  // opens its menu in this row. A row opens that agent, Stop all stops the
  // running ones. Each stop ends only that agent and anything it started.
  const [open, setOpen] = createSignal(false)
  const rows = () => props.state.items().slice(0, ROWS)
  const more = () => props.state.items().length - rows().length
  const running = () => props.state.items().filter((item) => !item.done)

  const show = (item: PromptAgent) =>
    openSubagent({
      sessionID: item.id,
      title: item.description,
      parentSessionID: session.currentSessionID(),
      worktree: !!worktree,
      post: vscode.postMessage,
    })

  const stop = () => {
    for (const item of running()) vscode.postMessage({ type: "abort", sessionID: item.id, scope: "tree" })
  }

  createEffect(() => {
    if (props.state.items().length === 0) setOpen(false)
  })

  const tooltip = () => (
    <div data-slot="agent-stack-tooltip">
      <div data-slot="agent-stack-tooltip-title">{summary()}</div>
      <div data-slot="agent-stack-tooltip-hint">{language.t("prompt.agents.hint")}</div>
    </div>
  )

  return (
    <DropdownMenu open={open()} onOpenChange={setOpen} placement="top-start" gutter={6}>
      <Tooltip value={tooltip()} placement="top" openDelay={150} contentClass="agent-stack-tooltip-content">
        <DropdownMenu.Trigger
          data-component="agent-stack"
          data-ready={ready() ? "" : undefined}
          data-idle={props.state.active() ? undefined : "true"}
          data-rule={props.rule ? "" : undefined}
          aria-label={`${summary()}. ${language.t("prompt.agents.show")}`}
        >
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
        </DropdownMenu.Trigger>
      </Tooltip>
      <DropdownMenu.Portal>
        <DropdownMenu.Content class="agent-stack-menu">
          <DropdownMenu.Group>
            <DropdownMenu.GroupLabel class="agent-stack-menu-title">{summary()}</DropdownMenu.GroupLabel>
            <For each={rows()}>
              {(item) => (
                <DropdownMenu.Item
                  class="agent-stack-menu-item"
                  data-done={item.done ? "true" : undefined}
                  onSelect={() => show(item)}
                >
                  <AgentAvatar id={item.id} status={item.done ? undefined : "running"} />
                  <DropdownMenu.ItemLabel class="agent-stack-menu-label" dir="auto">
                    {name(item)}
                  </DropdownMenu.ItemLabel>
                  <span class="agent-stack-menu-status">{status(item)}</span>
                </DropdownMenu.Item>
              )}
            </For>
            <Show when={more() > 0}>
              <div class="agent-stack-menu-more">
                {language.t("task.backgroundAgents.more", { count: String(more()) })}
              </div>
            </Show>
          </DropdownMenu.Group>
          <Show when={running().length > 0}>
            <DropdownMenu.Separator />
            <DropdownMenu.Item class="agent-stack-menu-item" onSelect={stop}>
              <Icon name="stop" size="small" />
              <DropdownMenu.ItemLabel>
                {language.t("task.backgroundAgents.stopAll", { count: String(running().length) })}
              </DropdownMenu.ItemLabel>
            </DropdownMenu.Item>
          </Show>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu>
  )
}
