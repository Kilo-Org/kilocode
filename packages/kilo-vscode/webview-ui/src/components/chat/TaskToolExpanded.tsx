/**
 * TaskToolExpanded component
 * Registers a custom "task" tool renderer that matches the v1.0.25 layout:
 * a BasicTool open by default with a compact scrollable list of child tool calls,
 * each shown as: icon + title + subtitle.
 *
 * Call registerExpandedTaskTool() once at app startup to activate.
 */

import { Component, createEffect, createMemo, For, Match, Show, Switch } from "solid-js"
import { ToolRegistry, ToolProps, getToolInfo } from "@kilocode/kilo-ui/message-part"
import { BasicTool } from "@kilocode/kilo-ui/basic-tool"
import { Button } from "@kilocode/kilo-ui/button"
import { Icon } from "@kilocode/kilo-ui/icon"
import { useData } from "@kilocode/kilo-ui/context/data"
import { useI18n } from "@kilocode/kilo-ui/context/i18n"
import { createAutoScroll } from "@kilocode/kilo-ui/hooks"
import { useSession } from "../../context/session"
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

  const childSessionId = () => props.metadata.sessionId as string | undefined

  const running = createMemo(() => props.status === "pending" || props.status === "running")

  // Sync child session into store whenever we have a sessionId
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

  // Permission from child session
  const childPermission = createMemo(() => {
    const id = childSessionId()
    if (!id) return undefined
    const perms = data.store.permission?.[id] as unknown[]
    return (perms as PermissionRequest[] | undefined)?.[0]
  })

  const childToolPart = createMemo(() => {
    const perm = childPermission()
    if (!perm || !perm.tool) return undefined
    const id = childSessionId()
    if (!id) return undefined
    const messages = (data.store.message?.[id] as SDKMessage[] | undefined) ?? []
    const msg = [...messages].reverse().find((m: SDKMessage) => m.id === perm.tool!.messageID)
    if (!msg) return undefined
    const parts = (data.store.part?.[msg.id] as ToolPart[] | undefined) ?? []
    return parts.find((p) => p.type === "tool" && p.callID === perm.tool!.callID) as ToolPart | undefined
  })

  const respond = (response: "once" | "always" | "reject") => {
    const perm = childPermission()
    if (!perm || !data.respondToPermission) return
    data.respondToPermission({
      sessionID: perm.sessionID,
      permissionID: perm.id,
      response,
    })
  }

  const autoScroll = createAutoScroll({
    working: running,
    overflowAnchor: "auto",
  })

  const trigger = () => (
    <div data-slot="basic-tool-tool-info-structured">
      <div data-slot="basic-tool-tool-info-main">
        <span data-slot="basic-tool-tool-title" class="capitalize">
          {title()}
        </span>
        <Show when={description()}>
          <span data-slot="basic-tool-tool-subtitle">{description()}</span>
        </Show>
      </div>
    </div>
  )

  // Render the child tool card that triggered a permission (shown when permission is pending)
  const renderChildToolCard = () => {
    const part = childToolPart()
    if (!part) return null
    const render = ToolRegistry.render(part.tool)
    if (!render) return null
    const metadata = (part.state as { metadata?: Record<string, unknown> })?.metadata ?? {}
    const input = part.state?.input ?? {}
    const output = (part.state as { output?: string })?.output
    return render({
      input: input as Record<string, unknown>,
      tool: part.tool,
      metadata: metadata as Record<string, unknown>,
      output,
      status: part.state.status,
      defaultOpen: true,
    })
  }

  return (
    <div data-component="tool-part-wrapper" data-permission={!!childPermission()}>
      <Switch>
        {/* Branch 1: pending permission from child session */}
        <Match when={childPermission()}>
          <>
            <Show when={childToolPart()} fallback={<BasicTool icon="task" defaultOpen trigger={trigger()} />}>
              {renderChildToolCard()}
            </Show>
            <div data-component="permission-prompt">
              <div data-slot="permission-actions">
                <Button variant="ghost" size="small" onClick={() => respond("reject")}>
                  {i18n.t("ui.permission.deny")}
                </Button>
                <Button variant="secondary" size="small" onClick={() => respond("always")}>
                  {i18n.t("ui.permission.allowAlways")}
                </Button>
                <Button variant="primary" size="small" onClick={() => respond("once")}>
                  {i18n.t("ui.permission.allowOnce")}
                </Button>
              </div>
              <p data-slot="permission-hint">{i18n.t("ui.permission.sessionHint")}</p>
            </div>
          </>
        </Match>

        {/* Branch 2: normal — compact list of child tool calls */}
        <Match when={true}>
          <BasicTool icon="task" status={props.status} trigger={trigger()} defaultOpen>
            <div
              ref={autoScroll.scrollRef}
              onScroll={autoScroll.handleScroll}
              data-component="tool-output"
              data-scrollable
            >
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
          </BasicTool>
        </Match>
      </Switch>
    </div>
  )
}

// Minimal PermissionRequest shape we need
interface PermissionRequest {
  id: string
  sessionID: string
  tool?: { messageID: string; callID: string }
  metadata?: Record<string, unknown>
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
