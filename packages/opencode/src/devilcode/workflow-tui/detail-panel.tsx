// packages/opencode/src/devilcode/workflow-tui/detail-panel.tsx
import { Show, Switch, Match, createMemo } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { useWorkflow } from "./context"
import { TabBar } from "./tabs/tab-bar"
import { AgentOutputTab } from "./tabs/agent-output-tab"
import { PlanTab } from "./tabs/plan-tab"
import { ChallengeTab } from "./tabs/challenge-tab"
import { ReviewTab } from "./tabs/review-tab"

export function DetailPanel() {
  const { theme } = useTheme()
  const wf = useWorkflow()

  const activeTabInfo = createMemo(() => wf.tabs.find((t) => t.id === wf.activeTab))

  return (
    <box
      flexDirection="column"
      flexGrow={1}
      backgroundColor={theme.background}
      paddingLeft={1}
      minHeight={0}
    >
      <TabBar />
      <box
        flexGrow={1}
        flexDirection="column"
        border={["top"]}
        borderColor={theme.border}
        minHeight={0}
      >
        <Switch fallback={<text fg={theme.textMuted}>Select a tab</text>}>
          <Match when={activeTabInfo()?.kind === "agent"}>
            <AgentOutputTab tabId={wf.activeTab} />
          </Match>
          <Match when={activeTabInfo()?.kind === "plan"}>
            <PlanTab />
          </Match>
          <Match when={activeTabInfo()?.kind === "challenge"}>
            <ChallengeTab />
          </Match>
          <Match when={activeTabInfo()?.kind === "review"}>
            <ReviewTab />
          </Match>
        </Switch>
      </box>
    </box>
  )
}
