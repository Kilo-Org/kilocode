/**
 * TaskToolExpanded component
 * Registers a custom "task" tool renderer that matches the v1.0.25 layout:
 * a BasicTool open by default with a compact scrollable list of child tool calls,
 * each shown as: icon + title + subtitle.
 *
 * Call registerExpandedTaskTool() once at app startup to activate.
 */

import { Component, createEffect, createMemo, For, Show } from "solid-js"
import { ToolRegistry, ToolProps, getToolInfo } from "@kilocode/kilo-ui/message-part"
import { ToolCall } from "@kilocode/kilo-ui/basic-tool"
import { Icon } from "@kilocode/kilo-ui/icon"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { useData } from "@kilocode/kilo-ui/context/data"
import { useI18n } from "@kilocode/kilo-ui/context/i18n"
import { createAutoScroll } from "@kilocode/kilo-ui/hooks"
import { useSession } from "../../context/session"
import { useVSCode } from "../../context/vscode"
import { useWorktreeMode } from "../../context/worktree-mode"
import type { ToolPart, Message as SDKMessage } from "@kilocode/sdk/v2"

/** Collect all tool parts from all assistant messages in a given session. */
function getSessionToolParts(store: ReturnType<typeof useData>["store"], sessionId: string): ToolPart[] {
  const messages = (store.message?.[sessionId] as SDKMessage[] | undefined)?.filter((m) => m.role === "assistant")
  if (!messages) return []
  const parts: ToolPart[] = []
  for (const m of messages) {
    const msgParts = store.part?.[m.id]
    if (msgParts) {
      for (const p of msgParts) {
        if (p && p.type === "tool") parts.push(p as ToolPart)
      }
    }
  }
  return parts
}

const TaskToolRenderer: Component<ToolProps> = (props) => {
  const data = useData()
  const i18n = useI18n()
  const session = useSession()
  const vscode = useVSCode()
  const worktreeMode = useWorktreeMode()
  // Hide the open-in-tab button inside the Agent Manager
  const inAgentManager = worktreeMode !== undefined

  const childSessionId = () => props.metadata.sessionId as string | undefined

  const running = createMemo(() => props.status === "pending" || props.status === "running")

  // Warm child session data immediately so completed task tools already have
  // their compact child tool list available when the user expands them.
  createEffect(() => {
    const id = childSessionId()
    if (!id) return
    session.syncSession(id)
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
    return getSessionToolParts(data.store, id)
  })

  const autoScroll = createAutoScroll({
    working: running,
    overflowAnchor: "auto",
  })

  const openInTab = (e: MouseEvent) => {
    e.stopPropagation()
    const id = childSessionId()
    if (!id) return
    vscode.postMessage({ type: "openSubAgentViewer", sessionID: id, title: description() })
  }

  const trigger = () => (
    <div data-slot="basic-tool-tool-info-structured">
      <div data-slot="basic-tool-tool-info-main">
        <span data-slot="basic-tool-tool-title" class="capitalize">
          {title()}
        </span>
        <Show when={description() || childToolParts().length > 0}>
          <span data-slot="basic-tool-tool-subtitle">
            {description()}
            <Show when={childToolParts().length > 0}>
              {description() ? " " : ""}({childToolParts().length})
            </Show>
          </span>
        </Show>
      </div>
      <Show when={!inAgentManager && childSessionId()}>
        <IconButton
          icon="square-arrow-top-right"
          size="small"
          variant="ghost"
          aria-label="Open sub-agent in tab"
          onClick={openInTab}
        />
      </Show>
    </div>
  )

  return (
    <div data-component="tool-part-wrapper">
      <ToolCall variant="panel" icon="task" status={props.status} trigger={trigger()} defaultOpen>
        <div ref={autoScroll.scrollRef} onScroll={autoScroll.handleScroll} data-component="tool-output" data-scrollable>
          <div ref={autoScroll.contentRef} data-component="task-tools">
            <For each={childToolParts()}>
              {(item) => {
                const info = createMemo(() => getToolInfo(item.tool, item.state?.input))
                const subtitle = createMemo(() => {
                  if (info().subtitle) return info().subtitle
                  const state = item.state as { status: string; title?: string }
                  if (state.status === "completed" || state.status === "running") {
                    return state.title
                  }
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
            </For>
          </div>
        </div>
      </ToolCall>
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
