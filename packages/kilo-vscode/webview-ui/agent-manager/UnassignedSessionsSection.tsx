import { For, Show, type Accessor, type Component } from "solid-js"
import { ContextMenu } from "@kilocode/kilo-ui/context-menu"
import { Icon } from "@kilocode/kilo-ui/icon"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { TooltipKeybind } from "@kilocode/kilo-ui/tooltip"
import type { SessionInfo } from "../src/types/messages"
import { useLanguage } from "../src/context/language"
import { formatRelativeDate } from "../src/utils/date"

interface Props {
  sessions: Accessor<SessionInfo[]>
  loaded: Accessor<boolean>
  collapsed: Accessor<boolean>
  active: Accessor<string | undefined>
  keybind: Accessor<string>
  onToggle: () => void
  onSelect: (id: string) => void
  onPromote: (id: string) => void
  onOpen: (id: string) => void
}

export const UnassignedSessionsSection: Component<Props> = (props) => {
  const { t } = useLanguage()

  const promote = (id: string, event: MouseEvent) => {
    event.stopPropagation()
    props.onPromote(id)
  }

  return (
    <div class={`am-section ${props.collapsed() ? "" : "am-section-grow"}`}>
      <button class="am-section-header am-section-toggle" onClick={props.onToggle}>
        <span class="am-section-label">
          <Icon name={props.collapsed() ? "chevron-right" : "chevron-down"} size="small" class="am-section-chevron" />
          {t("agentManager.section.sessions")}
        </span>
      </button>
      <Show when={!props.collapsed()}>
        <div class="am-list">
          <Show
            when={props.loaded()}
            fallback={
              <div class="am-skeleton-list">
                <div class="am-skeleton-session">
                  <div class="am-skeleton-session-title" style={{ width: "70%" }} />
                  <div class="am-skeleton-session-time" />
                </div>
                <div class="am-skeleton-session">
                  <div class="am-skeleton-session-title" style={{ width: "55%" }} />
                  <div class="am-skeleton-session-time" />
                </div>
                <div class="am-skeleton-session">
                  <div class="am-skeleton-session-title" style={{ width: "65%" }} />
                  <div class="am-skeleton-session-time" />
                </div>
              </div>
            }
          >
            <For each={props.sessions()}>
              {(session) => (
                <ContextMenu>
                  <ContextMenu.Trigger as="div" style={{ display: "contents" }}>
                    <button
                      class={`am-item ${session.id === props.active() ? "am-item-active" : ""}`}
                      data-sidebar-id={session.id}
                      onClick={() => props.onSelect(session.id)}
                    >
                      <span class="am-item-title" dir="auto">
                        {session.title || t("agentManager.session.untitled")}
                      </span>
                      <span class="am-item-time">{formatRelativeDate(session.updatedAt)}</span>
                      <div class="am-item-promote">
                        <TooltipKeybind
                          title={t("agentManager.session.openInWorktree")}
                          keybind={props.keybind()}
                          placement="right"
                        >
                          <IconButton
                            icon="branch"
                            size="small"
                            variant="ghost"
                            label={t("agentManager.session.openInWorktree")}
                            onClick={(event: MouseEvent) => promote(session.id, event)}
                          />
                        </TooltipKeybind>
                      </div>
                    </button>
                  </ContextMenu.Trigger>
                  <ContextMenu.Portal>
                    <ContextMenu.Content class="am-ctx-menu">
                      <ContextMenu.Item onSelect={() => props.onPromote(session.id)}>
                        <Icon name="branch" size="small" />
                        <ContextMenu.ItemLabel>{t("agentManager.session.openInWorktree")}</ContextMenu.ItemLabel>
                      </ContextMenu.Item>
                      <ContextMenu.Item onSelect={() => props.onOpen(session.id)}>
                        <Icon name="folder" size="small" />
                        <ContextMenu.ItemLabel>{t("agentManager.session.openLocally")}</ContextMenu.ItemLabel>
                      </ContextMenu.Item>
                    </ContextMenu.Content>
                  </ContextMenu.Portal>
                </ContextMenu>
              )}
            </For>
          </Show>
        </div>
      </Show>
    </div>
  )
}
