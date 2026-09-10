import { KiloGateway } from "@opencode-ai/schema/kilocode/gateway"
import { Effect, Option, Schema } from "effect"
import { createHash } from "node:crypto"
import { CatalogResponse } from "./models.js"
import type { GatewayContext } from "./plugin.js"

const Snapshot = Schema.Struct({
  identity: Schema.String,
  created: Schema.Finite,
  organizationID: Schema.NullOr(Schema.String),
  profile: Schema.optionalKey(KiloGateway.Profile),
  catalog: CatalogResponse,
})

// One bounded snapshot per plugin. Locations may share raw catalog data for the same account;
// each Location still applies its own configuration and policy. No credential material is persisted.
const key = "startup-catalog:v1"
export const snapshotLifetime = 60_000

export function scopeIdentity(server: string, token?: string, connectionID?: string, organizationID?: string | null) {
  return createHash("sha256").update(JSON.stringify({ server, token, connectionID, organizationID })).digest("hex")
}

export function readSnapshot(storage: GatewayContext["storage"], identity: string) {
  return storage.get(key).pipe(
    Effect.map((value) => {
      const snapshot = Option.getOrUndefined(Schema.decodeUnknownOption(Snapshot)(value))
      if (!snapshot || snapshot.identity !== identity) return
      const age = Date.now() - snapshot.created
      if (age < 0 || age >= snapshotLifetime) return
      return snapshot
    }),
  )
}

export function writeSnapshot(storage: GatewayContext["storage"], snapshot: typeof Snapshot.Type) {
  return Schema.encodeUnknownEffect(Schema.toCodecJson(Snapshot))(snapshot).pipe(
    Effect.flatMap((value) => storage.set(key, value)),
    Effect.catch(() => Effect.void),
  )
}

export function clearSnapshot(storage: GatewayContext["storage"], identity: string) {
  return storage.get(key).pipe(
    Effect.flatMap((value) => {
      const owner = Option.getOrUndefined(Schema.decodeUnknownOption(Schema.Struct({ identity: Schema.String }))(value))
      return owner?.identity === identity ? storage.remove(key) : Effect.void
    }),
  )
}
