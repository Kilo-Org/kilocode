/**
 * Background agent strip for the task header.
 *
 * Sits in the same slot as the to-do strip: one line while collapsed, hidden
 * entirely when no background agent runs. It is the stable place to find async
 * sub-agents once the task card has scrolled out of view.
 *
 * Rows open the sub-agent through `openSubagent`, the same path the task card
 * uses, so Agent Manager keeps showing them in its right-hand inspector and the
 * sidebar keeps opening an editor tab.
 */

import { Component, For, Show, createMemo, createSignal, onCleanup, onMount, createEffect, on } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import type { BackgroundJobInfo } from "../../types/messages"
import { useLanguage } from "../../context/language"
import { useSession } from "../../context/session"
import { useVSCode } from "../../context/vscode"
import { useWorktreeMode } from "../../context/worktree-mode"
import {
  backgroundAgents,
  backgroundJobAgents,
  fitBackgroundAgents,
  showBackgroundAgent,
  type BackgroundAgent,
} from "./background-agents"
import { openSubagent } from "./open-subagent"

export const BackgroundAgents: Component<{ readonly?: boolean }> = (props) => {
  const session = useSession()
  const language = useLanguage()
  const vscode = useVSCode()
  const worktree = useWorktreeMode()
  const [open, setOpen] = createSignal(false)
  const [jobs, setJobs] = createSignal<BackgroundJobInfo[]>([])
  const [loaded, setLoaded] = createSignal(false)
  const [mounted, setMounted] = createSignal(false)
  let pending: string | undefined
  let revision = 0

  createEffect(
    on(session.currentSessionID, () => {
      setLoaded(false)
      setJobs([])
      pending = undefined
      if (mounted()) requestJobs()
    }),
  )

  const requestJobs = () => {
    const id = session.currentSessionID()
    if (!id || pending) return
    pending = `${id}:${++revision}`
    vscode.postMessage({ type: "requestBackgroundJobs", sessionID: id, requestID: pending })
  }

  onMount(() => {
    setMounted(true)
    const unsub = vscode.onMessage((message) => {
      if (message.type !== "backgroundJobsLoaded") return
      if (message.sessionID !== session.currentSessionID()) return
      if (message.requestID !== pending) return
      pending = undefined
      if (message.error) {
        setJobs([])
        setLoaded(false)
        return
      }
      setJobs(message.jobs)
      setLoaded(true)
    })
    requestJobs()
    const timer = setInterval(requestJobs, 1000)
    onCleanup(() => {
      setMounted(false)
      unsub()
      clearInterval(timer)
    })
  })

  const fallback = createMemo(() => {
    const id = session.currentSessionID()
    if (!id) return []
    return backgroundAgents(session.getSessionToolParts(id), session.allStatusMap())
  })

  const agents = createMemo(() => {
    const id = session.currentSessionID()
    if (!id) return []
    if (loaded()) return backgroundJobAgents(jobs(), id, session.scopedPermissions(id), session.scopedQuestions(id))
    return fallback()
  })

  const visible = createMemo(() => {
    const id = session.currentSessionID()
    if (!id) return []
    const hidden = session.dismissedBackgroundJobs(id)
    return agents().filter((agent) => showBackgroundAgent(agent, hidden))
  })
  const summary = createMemo(() => {
    const running = visible().filter((agent) => agent.status === "running").length
    const total = visible().length
    if (total === 1 && running === 1) return language.t("task.backgroundAgents.running.one")
    if (running === total) return language.t("task.backgroundAgents.running.many", { count: String(total) })
    return language.t("task.backgroundAgents.summary", { running: String(running), total: String(total) })
  })

  const waiting = createMemo(() => visible().filter((agent) => agent.permission || agent.question).length)

  const label = (agent: BackgroundAgent) =>
    agent.description ?? agent.agent ?? language.t("task.backgroundAgents.untitled")

  const active = createMemo(() =>
    visible().filter((agent) => agent.status === "running" || agent.permission || agent.question),
  )
  const keys = createMemo(() => active().map((agent) => agent.jobID))
  const signature = createMemo(() => keys().join("\0"))
  const [box, setBox] = createSignal<HTMLDivElement>()
  const [preview, setPreview] = createSignal<HTMLDivElement>()
  const [overflow, setOverflow] = createSignal<HTMLButtonElement>()
  const [layout, setLayout] = createSignal({ count: 0, offset: 0 })
  const count = createMemo(() => (open() ? 0 : Math.min(layout().count, active().length)))
  const remaining = createMemo(() => active().length - count())
  const caption = createMemo(() => (waiting() > 0 ? language.t("task.backgroundAgents.waiting") : summary()))
  const more = (count: number) => language.t("task.backgroundAgents.more", { count: String(count) })

  createEffect(() => {
    const container = box()
    const content = preview()
    const control = overflow()
    if (!signature() || !container || !content || !control || typeof ResizeObserver === "undefined") return
    const items = Array.from(content.children)
    const measure = () => {
      const widths = items.map((item) => item.getBoundingClientRect().width)
      const gap = Number.parseFloat(getComputedStyle(content).columnGap) || 0
      const count =
        container.clientWidth > 0
          ? fitBackgroundAgents(widths, container.clientWidth, control.getBoundingClientRect().width, gap)
          : 0
      const offset = widths.slice(0, count).reduce((sum, width) => sum + width + gap, 0)
      setLayout({ count, offset })
    }
    const observer = new ResizeObserver(measure)
    observer.observe(container)
    observer.observe(control)
    for (const item of items) observer.observe(item)
    onCleanup(() => observer.disconnect())
    measure()
  })

  const status = (agent: BackgroundAgent) => language.t(`task.backgroundAgents.status.${agent.status}`)

  const icon = (agent: BackgroundAgent) => {
    if (agent.status === "completed") return "circle-check" as const
    if (agent.status === "cancelled") return "circle-ban-sign" as const
    if (agent.status === "error") return "warning" as const
    return undefined
  }

  const openAgent = (agent: BackgroundAgent) =>
    openSubagent({
      sessionID: agent.id,
      title: agent.description,
      parentSessionID: session.currentSessionID(),
      worktree: !!worktree,
      post: vscode.postMessage,
    })

  const cancelAgent = (event: MouseEvent, agent: BackgroundAgent) => {
    event.stopPropagation()
    if (agent.status !== "running") return
    const id = session.currentSessionID()
    if (!id) return
    pending = `${id}:${++revision}`
    vscode.postMessage({ type: "cancelBackgroundJob", jobID: agent.jobID, sessionID: id, requestID: pending })
  }

  const hide = (ids: string[]) => {
    const id = session.currentSessionID()
    if (id) session.dismissBackgroundJobs(id, ids)
  }

  const hideFinished = () =>
    hide(
      agents()
        .filter((agent) => agent.status !== "running")
        .map((agent) => agent.jobID),
    )

  return (
    <Show when={visible().length > 0}>
      <div data-component="task-header-agents">
        <div data-slot="task-header-agents-toolbar">
          <div data-slot="task-header-agents-content" ref={setBox}>
            <Button
              data-slot="task-header-agents-summary"
              variant="ghost"
              size="small"
              aria-hidden={count() > 0}
              tabIndex={count() > 0 ? -1 : 0}
              aria-expanded={open()}
              onClick={() => setOpen((value) => !value)}
            >
              <Show
                when={waiting() > 0}
                fallback={
                  <Show when={active().length > 0} fallback={<Icon name="task" size="small" />}>
                    <Spinner />
                  </Show>
                }
              >
                <Icon name="warning" size="small" />
              </Show>
              <span data-slot="task-header-todos-summary">{caption()}</span>
            </Button>
            <div data-slot="task-header-agents-preview" ref={setPreview}>
              <For each={keys()}>
                {(id, index) => (
                  <Show when={active().find((agent) => agent.jobID === id)}>
                    {(agent) => (
                      <Button
                        data-slot="task-header-agents-item"
                        variant="ghost"
                        size="small"
                        aria-hidden={index() >= count()}
                        tabIndex={index() < count() ? 0 : -1}
                        title={`${language.t("task.backgroundAgents.open")}: ${label(agent())}`}
                        aria-label={`${language.t("task.backgroundAgents.open")}: ${label(agent())}${
                          agent().permission || agent().question
                            ? ` (${language.t("task.backgroundAgents.needsInput")})`
                            : ""
                        }`}
                        onClick={() => openAgent(agent())}
                      >
                        <Show when={agent().permission || agent().question} fallback={<Spinner />}>
                          <Icon name="warning" size="small" />
                        </Show>
                        <span dir="auto">{label(agent())}</span>
                      </Button>
                    )}
                  </Show>
                )}
              </For>
            </div>
            <Button
              data-slot="task-header-agents-overflow"
              ref={setOverflow}
              variant="ghost"
              size="small"
              style={{ "inset-inline-start": `${layout().offset}px` }}
              aria-hidden={count() === 0 || remaining() === 0}
              tabIndex={count() > 0 && remaining() > 0 ? 0 : -1}
              aria-expanded={open()}
              aria-label={`${more(remaining())}: ${caption()}`}
              title={caption()}
              onClick={() => setOpen((value) => !value)}
            >
              <span data-slot="task-header-agents-overflow-label">
                <span aria-hidden="true">{more(active().length)}</span>
                <span>{more(remaining())}</span>
              </span>
            </Button>
          </div>
          <Button
            data-slot="task-header-agents-toggle"
            variant="ghost"
            size="small"
            icon={waiting() > 0 ? "warning" : undefined}
            aria-label={caption()}
            title={caption()}
            aria-expanded={open()}
            onClick={() => setOpen((value) => !value)}
          >
            <Icon name={open() ? "chevron-up" : "chevron-down"} size="small" />
          </Button>
          <Show when={!props.readonly && visible().some((agent) => agent.status !== "running")}>
            <Button
              icon="close-small"
              variant="ghost"
              size="small"
              aria-label={language.t("task.backgroundAgents.clearFinished")}
              onClick={hideFinished}
            >
              <span data-slot="task-header-agent-action-label">
                {language.t("task.backgroundAgents.clearFinished")}
              </span>
            </Button>
          </Show>
        </div>
        <Show when={open()}>
          <div data-slot="task-header-todos-list">
            <Show when={visible().some((agent) => agent.permission || agent.question)}>
              <div data-slot="task-header-agent-attention">
                <Icon name="warning" size="small" />
                <span>{language.t("task.backgroundAgents.waiting")}</span>
              </div>
            </Show>
            <For each={visible()}>
              {(agent) => (
                <div data-slot="task-header-agent" data-status={agent.status}>
                  <Show when={icon(agent)} fallback={<Spinner />}>
                    {(name) => <Icon name={name()} size="small" data-slot="task-header-agent-status" />}
                  </Show>
                  <button
                    data-slot="task-header-agent-main"
                    title={`${language.t("task.backgroundAgents.open")}: ${label(agent)}`}
                    aria-label={`${language.t("task.backgroundAgents.open")}: ${label(agent)}`}
                    onClick={() => openAgent(agent)}
                  >
                    <span data-slot="task-header-agent-label" dir="auto">
                      {label(agent)}
                    </span>
                    <span data-slot="task-header-agent-status-label">{status(agent)}</span>
                    <Show when={agent.permission || agent.question}>
                      <span data-slot="task-header-agent-attention-label">
                        {language.t("task.backgroundAgents.needsInput")}
                      </span>
                    </Show>
                  </button>
                  <Show when={!props.readonly && agent.status === "running"}>
                    <Button
                      icon="stop"
                      variant="ghost"
                      size="small"
                      aria-label={`${language.t("task.backgroundAgents.cancel")}: ${label(agent)}`}
                      onClick={(event: MouseEvent) => cancelAgent(event, agent)}
                    >
                      <span data-slot="task-header-agent-action-label">
                        {language.t("task.backgroundAgents.cancel")}
                      </span>
                    </Button>
                  </Show>
                  <Show when={!props.readonly && agent.status !== "running"}>
                    <Button
                      icon="close-small"
                      variant="ghost"
                      size="small"
                      aria-label={`${language.t("task.backgroundAgents.dismiss")}: ${label(agent)}`}
                      onClick={(event: MouseEvent) => {
                        event.stopPropagation()
                        hide([agent.jobID])
                      }}
                    >
                      <span data-slot="task-header-agent-action-label">
                        {language.t("task.backgroundAgents.dismiss")}
                      </span>
                    </Button>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </Show>
  )
}
