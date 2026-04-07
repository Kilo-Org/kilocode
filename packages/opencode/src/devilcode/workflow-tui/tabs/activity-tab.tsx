import { For, Show, createMemo } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { useWorkflow } from "../context"
import type { WorkflowEvent } from "../../workflow/events"

function eventColor(eventType: string, theme: any): string {
  switch (eventType) {
    case "task_completed":
    case "quality_gate_passed":
      return theme.success
    case "task_failed":
    case "task_escalated":
    case "quality_gate_failed":
      return theme.error
    case "preflight_check":
    case "stage_advanced":
      return theme.info ?? theme.primary
    case "files_locked":
    case "files_unlocked":
      return theme.warning
    case "lesson_captured":
      return theme.primary
    default:
      return theme.text
  }
}

function formatTimestamp(ts: string | undefined): string {
  if (!ts) return ""
  try {
    const date = new Date(ts)
    const hours = date.getHours().toString().padStart(2, "0")
    const minutes = date.getMinutes().toString().padStart(2, "0")
    const seconds = date.getSeconds().toString().padStart(2, "0")
    return `${hours}:${minutes}:${seconds}`
  } catch {
    return ""
  }
}

function formatDuration(ms: number | undefined): string {
  if (!ms) return ""
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export function ActivityTab() {
  const { theme } = useTheme()
  const wf = useWorkflow()

  const sortedEvents = createMemo(() => {
    return [...wf.events].reverse()
  })

  return (
    <scrollbox flexGrow={1} paddingLeft={1} paddingRight={1}>
      <Show
        when={sortedEvents().length > 0}
        fallback={
          <text fg={theme.textMuted}>
            No workflow events yet. Start a workflow to see activity.
          </text>
        }
      >
        <For each={sortedEvents()}>
          {(event) => (
            <box flexDirection="row" gap={1} marginBottom={0}>
              <text fg={theme.textMuted} minWidth={8}>
                {formatTimestamp(event.timestamp)}
              </text>
              <text fg={eventColor(event.eventType, theme)} minWidth={22}>
                {event.eventType}
              </text>
              <Show when={event.taskId}>
                <text fg={theme.textMuted} minWidth={8}>
                  {event.taskId}
                </text>
              </Show>
              <text fg={theme.text} flexGrow={1}>
                {event.message}
              </text>
              <Show when={event.durationMs}>
                <text fg={theme.textMuted}>
                  {formatDuration(event.durationMs)}
                </text>
              </Show>
            </box>
          )}
        </For>
      </Show>
    </scrollbox>
  )
}
