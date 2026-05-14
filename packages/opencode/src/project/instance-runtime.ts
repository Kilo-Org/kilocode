import { AppRuntime } from "@/effect/app-runtime"
import { type InstanceContext } from "./instance-context"
import { InstanceStore, type LoadInput } from "./instance-store"

// Bridge for Promise/ALS callers that cannot yet yield InstanceStore.Service.
// Delete this module once those callers are migrated to Effect boundaries that
// provide InstanceStore directly.

export const load = (input: LoadInput): Promise<InstanceContext> =>
  AppRuntime.runPromise(InstanceStore.Service.use((store) => store.load(input)))
export const disposeInstance = (ctx: InstanceContext): Promise<void> =>
  AppRuntime.runPromise(InstanceStore.Service.use((store) => store.dispose(ctx)))
export const disposeAllInstances = (): Promise<void> =>
  AppRuntime.runPromise(InstanceStore.Service.use((store) => store.disposeAll()))
export const reloadInstance = (input: LoadInput): Promise<InstanceContext> =>
  AppRuntime.runPromise(InstanceStore.Service.use((store) => store.reload(input)))

export * as InstanceRuntime from "./instance-runtime"
