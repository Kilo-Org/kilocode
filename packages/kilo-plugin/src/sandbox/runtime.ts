import { Context, type Effect } from "effect"
import type { KiloSandboxRpc } from "@opencode/schema/kilocode/sandbox"
import type { Session } from "@opencode/schema/session"
import type { SessionID } from "@opencode/schema/session-id"
import type { SandboxConfig } from "./config"

export type Target = { id: SessionID; directory: string }

/** The Location services the sandbox policy reads. The sandbox plugin provides them for its Location. */
export interface Interface {
  readonly directory: string
  /** The project root: the repository worktree that contains `directory`. */
  readonly worktree: string
  readonly config: Effect.Effect<{ sandbox?: SandboxConfig.Info }>
  readonly session: (sessionID: SessionID) => Effect.Effect<Session.Info | undefined>
  readonly children: (sessionID: SessionID) => Effect.Effect<readonly Target[]>
  readonly active: Effect.Effect<ReadonlySet<string>>
  /** Sessions that own a running background job (for example a background shell command). */
  readonly background: Effect.Effect<ReadonlySet<string>>
  readonly publish: (event: KiloSandboxRpc.Changed) => Effect.Effect<void>
}

export class Runtime extends Context.Service<Runtime, Interface>()("@kilocode/kilo-plugin/SandboxRuntime") {}
