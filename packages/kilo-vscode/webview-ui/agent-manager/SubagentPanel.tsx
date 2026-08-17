/**
 * Read-only subagent chats for the Agent Manager inspector.
 *
 * The nested session provider keeps the parent chat selection independent from
 * the child transcript while still consuming the same webview event stream.
 */

import { Icon } from "@kilocode/kilo-ui/icon"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { createEffect, type Accessor, type Component } from "solid-js"
import { DataBridge } from "../src/App"
import { ChatView } from "../src/components/chat"
import { SessionProvider, useSession } from "../src/context/session"
import { SortableClosableTab } from "./ClosableTab"
import { InspectorTabStrip } from "./InspectorTabStrip"
import type { SubagentTab } from "./subagent-tabs"

interface Props {
  tabs: Accessor<SubagentTab[]>
  active: Accessor<string | undefined>
  visible: Accessor<boolean>
  nextKeybind: string
  closeKeybind: string
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onCloseOthers: (id: string) => void
  onReorder: (from: string, to: string) => void
  onClosePanel: () => void
}

const SubagentChat: Component<{ active: Accessor<string | undefined> }> = (props) => {
  const session = useSession()

  createEffect(() => {
    const id = props.active()
    if (!id) return
    session.selectSession(id, { focus: false })
  })

  return (
    <DataBridge>
      <ChatView readonly promptBoxId="agent-manager:subagent" />
    </DataBridge>
  )
}

const SubagentContent: Component<Props> = (props) => {
  const session = useSession()
  const ids = () => props.tabs().map((tab) => tab.id)
  const title = (id: string) => props.tabs().find((tab) => tab.id === id)?.title ?? "Sub-agent"
  const close = (id: string, focus: { restore: () => void }) => {
    props.onClose(id)
    session.releaseSession(id)
    if (ids().length > 0) focus.restore()
  }
  const closeOthers = (id: string) => {
    const gone = ids().filter((item) => item !== id)
    props.onCloseOthers(id)
    for (const item of gone) session.releaseSession(item)
  }

  return (
    <section
      class="am-subagent-panel"
      classList={{ "am-subagent-panel-visible": props.visible() }}
      aria-label="Subagents"
      aria-hidden={!props.visible()}
      inert={!props.visible()}
    >
      <header class="am-subagent-header">
        <div class="am-subagent-heading">
          <Icon name="task" size="small" />
          <span>Subagents</span>
          <span class="am-subagent-count">{props.tabs().length}</span>
        </div>
        <IconButton
          icon="x"
          size="small"
          variant="ghost"
          aria-label="Close subagents panel"
          onClick={props.onClosePanel}
        />
      </header>
      <InspectorTabStrip
        ids={ids}
        active={props.active}
        label="Subagent sessions"
        overlay={title}
        onSelect={props.onSelect}
        onReorder={props.onReorder}
        renderTab={(id, api) => {
          const label = title(id)
          return (
            <SortableClosableTab
              id={id}
              label={label}
              tooltip={label}
              icon="task"
              showKeybind={false}
              keybind={props.active() === id ? "" : props.nextKeybind}
              closeKeybind={props.closeKeybind}
              active={props.active() === id}
              role="tab"
              selected={props.active() === id}
              tabIndex={props.active() === id ? 0 : -1}
              onKeyDown={(event) => api.focus.key(id, event)}
              onSelect={() => props.onSelect(id)}
              onMiddleClick={(event) => {
                if (event.button !== 1) return
                event.preventDefault()
                event.stopPropagation()
                close(id, api.focus)
              }}
              onClose={() => close(id, api.focus)}
              onCloseOthers={() => closeOthers(id)}
            />
          )
        }}
      />
      <div class="am-subagent-chat">
        <SubagentChat active={props.active} />
      </div>
    </section>
  )
}

export const SubagentPanel: Component<Props> = (props) => (
  <SessionProvider>
    <SubagentContent {...props} />
  </SessionProvider>
)
