export function routeToolRequest<T extends { projectId?: string; directory?: string }, C extends { id: string }>(
  input: T,
  directory: string | undefined,
  deps: { byDirectory: (value: string) => C | undefined; usable: (id: string) => C | undefined },
): { request: T; owner?: C } {
  const request = directory ? { ...input, directory } : input
  const owner =
    (directory && deps.byDirectory(directory)) ?? (request.projectId ? deps.usable(request.projectId) : undefined)
  if (!owner) return { request }
  return { request: { ...request, projectId: owner.id }, owner }
}
