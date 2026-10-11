import type { ProjectContexts } from "./contexts"
import type { ProjectScope } from "./scope"

/** Keep sidebar continuation in its source project without selecting that project. */
export async function continueSidebar(
  contexts: ProjectContexts,
  scope: ProjectScope,
  directory: string | undefined,
  progress: (status: string, detail?: string, error?: string) => void,
  operation: () => Promise<void>,
): Promise<void> {
  if (!directory) return operation()
  contexts.pinned()
  const ctx = contexts.byDirectory(directory)
  if (!ctx) return progress("error", undefined, "Source session project is not available")
  await scope.run(ctx, operation)
}
