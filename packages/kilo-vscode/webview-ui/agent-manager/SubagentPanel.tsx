/**
 * Read-only subagent chats for the Agent Manager inspector.
 *
 * Each subagent is a session of the same directory as its parent, so the panel reads it from the directory store of the
 * sessions layer and renders the shared v2 session view without docks or a prompt.
 */
import { AgentAvatar, AgentAvatarPalette } from "@kilocode/kilo-ui/agent-avatar"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import type { ToolActions } from "@kilocode/kilo-ui/message-part"
import { createEffect, createMemo, on, Show, type Accessor, type Component } from "solid-js"
import { useLanguage } from "../src/context/language"
import { SessionView } from "../src/v2/session-view"
import { V2Scope } from "../src/v2/client"
import { description, label, type Activity } from "./v2/activity"
import { useBridge } from "./v2/vscode"
import { SortableClosableTab } from "./ClosableTab"
import { InspectorTabStrip } from "./InspectorTabStrip"
import { availableSubagents, type SubagentTab } from "./subagent-tabs"
import { childTools } from "../src/v2/child-session"
import type { Sessions } from "./v2/sessions"

interface Props {
  sessions: Sessions
  tabs: Accessor<SubagentTab[]>
  active: Accessor<string | undefined>
  visible: Accessor<boolean>
  nextKeybind: string
  closeKeybind: string
  actions: ToolActions
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onCloseOthers: (id: string) => void
  onReorder: (from: string, to: string) => void
  onClosePanel: () => void
  onShowHistory: () => void
}

interface ContentProps extends Props {
  activity: (id: string) => Activity
}

const SubagentContent: Component<ContentProps> = (props) => {
  const language = useLanguage()
  const ids = () => props.tabs().map((tab) => tab.id)
  const title = (id: string) => props.tabs().find((tab) => tab.id === id)?.title ?? "Sub-agent"
  const close = (id: string, focus: { restore: () => void }, release: () => void) => {
    props.onClose(id)
    props.sessions.release(id)
    requestAnimationFrame(release)
    if (ids().length > 0) focus.restore()
  }
  const closeOthers = (id: string) => {
    const gone = ids().filter((item) => item !== id)
    props.onCloseOthers(id)
    for (const item of gone) props.sessions.release(item)
  }
  const scope = (id: string) => props.sessions.scope(id)

  return (
    <section
      class="am-subagent-panel"
      classList={{ "am-subagent-panel-visible": props.visible() }}
      aria-label="Subagents"
      aria-hidden={!props.visible()}
      inert={!props.visible()}
    >
      <InspectorTabStrip
        ids={ids}
        active={props.active}
        label="Subagent sessions"
        overlay={title}
        onSelect={props.onSelect}
        onReorder={props.onReorder}
        renderTab={(id, api) => {
          const name = title(id)
          const state = createMemo(() => props.activity(id))
          return (
            <SortableClosableTab
              id={id}
              label={name}
              tooltip={() => (state() === "idle" ? name : `${name}: ${language.t(description(state()))}`)}
              icon="task"
              iconNode={
                <AgentAvatar id={id} status={state() === "busy" || state() === "retry" ? "running" : undefined} />
              }
              state={state()}
              stateLabel={state() === "idle" ? undefined : language.t(label(state()))}
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
                close(id, api.focus, api.release)
              }}
              onClose={() => close(id, api.focus, api.release)}
              onCloseOthers={() => closeOthers(id)}
            />
          )
        }}
        action={() => (
          <div class="am-subagent-close">
            <IconButton
              icon="close"
              size="small"
              variant="ghost"
              aria-label="Close subagents panel"
              onClick={props.onClosePanel}
            />
          </div>
        )}
      />
      <div class="am-subagent-chat">
        <Show when={props.active()} keyed>
          {(id) => (
            <V2Scope value={scope(id)!}>
              <SessionView
                session={id}
                onSession={() => undefined}
                actions={props.actions}
                onShowHistory={props.onShowHistory}
                readOnly
                searchCommand={false}
              />
            </V2Scope>
          )}
        </Show>
      </div>
    </section>
  )
}

export const SubagentPanel: Component<Props> = (props) => {
  const vscode = useBridge()
  // A visible inspector shows the subagent transcript; report it as the viewed session.
  createEffect(
    on(
      () => [props.visible(), props.active()] as const,
      ([visible, active]) => {
        if (!visible) return
        vscode.postMessage({ type: "agentManager.visibleSession", sessionID: active ?? null })
      },
      { defer: true },
    ),
  )
  // Colors follow the parent's spawn order so tabs match the parent transcript.
  const siblings = createMemo(() => {
    const id = props.sessions.currentSessionID()
    if (!id) return []
    return availableSubagents(childTools(props.sessions.messages(id))).map((tab) => tab.id)
  })
  return (
    <AgentAvatarPalette ids={siblings()}>
      <SubagentContent {...props} activity={(id) => props.sessions.activityFor(id)} />
    </AgentAvatarPalette>
  )
}
