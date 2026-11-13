import type { ToolRequest } from "./tool-start"
import { parseToolRequest } from "./tool-start"

export function routeToolRequest<T extends object, C extends { id: string }>(
  input: T,
  directory: string | undefined,
  deps: { byDirectory: (value: string) => C | undefined },
): { request: T & { directory?: string }; owner?: C } {
  const request = { ...input, ...(directory ? { directory } : {}) }
  const owner = directory ? deps.byDirectory(directory) : undefined
  if (!owner) return { request }
  return { request, owner }
}

export function handleToolEvent<C extends { id: string }>(
  event: unknown,
  directory: string | undefined,
  contexts: { byDirectory: (value: string) => C | undefined },
  scope: { run: <T>(owner: C, fn: () => Promise<T>) => Promise<T> },
  start: (req: ToolRequest) => Promise<void>,
): void {
  const payload = (event as { data?: unknown }).data
  const req = parseToolRequest(payload, directory)
  if (!req) return
  const routed = routeToolRequest(req, directory, contexts)
  if (routed.owner) {
    void scope.run(routed.owner, () => start(routed.request))
    return
  }
  void start(routed.request)
}