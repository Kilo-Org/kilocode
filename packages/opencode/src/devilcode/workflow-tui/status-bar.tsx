// packages/opencode/src/devilcode/workflow-tui/status-bar.tsx
import { Show } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { useWorkflow } from "./context"
import { stageColor } from "./types"

export function WorkflowStatusBar() {
  const { theme } = useTheme()
  const wf = useWorkflow()

  return (
    <box
      flexDirection="row"
      height={1}
      backgroundColor={theme.backgroundPanel}
      paddingLeft={2}
      paddingRight={2}
      gap={2}
      alignItems="center"
    >
      <Show
        when={wf.state}
        fallback={
          <text fg={theme.textMuted}>No workflow initialized. Run /team init to create one.</text>
        }
      >
        {(state) => (
          <>
            <text fg={theme.primary}>
              <b>{"◆ " + (state().currentPhase || "(no phase)")}</b>
            </text>
            <text fg={stageColor(state().currentStage)}>
              <b>{state().currentStage.toUpperCase()}</b>
            </text>
            <Show when={state().activeWave !== undefined && state().totalWaves !== undefined}>
              <text fg={theme.text}>
                {"Wave " + state().activeWave + "/" + state().totalWaves}
              </text>
            </Show>
            <Show when={wf.executing}>
              <text fg={theme.warning}>{wf.pauseRequested ? "● PAUSING" : "● EXECUTING"}</text>
            </Show>
            <Show when={!wf.executing && state().currentStage === "build" && state().activeTasks.some((task) => task.status === "pending")}>
              <text fg={theme.warning}>● PAUSED</text>
            </Show>
          </>
        )}
      </Show>
    </box>
  )
}
