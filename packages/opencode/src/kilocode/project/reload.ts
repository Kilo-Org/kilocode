import { Effect } from "effect"
import { InstanceStore } from "@/project/instance-store"

/** Reload every loaded instance that belongs to a project. */
export const reloadProject = (store: InstanceStore.Interface, projectID: string): Effect.Effect<void> =>
  Effect.gen(function* () {
    for (const ctx of yield* store.list()) {
      if (String(ctx.project.id) !== projectID) continue
      yield* store
        .reload({ directory: ctx.directory, worktree: ctx.worktree, project: ctx.project })
        .pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("project instance reload failed", { directory: ctx.directory, cause }),
          ),
        )
    }
  })
