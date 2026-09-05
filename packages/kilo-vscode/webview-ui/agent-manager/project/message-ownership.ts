export function ownsProject(message: { projectId?: string }, project: string | undefined): boolean {
  return !message.projectId || message.projectId === project
}

export function ownsParent(
  projects: Record<string, { sessions: Array<{ id: string }> }>,
  parent: string,
  project: string | undefined,
): boolean {
  const owner = Object.entries(projects).find(([, state]) => state.sessions.some((item) => item.id === parent))
  return !owner || owner[0] === project
}

export function isCurrent(message: { projectId?: string }, project: string | undefined): boolean {
  return ownsProject(message, project)
}
