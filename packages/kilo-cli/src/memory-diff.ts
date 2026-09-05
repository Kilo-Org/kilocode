import type { MemoryPorts } from "@kilocode/kilo-memory/effect/ports"
import type { Instance } from "@opencode-ai/core/instance/service"
import type { Session } from "@opencode-ai/core/session"
import { Snapshot } from "@opencode-ai/core/snapshot"
import { Effect } from "effect"

export type MemoryDiffReader = (input: {
  readonly sessionID: Session.ID
  readonly start: Snapshot.ID
  readonly end: Snapshot.ID
}) => Effect.Effect<NonNullable<MemoryPorts.TurnView["diffs"]> | undefined, never>

type Services = { readonly sessions: Pick<Session.Interface, "get">; readonly instances: Instance.Interface }

/** Reads an assistant group's durable snapshot span in its owning Location scope. */
export function createMemoryDiffReader(services: Services): MemoryDiffReader {
  return (input) =>
    Effect.gen(function* () {
      const session = yield* services.sessions.get(input.sessionID)
      const files = yield* Snapshot.Service.use((snapshot) => snapshot.diff({ from: input.start, to: input.end })).pipe(
        services.instances.provide(session),
      )
      return files.map((file) => ({
        file: file.file,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
      }))
    }).pipe(Effect.orElseSucceed(() => undefined))
}
