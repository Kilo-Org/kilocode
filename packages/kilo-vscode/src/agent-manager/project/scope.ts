import { AsyncLocalStorage } from "async_hooks"
import type { ProjectContext } from "./context"

/** Pins dynamic provider getters to the project that started an async operation. */
export class ProjectScope {
  private readonly storage = new AsyncLocalStorage<ProjectContext>()

  current(): ProjectContext | undefined {
    return this.storage.getStore()
  }

  run<T>(ctx: ProjectContext, operation: () => Promise<T>): Promise<T> {
    return this.storage.run(ctx, operation)
  }
}
