// packages/opencode/src/devilcode/workflow-tui/task-panel.tsx
import { For, Show, createMemo } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useTheme } from "@tui/context/theme"
import { useWorkflow } from "./context"
import { taskStatusIcon } from "./types"
import { groupByWave } from "../workflow/executor"

export function TaskPanel() {
  const { theme } = useTheme()
  const wf = useWorkflow()

  const waves = createMemo(() => groupByWave(wf.plans))

  const completedCount = createMemo(() => {
    const active = wf.state?.activeTasks ?? []
    return active.filter((t) => t.status === "completed").length
  })

  return (
    <box
      flexDirection="column"
      width={32}
      backgroundColor={theme.backgroundPanel}
      paddingTop={1}
      paddingLeft={2}
      paddingRight={1}
    >
      <text fg={theme.text} attributes={TextAttributes.BOLD}>
        TASKS
      </text>
      <text fg={theme.border}>{"─".repeat(28)}</text>

      <scrollbox flexGrow={1}>
        <Show
          when={wf.plans.length > 0}
          fallback={<text fg={theme.textMuted}>No tasks planned yet</text>}
        >
          <For each={[...waves().entries()]}>
            {([waveNum, tasks]) => (
              <box flexDirection="column" marginBottom={1}>
                <text fg={theme.textMuted}>{"Wave " + waveNum}</text>
                <For each={tasks}>
                  {(task) => {
                    const activeTask = createMemo(() =>
                      wf.state?.activeTasks.find((t) => t.id === task.id),
                    )
                    const status = createMemo(() => activeTask()?.status ?? "pending")
                    const icon = createMemo(() => taskStatusIcon(status()))
                    const isSelected = createMemo(() => wf.selectedTask === task.id)
                    const statusColor = createMemo(() => {
                      switch (status()) {
                        case "completed":
                          return theme.success
                        case "in_progress":
                          return theme.warning
                        case "failed":
                          return theme.error
                        case "escalated":
                          return theme.error
                        case "blocked":
                          return theme.textMuted
                        default:
                          return theme.textMuted
                      }
                    })

                    return (
                      <box
                        flexDirection="row"
                        gap={1}
                        onMouseDown={() => wf.selectTask(task.id)}
                      >
                        <text fg={isSelected() ? theme.primary : theme.text}>
                          {isSelected() ? ">" : " "}
                        </text>
                        <text fg={statusColor()}>{icon()}</text>
                        <text
                          fg={isSelected() ? theme.primary : theme.text}
                          flexGrow={1}
                          overflow="hidden"
                        >
                          {task.id + " " + task.title}
                        </text>
                        <text fg={theme.textMuted}>{task.role}</text>
                      </box>
                    )
                  }}
                </For>
              </box>
            )}
          </For>
        </Show>
      </scrollbox>

      <text fg={theme.border}>{"─".repeat(28)}</text>
      <text fg={theme.textMuted}>
        {"Progress: " + completedCount() + "/" + wf.plans.length + " tasks"}
      </text>
    </box>
  )
}
