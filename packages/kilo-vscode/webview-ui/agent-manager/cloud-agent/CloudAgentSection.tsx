/** @jsxImportSource solid-js */

import { For, Show, type Accessor, type Component } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Icon } from "@kilocode/kilo-ui/icon"
import type { UiI18nParams } from "@kilocode/kilo-ui/context"
import { formatRelativeDate } from "../../src/utils/date"
import type { createCloudSessionState } from "./session-state"

interface CloudAgentSectionProps {
  state: ReturnType<typeof createCloudSessionState>
  current: Accessor<string | undefined>
  selected: Accessor<boolean>
  onCreate: () => void
  t: (key: string, params?: UiI18nParams) => string
}

export const CloudAgentSection: Component<CloudAgentSectionProps> = (props) => (
  <div class="am-section">
    <div class="am-section-header">
      <button class="am-section-toggle" onClick={() => props.state.toggle()}>
        <span class="am-section-label">
          <Icon
            name={props.state.collapsed() ? "chevron-right" : "chevron-down"}
            size="small"
            class="am-section-chevron"
          />
          {props.t("agentManager.section.cloudAgents")}
        </span>
      </button>
      <IconButton
        icon="plus"
        size="small"
        variant="ghost"
        aria-label={props.t("agentManager.cloud.create.open")}
        onClick={() => props.onCreate()}
      />
    </div>
    <Show when={!props.state.collapsed()}>
      <div class="am-list">
        <Show
          when={props.state.status() !== "signed-out"}
          fallback={
            <div class="am-empty-state-text am-cloud-list-state">{props.t("agentManager.cloud.signedOut")}</div>
          }
        >
          <For each={props.state.visible()}>
            {(item) => (
              <button
                class={`am-item ${item.id === props.current() && props.selected() ? "am-item-active" : ""}`}
                data-sidebar-id={item.id}
                onClick={() => props.state.open(item)}
              >
                <span class="am-item-title">{item.title || props.t("agentManager.session.untitled")}</span>
                <span class="am-item-time">{formatRelativeDate(item.updatedAt)}</span>
              </button>
            )}
          </For>
          <Show when={props.state.status() === "loading"}>
            <div class="am-item-time am-cloud-list-state">{props.t("agentManager.cloud.loading")}</div>
          </Show>
          <Show when={props.state.status() === "ready" && props.state.visible().length === 0}>
            <div class="am-item-time am-cloud-list-state">
              {props.state.repository()
                ? props.t("agentManager.cloud.emptyRepository", { repository: props.state.repository()! })
                : props.t("agentManager.cloud.empty")}
            </div>
          </Show>
          <Show when={props.state.status() === "error"}>
            <div class="am-empty-state-text am-cloud-list-state">
              <span>{props.state.error() || props.t("agentManager.cloud.failed")}</span>
              <Button variant="ghost" size="small" onClick={() => props.state.retry()}>
                {props.t("agentManager.cloud.retry")}
              </Button>
            </div>
          </Show>
        </Show>
      </div>
    </Show>
  </div>
)
