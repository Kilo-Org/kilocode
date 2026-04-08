// packages/opencode/src/devilcode/workflow-tui/task-panel.tsx
import { For, Show, createMemo } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { useTheme } from "@tui/context/theme"
import { useWorkflow } from "./context"
import { taskStatusIcon } from "./types"
import { groupByWave } from "../workflow/executor"

export function TaskPanel() {
  const { theme } = useTheme()
  const wf = useWorkflow()

  const waves = createMemo(() => groupByWave(wf.plans))

  const flatTaskIds = createMemo(() => {
    const ids: string[] = []
    for (const [, tasks] of waves()) {
      for (const task of tasks) {
        ids.push(task.id)
      }
    }
    return ids
  })

  useKeyboard((evt) => {
    const ids = flatTaskIds()
    if (ids.length === 0) return
    if (evt.name === "up" || evt.name === "k") {
      evt.preventDefault()
      const currentIndex = ids.indexOf(wf.selectedTask ?? "")
      const nextIndex = currentIndex <= 0 ? ids.length - 1 : currentIndex - 1
      wf.selectTask(ids[nextIndex]!)
    }
    if (evt.name === "down" || evt.name === "j") {
      evt.preventDefault()
      const currentIndex = ids.indexOf(wf.selectedTask ?? "")
      const nextIndex = currentIndex < 0 || currentIndex >= ids.length - 1 ? 0 : currentIndex + 1
      wf.selectTask(ids[nextIndex]!)
    }
  })

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
      <text fg={theme.primary} attributes={TextAttributes.BOLD}>
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
