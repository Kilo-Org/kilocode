// The Agent Behaviour tab shell: the horizontal subtab bar and the active subtab's content. The subtabs come from
// agent-behaviour/subtabs.ts. Only a ready subtab is shown and rendered, so the tab never opens on a blank panel.
import { Component, createMemo, createSignal, For, Show } from "solid-js"
import { useLanguage } from "../../context/language"
import { AGENT_BEHAVIOUR_SUBTABS } from "./agent-behaviour/subtabs"

const AgentBehaviourTab: Component = () => {
  const language = useLanguage()
  const ready = createMemo(() => AGENT_BEHAVIOUR_SUBTABS.filter((subtab) => subtab.ready))
  const [selected, setSelected] = createSignal("")
  const active = () => ready().find((subtab) => subtab.id === selected()) ?? ready()[0]
  const current = () => ready().find((subtab) => subtab.id === active()?.id)

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
                onClick={() => setSelected(subtab.id)}
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

      <Show when={current()} keyed>
        {(subtab) => {
          const Content = subtab.component
          return <Content />
        }}
      </Show>
    </div>
  )
}

export default AgentBehaviourTab
