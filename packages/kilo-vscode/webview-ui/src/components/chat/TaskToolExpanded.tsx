/**
 * TaskToolExpanded component
 * Registers a custom "task" tool renderer with a compact scrollable list of
 * child tool calls. Running tasks open immediately; completed tasks load their
 * child details only when expanded.
 *
 * Call registerExpandedTaskTool() once at app startup to activate.
 */

import { Component, createEffect, createMemo, createSignal, Index, Show, onCleanup } from "solid-js"
import { ToolRegistry, ToolProps, getToolInfo } from "@kilocode/kilo-ui/message-part"
import { BasicTool, initialOpen } from "@kilocode/kilo-ui/basic-tool"
import { Icon } from "@kilocode/kilo-ui/icon"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Markdown } from "@kilocode/kilo-ui/markdown"
import { useLanguage } from "../../context/language"
import { useI18n } from "@kilocode/kilo-ui/context/i18n"
import { createAutoScroll } from "@kilocode/kilo-ui/hooks"
import { useSession } from "../../context/session"
import { useVSCode } from "../../context/vscode"
import { childID } from "../../context/session-utils"
import { taskResult, taskRunning, taskVisible } from "./task-tool-state"

const TaskToolRenderer: Component<ToolProps> = (props) => {
  const i18n = useI18n()
  const language = useLanguage()
  const session = useSession()
  const vscode = useVSCode()

  const childSessionId = () =>
    childID({
      type: "tool",
      tool: props.tool,
      metadata: props.partMetadata as { sessionId?: string } | undefined,
      state: { metadata: props.metadata as { sessionId?: string } },
    })

  const running = createMemo(() => taskRunning(props.status))
  const [open, setOpen] = createSignal(
    initialOpen({
      tool: props.tool,
      partID: props.partID,
      defaultOpen: running(),
    }),
  )

  createEffect(() => {
    const id = taskVisible(open(), childSessionId())
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
        <Show when={description() || childToolCount() > 0}>
          <span data-slot="basic-tool-tool-subtitle">
            {description()}
            <Show when={childToolCount() > 0}>
              {description() ? " " : ""}({childToolCount()})
            </Show>
          </span>
        </Show>
      </div>
      <Show when={childSessionId()}>
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
      <BasicTool
        icon="task"
        status={props.status}
        tool={props.tool}
        partID={props.partID}
        trigger={trigger()}
        defaultOpen={running()}
        defer
        onOpenChange={setOpen}
      >
        <div ref={autoScroll.scrollRef} onScroll={autoScroll.handleScroll} data-component="tool-output" data-scrollable>
          <div ref={autoScroll.contentRef} data-component="task-tools">
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
