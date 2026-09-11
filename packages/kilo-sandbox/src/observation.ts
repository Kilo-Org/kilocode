import { Context } from "effect"

/** Optional host audit context, propagated through the native process and I/O services. */
export interface ExecutionObservation {
  call: string
  verify(): void
  emit(kind: "execution_started" | "execution_finished", detail: Record<string, unknown>): void
}
export const ExecutionObservation = Context.Reference<ExecutionObservation | undefined>("autoguard/Observation", {
  defaultValue: () => undefined,
})
