import { Effect } from "effect"
import { InstanceStore } from "@/project/instance-store"

/**
 * Reload every loaded instance that belongs to a project.
 *
 * Failures for the directory the request came from propagate so callers still
 * see a failed reboot. Failures for sibling instances are logged and skipped.
 */
export const reloadProject = (
  store: InstanceStore.Interface,
  projectID: string,
  requestDirectory: string,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    for (const ctx of yield* store.list()) {
      if (String(ctx.project.id) !== projectID) continue
      const reload = store.reload({ directory: ctx.directory, worktree: ctx.worktree, project: ctx.project })
      if (ctx.directory === requestDirectory) {
        yield* reload
        continue
      }
      yield* reload.pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("project instance reload failed", { directory: ctx.directory, cause }),
        ),
      )
    }
  })
