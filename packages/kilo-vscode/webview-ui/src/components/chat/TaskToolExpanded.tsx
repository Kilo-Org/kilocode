/**
 * TaskToolExpanded component
 * Registers a custom "task" tool renderer with a compact scrollable list of
 * child tool calls. Running tasks open immediately; completed tasks load their
 * child details only when expanded.
 *
 * Call registerExpandedTaskTool() once at app startup to activate.
 */

import { Component, createEffect, createMemo, createSignal, Index, Show, on, onCleanup } from "solid-js"
import { ToolRegistry, ToolProps, getToolInfo } from "@kilocode/kilo-ui/message-part"
import { BasicTool, initialOpen } from "@kilocode/kilo-ui/basic-tool"
import { Icon } from "@kilocode/kilo-ui/icon"
import { AgentAvatar } from "@kilocode/kilo-ui/agent-avatar"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Markdown } from "@kilocode/kilo-ui/markdown"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { useLanguage } from "../../context/language"
import { useI18n } from "@kilocode/kilo-ui/context/i18n"
import { createAutoScroll } from "@kilocode/kilo-ui/hooks"
import { useSession } from "../../context/session"
import { useVSCode } from "../../context/vscode"
import { useWorktreeMode } from "../../context/worktree-mode"
import { childID, latestTaskPart } from "../../context/session-utils"
import { useConfig } from "../../context/config"
import { openSubagent } from "./open-subagent"
import { showChildPromotion, taskAvatarStatus, taskResult, taskRunning, taskVisible } from "./task-tool-state"

