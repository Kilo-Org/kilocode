import { For, Show, createMemo } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { useWorkflow } from "../context"

export function AgentOutputTab(props: { tabId: string }) {
  const { theme } = useTheme()
  const wf = useWorkflow()

  const session = createMemo(() => {
    const tab = wf.tabs.find((t) => t.id === props.tabId)
    if (!tab?.sessionId) return undefined
    return wf.activeSessions[tab.sessionId]
  })

  return (
    <scrollbox
      flexGrow={1}
      stickyScroll={true}
      stickyStart="bottom"
      paddingLeft={1}
      paddingRight={1}
    >
      <Show
        when={session()}
        fallback={<text fg={theme.textMuted}>Waiting for agent output...</text>}
      >
        {(s) => (
          <For each={s().output}>
            {(line) => (
              <text fg={theme.text} wrapMode="word" width="100%">
                {line}
              </text>
            )}
          </For>
        )}
      </Show>
    </scrollbox>
  )
}
