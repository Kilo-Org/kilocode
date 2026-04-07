// packages/opencode/src/devilcode/workflow-tui/tabs/tab-bar.tsx
import { For, Show, createMemo } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { useWorkflow } from "../context"

export function TabBar() {
  const { theme } = useTheme()
  const wf = useWorkflow()

  const agentTabs = createMemo(() => wf.tabs.filter((t) => t.kind === "agent"))
  const artifactTabs = createMemo(() => wf.tabs.filter((t) => t.kind !== "agent"))

  return (
    <box flexDirection="row" height={1} gap={1} paddingLeft={1}>
      <For each={agentTabs()}>
        {(tab) => {
          const isActive = createMemo(() => wf.activeTab === tab.id)
          return (
            <text
              fg={isActive() ? theme.primary : theme.textMuted}
              attributes={isActive() ? { bold: true } : {}}
              onMouseDown={() => wf.switchTab(tab.id)}
            >
              {"[" + tab.label + "]"}
            </text>
          )
        }}
      </For>
      <Show when={agentTabs().length > 0 && artifactTabs().length > 0}>
        <text fg={theme.border}>│</text>
      </Show>
      <For each={artifactTabs()}>
        {(tab) => {
          const isActive = createMemo(() => wf.activeTab === tab.id)
          return (
            <text
              fg={isActive() ? theme.primary : theme.textMuted}
              attributes={isActive() ? { bold: true } : {}}
              onMouseDown={() => wf.switchTab(tab.id)}
            >
              {"[" + tab.label + "]"}
            </text>
          )
        }}
      </For>
    </box>
  )
}
