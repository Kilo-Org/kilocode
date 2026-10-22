import { adjacentHint, worktreeNavId } from "./navigate"
import { buildSidebarOrder } from "./section-helpers"

export function projectSidebarOrder(...args: Parameters<typeof buildSidebarOrder>): string[] {
  return buildSidebarOrder(...args).map((item) => item.id)
}

export function projectAdjacentHint(
  projectId: string,
  activeProjectId: string | undefined,
  itemId: string,
  activeId: string | undefined,
  flatIds: string[],
  prev: string,
  next: string,
): string {
  if (projectId !== activeProjectId) return ""
  return adjacentHint(itemId, activeId, flatIds, prev, next)
}

interface Input {
  projectId: string
  activeProjectId?: string
  worktreeId: string
  activeId?: string
  flatIds: string[]
  bindings: Record<string, string>
  shortcuts?: Map<string, number>
}

/** Resolve the project-scoped values rendered by one worktree row. */
export function projectWorktreeRow(input: Input) {
  return {
    shortcut: input.shortcuts?.get(worktreeNavId(input.projectId, input.worktreeId)),
    navHint: projectAdjacentHint(
      input.projectId,
      input.activeProjectId,
      input.worktreeId,
      input.activeId,
      input.flatIds,
      input.bindings.previousSession ?? "",
      input.bindings.nextSession ?? "",
    ),
    closeKeybind: input.bindings.closeWorktree ?? "",
    openKeybind: input.bindings.openWorktree ?? "",
  }
}