const TaskToolRenderer: Component<ToolProps> = (props) => {
  const i18n = useI18n()
  const language = useLanguage()
  const session = useSession()
  const { features } = useConfig()
  const vscode = useVSCode()
  const worktree = useWorktreeMode()

  const childSessionId = () =>
    childID({
      type: "tool",
      tool: props.tool,
      metadata: props.partMetadata as { sessionId?: string } | undefined,
      state: { metadata: props.metadata as { sessionId?: string } },
    })

  const promotable = createMemo(() =>
    showChildPromotion(
      childSessionId(),
      props.partMetadata as Record<string, unknown> | undefined,
      props.metadata as Record<string, unknown> | undefined,
      session.allStatusMap(),
      features().backgroundSubagents,
      props.readonly,
      latestTaskPart(
        props.partID,
        childSessionId(),
        session.currentSessionID() ? session.getSessionToolParts(session.currentSessionID()!) : [],
      ),
    ),
  )

  const running = createMemo(() => taskRunning(props.status))
  const avatar = createMemo(() => {
    const id = childSessionId()
    return taskAvatarStatus(id, props.status, session.allStatusMap())
  })
  // BasicTool's forceOpen effect only fires onOpenChange on a false->true
  // transition — a virtualized remount that starts with forceOpen already
  // true never transitions, so this local signal must also seed itself from
  // forceOpen directly, or the child list/result below stays hidden even
  // though the accordion itself renders open.
  const [open, setOpen] = createSignal(
    initialOpen({
      tool: props.tool,
      partID: props.partID,
      defaultOpen: running(),
      forceOpen: props.forceOpen,
    }),
  )

  let synced: string | undefined
  createEffect(() => {
    const id = taskVisible(open(), childSessionId())
    if (synced === id) return
    if (synced) session.unsyncSession(synced)
    synced = id
    if (!id) return
    session.syncSession(id)
  })
  onCleanup(() => {
    if (synced) session.unsyncSession(synced)
  })

  const title = createMemo(() => i18n.t("ui.tool.agent", { type: props.input.subagent_type || props.tool }))

  const description = createMemo(() => {
    const val = props.input.description
    return typeof val === "string" ? val : undefined
  })

  // All tool parts from the child session — the compact summary list
  const childToolParts = createMemo(() => {
    const id = childSessionId()
    if (!id) return []
    return session.getSessionToolParts(id)
  })

  const childToolCount = createMemo(() => {
    const id = childSessionId()
    return id ? session.getSessionToolCount(id) : 0
  })

  const result = createMemo(() => taskResult(props.output, childSessionId()))

  createEffect((prev: string | undefined) => {
    const id = taskVisible(open(), childSessionId())
    if (prev && prev !== id) vscode.postMessage({ type: "streamSessionVisible", sessionID: prev, visible: false })
    if (id && id !== prev) vscode.postMessage({ type: "streamSessionVisible", sessionID: id, visible: true })
    return id
  })

  onCleanup(() => {
    const id = taskVisible(open(), childSessionId())
    if (id) vscode.postMessage({ type: "streamSessionVisible", sessionID: id, visible: false })
  })

  const autoScroll = createAutoScroll({
    working: running,
  })
  let view: HTMLDivElement | undefined
  let body: HTMLDivElement | undefined
  const viewport = (el: HTMLDivElement) => {
    view = el
    autoScroll.scrollRef(running() ? el : undefined)
    if (!running()) el.scrollTop = 0
  }
  const content = (el: HTMLDivElement) => {
    body = el
    autoScroll.contentRef(running() ? el : undefined)
  }

  createEffect(
    on(running, (active) => {
      autoScroll.scrollRef(active ? view : undefined)
      autoScroll.contentRef(active ? body : undefined)
    }),
  )

  const openInTab = (e: MouseEvent) => {
    e.stopPropagation()
    const id = childSessionId()
    if (!id) return
    openSubagent({
      sessionID: id,
      title: description(),
      parentSessionID: session.currentSessionID(),
      worktree: !!worktree,
      post: vscode.postMessage,
    })
  }

  const background = (e: MouseEvent) => {
    e.stopPropagation()
    const id = session.currentSessionID()
    const child = childSessionId()
    if (id && child) vscode.postMessage({ type: "promoteBackgroundJob", jobID: child, sessionID: id })
  }

  const trigger = () => (
    <div data-slot="basic-tool-tool-info-structured" data-component="task-tool-heading">
      <div data-slot="basic-tool-tool-info-main">
        <span data-slot="basic-tool-tool-title" title={description() || title()}>
          {description() || title()}
        </span>
        <Show when={description() || childToolCount() > 0}>
          <span data-slot="basic-tool-tool-subtitle">
            {description() ? title() : undefined}
            <Show when={childToolCount() > 0}>
              {description() ? " " : ""}({childToolCount()})
            </Show>
          </span>
        </Show>
      </div>
      <Show when={childSessionId()}>
        <Show when={features().backgroundSubagents && promotable()}>
          <Tooltip value={language.t("task.backgroundAgents.continueInBackground")} placement="top">
            <IconButton
              icon="arrow-down-to-line"
              size="small"
              variant="ghost"
              aria-label={language.t("task.backgroundAgents.continueInBackground")}
              onClick={background}
            />
          </Tooltip>
        </Show>
        <IconButton
          icon="square-arrow-top-right"
          size="small"
          variant="ghost"
          aria-label={worktree ? "Open sub-agent in panel" : "Open sub-agent in tab"}
          onClick={openInTab}
        />
      </Show>
    </div>
  )

  return (
    <div data-component="tool-part-wrapper">
      <BasicTool
        icon="task"
        iconNode={
          <Show when={childSessionId()} fallback={<AgentAvatar id="" status={avatar()} />}>
            {(id) => (
              <span
                data-slot="task-agent-avatar"
                data-clickable="true"
                title={worktree ? "Open sub-agent in panel" : "Open sub-agent in tab"}
                onClick={openInTab}
              >
                <AgentAvatar id={id()} status={avatar()} />
              </span>
            )}
          </Show>
        }
        status={props.status}
        tool={props.tool}
        partID={props.partID}
        trigger={trigger()}
        defaultOpen={running()}
        forceOpen={props.forceOpen}
        defer
        onOpenChange={setOpen}
      >
        <div ref={viewport} onScroll={autoScroll.handleScroll} data-component="tool-output" data-scrollable>
          <div ref={content} data-component="task-tools">
            <Show when={running() && childToolCount() === 0}>
              <div data-slot="task-tool-item" data-state="starting">
                <span data-slot="task-tool-title">{language.t("session.messages.taskStarting")}</span>
              </div>
            </Show>
            <Show when={result()}>{(text) => <Markdown text={text()} />}</Show>
            <Index each={childToolParts()}>
              {(item) => {
                const info = createMemo(() => getToolInfo(item().tool, item().state?.input))
                const subtitle = createMemo(() => {
                  if (info().subtitle) return info().subtitle
                  const state = item().state as { status: string; title?: string }
                  if (state.status === "completed" || state.status === "running") return state.title
                  return undefined
                })
                return (
                  <div data-slot="task-tool-item">
                    <Icon name={info().icon} size="small" />
                    <span data-slot="task-tool-title">{info().title}</span>
                    <Show when={subtitle()}>
                      <span data-slot="task-tool-subtitle">{subtitle()}</span>
                    </Show>
                  </div>
                )
              }}
            </Index>
          </div>
        </div>
      </BasicTool>
    </div>
  )
}

/**
 * Override the upstream "task" tool registration with the v1.0.25-style renderer.
 * Must be called once at app startup.
 */
export function registerExpandedTaskTool() {
  ToolRegistry.register({
    name: "task",
    render: TaskToolRenderer,
  })
}
