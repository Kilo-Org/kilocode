import { Component, For, Show } from "solid-js"
import type { TeamConfig } from "../../types/messages"

interface TeamDelegationGraphProps {
  team: TeamConfig
}

const TeamDelegationGraph: Component<TeamDelegationGraphProps> = (props) => {
  const roleEntries = () => Object.entries(props.team.roles ?? {})

  return (
    <div
      style={{
        padding: "8px 10px",
        border: "1px solid var(--border-weak-base)",
        "border-radius": "8px",
        "background-color": "var(--bg-subtle-base, var(--vscode-editor-background))",
      }}
    >
      <Show
        when={roleEntries().length > 0}
        fallback={<div style={{ "font-size": "12px", color: "var(--text-weak-base)" }}>No roles to visualize yet.</div>}
      >
        <For each={roleEntries()}>
          {([roleID, role], index) => (
            <div
              style={{
                "border-bottom": index() < roleEntries().length - 1 ? "1px solid var(--border-weak-base)" : "none",
                padding: "6px 0",
              }}
            >
              <div style={{ "font-size": "12px", "font-weight": "600" }}>
                {role.displayName} <span style={{ color: "var(--text-weak-base)" }}>({roleID})</span>
              </div>
              <Show
                when={role.canDelegate.length > 0}
                fallback={<div style={{ "font-size": "11px", color: "var(--text-weak-base)" }}>No delegation targets</div>}
              >
                <div style={{ "font-size": "11px", color: "var(--text-weak-base)" }}>
                  delegates to: {role.canDelegate.join(", ")}
                </div>
              </Show>
            </div>
          )}
        </For>
      </Show>
    </div>
  )
}

export default TeamDelegationGraph
