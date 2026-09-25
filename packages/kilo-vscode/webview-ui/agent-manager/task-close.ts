/**
 * Task-tab helpers for the tab bar's close actions.
 *
 * `Close Task` and `Close All Tasks` close through the tab bar's own close
 * handler rather than reimplementing it, so suppression of closed Local
 * sessions, draft cleanup, and focus restore stay in one place.
 */

/** The task tab the user is on, if it is still open. */
export function activeTask(
  tasks: readonly { id: string }[],
  current: string | undefined,
  pending: string | undefined,
): string | undefined {
  const id = current ?? pending
  return id && tasks.some((task) => task.id === id) ? id : undefined
}

/** Close the focused tab, ignoring terminal, review, and subagent tabs. */
export function closeFocusedTask(
  id: string | undefined,
  tasks: ReadonlyMap<string, unknown>,
  close: (id: string) => void,
) {
  if (!id || !tasks.has(id)) return
  close(id)
}

/**
 * Close every task tab.
 *
 * The active tab goes last. Closing a non-active tab moves no selection, so
 * selection never lands on a tab that is about to close, and the final close
 * finds no tab left to select and clears the chat.
 */
export function closeAllTasks(
  tasks: readonly { id: string }[],
  active: string | undefined,
  close: (id: string) => void,
) {
  for (const task of tasks) {
    if (task.id !== active) close(task.id)
  }
  if (active && tasks.some((task) => task.id === active)) close(active)
}
