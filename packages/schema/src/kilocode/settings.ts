export * as KiloSettingsRpc from "./settings.js"

import { Schema } from "effect"
import { Rpc } from "../rpc.js"
import { optional } from "../schema.js"

// The `kilocode.settings` RPC contract: write `kilo2.json` at the global or project scope, with the revision conflict
// guard the v1 `PATCH /config/overlay` carried. The settings plugin in packages/kilo-plugin registers the handler and
// writes through `KiloConfigWriter`; clients import this contract from `@opencode/schema/kilocode/settings`.
//
// The generic `rpc.call` route answers every handler error with HTTP 400, so the contract returns the conflict detail
// as structured error data: a client turns `conflict` into 409 and shows the current `target` for a retry, and the
// other names into a failure status. `target` reads the file a write resolves to and its revision before a write.
//
// The v1 `shadow` check (a nearer file wins, so the write would not take effect) is deliberately not carried. Its
// v1 implementation compared the raw patch against every later-loading source, but a project document that sets a
// Kilo key can load after the global target while the key is still governed by any-value rules (privacy mode is on
// when any document sets `true`), so a blocking structural check would reject correct writes. The writer targets the
// same file order the reader uses, and v2 reloads the effective config after a write, so the client observes an
// override through `config.updated` instead of a pre-write gate. Managed-source precedence remains in slice 3.
const portable = Schema.toStandardSchemaV1

export const Scope = Schema.Literals(["global", "project"])
export type Scope = typeof Scope.Type

export const Target = Schema.Struct({
  scope: Scope,
  /** The file a write to this scope resolves to: the first existing write candidate, else the created `newFile`. */
  path: Schema.String,
  /** sha256 of the file content; omitted while the file does not exist, when a write creates it. */
  revision: optional(Schema.String),
  exists: Schema.Boolean,
})
export type Target = typeof Target.Type

export const Result = Schema.Struct({
  scope: Scope,
  /** The target after the write, with its new revision, for the next optimistic write. */
  target: Target,
  changed: Schema.Boolean,
})
export type Result = typeof Result.Type

export const Conflict = Schema.Struct({
  /** `target-changed` when a nearer file became the write target; `revision-conflict` when its bytes moved. */
  code: Schema.Literals(["target-changed", "revision-conflict"]),
  /** The current target and revision, so the client can refresh and retry. */
  target: Target,
})
export type Conflict = typeof Conflict.Type

export const Invalid = Schema.Struct({
  message: Schema.String,
  path: optional(Schema.String),
})
export type Invalid = typeof Invalid.Type

export const Failed = Schema.Struct({ message: Schema.String })
export type Failed = typeof Failed.Type

export const Definition = Rpc.define({
  id: "kilocode.settings",
  methods: {
    /** The file a write to `scope` resolves to, with its current revision. */
    target: {
      input: portable(Schema.Struct({ scope: Scope })),
      output: portable(Target),
      errors: { failed: portable(Failed) },
    },
    /**
     * Set the keys of `set` and remove the paths of `unset` in the scope's document. `set` values are set at their
     * leaf paths; a `null` value removes. A project `unset` also clears the path from the other project documents
     * that set it. `expected` fails a stale revision or a changed target instead of overwriting a newer file.
     */
    write: {
      input: portable(
        Schema.Struct({
          scope: Scope,
          set: optional(Schema.Record(Schema.String, Schema.Unknown)),
          unset: optional(Schema.Array(Schema.Array(Schema.String))),
          expected: optional(Schema.Struct({ path: Schema.String, revision: Schema.String })),
        }),
      ),
      output: portable(Result),
      errors: {
        conflict: portable(Conflict),
        invalid: portable(Invalid),
        failed: portable(Failed),
      },
    },
  },
  events: {},
})
