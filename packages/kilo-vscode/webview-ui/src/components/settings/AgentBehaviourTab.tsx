// The Agent Behaviour tab shell: the horizontal subtab bar and the active subtab's content. The subtabs come from
// agent-behaviour/subtabs.ts, and only a ready subtab renders a component.
import { Component, createSignal, For, Show } from "solid-js"
import { useLanguage } from "../../context/language"
import { AGENT_BEHAVIOUR_SUBTABS } from "./agent-behaviour/subtabs"

const AgentBehaviourTab: Component = () => {
  const language = useLanguage()
  const [active, setActive] = createSignal(AGENT_BEHAVIOUR_SUBTABS[0]?.id ?? "")
  const current = () => AGENT_BEHAVIOUR_SUBTABS.find((subtab) => subtab.id === active())

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
        <For each={AGENT_BEHAVIOUR_SUBTABS}>
          {(subtab) => {
            const selected = () => active() === subtab.id
            return (
              <button
                onClick={() => setActive(subtab.id)}
                style={{
                  padding: "8px 16px",
                  border: "none",
                  background: "transparent",
                  color: selected() ? "var(--vscode-foreground)" : "var(--vscode-descriptionForeground)",
                  "font-size": "var(--kilo-font-size-13)",
                  "font-family": "var(--vscode-font-family)",
                  cursor: "pointer",
                  "border-bottom": selected() ? "2px solid var(--vscode-foreground)" : "2px solid transparent",
                  "margin-bottom": "-1px",
                }}
                onMouseEnter={(event) => {
                  if (!selected()) event.currentTarget.style.color = "var(--vscode-foreground)"
                }}
                onMouseLeave={(event) => {
                  if (!selected()) event.currentTarget.style.color = "var(--vscode-descriptionForeground)"
                }}
              >
                {language.t(subtab.title)}
              </button>
            )
          }}
        </For>
      </div>

      <Show when={current()?.ready ? current() : undefined} keyed>
        {(subtab) => {
          const Content = subtab.component
          return <Content />
        }}
      </Show>
    </div>
  )
}

export default AgentBehaviourTab
