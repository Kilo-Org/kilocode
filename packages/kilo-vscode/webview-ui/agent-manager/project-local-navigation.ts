import { adjacentHint } from "./navigate"
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
