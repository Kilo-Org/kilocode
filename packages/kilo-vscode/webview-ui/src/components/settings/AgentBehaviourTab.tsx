// The Agent Behaviour tab shell: the horizontal subtab bar and the active subtab's content. The subtabs come from
// agent-behaviour/subtabs.ts. Only a ready subtab is shown and rendered, so the tab never opens on a blank panel.
import { Component, createMemo, For, Show } from "solid-js"
import { Dynamic } from "solid-js/web"
import { useLanguage } from "../../context/language"
import { AGENT_BEHAVIOUR_SUBTABS } from "./agent-behaviour/subtabs"
import type { SettingsTabProps } from "./tabs"

const AgentBehaviourTab: Component<SettingsTabProps> = (props) => {
  const language = useLanguage()
  const ready = createMemo(() => AGENT_BEHAVIOUR_SUBTABS.filter((subtab) => subtab.ready))
  const active = createMemo(() => ready().find((subtab) => subtab.id === props.subtab) ?? ready()[0])

  return (
    <div>
      <div
        style={{
          display: "flex",
          gap: "0",
          "border-bottom": "1px solid var(--vscode-panel-border)",
          "margin-bottom": "16px",
        }}
      >
        <For each={ready()}>
          {(subtab) => {
            const selectedTab = () => active()?.id === subtab.id
            return (
              <button
                data-search-label={language.t(subtab.title)}
                data-subtab={subtab.id}
                aria-pressed={selectedTab()}
                onClick={() => props.onSubtabChange(subtab.id)}
                style={{
                  padding: "8px 16px",
                  border: "none",
                  background: "transparent",
                  color: selectedTab() ? "var(--vscode-foreground)" : "var(--vscode-descriptionForeground)",
                  "font-size": "var(--kilo-font-size-13)",
                  "font-family": "var(--vscode-font-family)",
                  cursor: "pointer",
                  "border-bottom": selectedTab() ? "2px solid var(--vscode-foreground)" : "2px solid transparent",
                  "margin-bottom": "-1px",
                }}
                onMouseEnter={(event) => {
                  if (!selectedTab()) event.currentTarget.style.color = "var(--vscode-foreground)"
                }}
                onMouseLeave={(event) => {
                  if (!selectedTab()) event.currentTarget.style.color = "var(--vscode-descriptionForeground)"
                }}
              >
                {language.t(subtab.title)}
              </button>
            )
          }}
        </For>
      </div>

      <Show when={active()}>
        <Dynamic component={active()!.component} navigation={props.navigation} />
      </Show>
    </div>
  )
}

export default AgentBehaviourTab
