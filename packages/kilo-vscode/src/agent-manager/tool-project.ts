import type { ToolRequest } from "./tool-start"
import { parseToolRequest } from "./tool-start"

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

export function handleToolEvent<C extends { id: string }>(
  event: unknown,
  directory: string | undefined,
  contexts: { byDirectory: (value: string) => C | undefined; usable: (id: string) => C | undefined },
  scope: { run: <T>(owner: C, fn: () => Promise<T>) => Promise<T> },
  start: (req: ToolRequest) => Promise<void>,
): void {
  const properties = (event as { properties?: unknown }).properties
  const req = parseToolRequest(properties)
  if (!req) return
  const routed = routeToolRequest(req, directory, contexts)
  if (routed.owner) {
    void scope.run(routed.owner, () => start(routed.request))
    return
  }
  void start(routed.request)
}
