// Views of a task paused by a subagent-view interrupt: the parent's task card
// and the subagent footer hint. See ./task-pause.ts for how the pause is read.
import { createMemo, Show, type Accessor } from "solid-js"
import { useSync } from "../context/sync"
import { useTheme } from "../context/theme"
import { useCommandShortcut } from "../keymap"
import { KiloTaskPause } from "./task-pause"

/**
 * Task card state for a subagent's task. A paused task waits on the user instead of
 * showing a spinner or a finished detail; foreground tasks can still go to the background.
 */
export function useTaskCard(
  session: Accessor<string | undefined>,
  task: { part: { state: { status: string } }; metadata: { background?: unknown } },
) {
  const sync = useSync()
  const key = useCommandShortcut("session.background")
  const paused = createMemo(() => KiloTaskPause.paused(sync.session.get(session() ?? "")))
  // a foreground task is still running its tool call; promotion moves it to the background
  const foreground = () => task.part.state.status === "running" && task.metadata.background !== true
  return {
    paused,
    line: () => `↳ ${KiloTaskPause.detail(foreground(), key())}`,
  }
}

/** Subagent footer hint while the parent's task is paused until a new prompt resumes it. */
export function PausedHint(props: { when: boolean }) {
  const { theme } = useTheme()
  return (
    <Show when={props.when}>
      <text fg={theme.text} wrapMode="none">
        Interrupted · <span style={{ fg: theme.textMuted }}>send a prompt to resume</span>
      </text>
    </Show>
  )
}
