export * as Credential from "./credential"

import { asc, desc, eq } from "drizzle-orm" // kilocode_change
// kilocode_change start
import { Context, Effect, Layer, Option, Schema, Semaphore } from "effect"
// kilocode_change end
import { Database } from "./database/database"
import { IntegrationSchema } from "./integration/schema"
import { NonNegativeInt, withStatics } from "./schema"
import { Identifier } from "./util/identifier"
import { CredentialTable } from "./credential/sql"
// kilocode_change start
import { FSUtil } from "./fs-util"
import { Global } from "./global"
import { DataMigrationTable } from "./data-migration.sql"
import path from "path"
import { parse as parseKiloAccounts } from "./kilocode/credential-migration"
// kilocode_change end

export const ID = Schema.String.pipe(
  Schema.brand("Credential.ID"),
  withStatics((schema) => ({ create: () => schema.make("cred_" + Identifier.ascending()) })),
)
export type ID = typeof ID.Type

export class OAuth extends Schema.Class<OAuth>("Credential.OAuth")({
  type: Schema.Literal("oauth"),
  methodID: IntegrationSchema.MethodID,
  refresh: Schema.String,
  access: Schema.String,
  expires: NonNegativeInt,
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.String)),
}) {}

export class Key extends Schema.Class<Key>("Credential.Key")({
  type: Schema.Literal("key"),
  key: Schema.String,
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.String)),
}) {}

export const Info = Schema.Union([OAuth, Key])
  .pipe(Schema.toTaggedUnion("type"))
  .annotate({ identifier: "Credential.Info" })
export type Info = Schema.Schema.Type<typeof Info>

export class Stored extends Schema.Class<Stored>("Credential.Stored")({
  id: ID,
  integrationID: IntegrationSchema.ID,
  label: Schema.String,
  value: Info,
}) {}

// kilocode_change start - legacy JSON credential stores that predate the integration credential table
const LegacyOAuth = Schema.Struct({
  type: Schema.Literal("oauth"),
  refresh: Schema.String,
  access: Schema.String,
  expires: NonNegativeInt,
  accountId: Schema.optional(Schema.String),
  enterpriseUrl: Schema.optional(Schema.String),
})

const LegacyKey = Schema.Struct({
  type: Schema.Literal("api"),
  key: Schema.String,
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.String)),
})

// recognize config-bootstrap credentials without projecting them into model credentials
const LegacyWellKnown = Schema.Struct({
  type: Schema.Literal("wellknown"),
  key: Schema.String,
  token: Schema.String,
})

const LegacyValue = Schema.Union([LegacyOAuth, LegacyKey])
const LegacyAuth = Schema.Union([LegacyOAuth, LegacyKey, LegacyWellKnown])

const legacyMethod = (integration: IntegrationSchema.ID, type: "oauth" | "api") =>
  IntegrationSchema.MethodID.make(
    type === "api" ? "api-key" : integration === IntegrationSchema.ID.make("openai") ? "chatgpt-browser" : "oauth",
  )

const legacyValue = (integration: IntegrationSchema.ID, credential: Schema.Schema.Type<typeof LegacyValue>): Info =>
  credential.type === "api"
    ? new Key({ type: "key", key: credential.key, metadata: credential.metadata })
    : new OAuth({
        type: "oauth",
        methodID: legacyMethod(integration, credential.type),
        refresh: credential.refresh,
        access: credential.access,
        expires: credential.expires,
        metadata: {
          ...(credential.accountId ? { accountID: credential.accountId } : {}),
          ...(credential.enterpriseUrl ? { enterpriseURL: credential.enterpriseUrl } : {}),
        },
      })
// kilocode_change end

export interface Interface {
  /** Returns every stored credential. */
  readonly all: () => Effect.Effect<Stored[]>
  /** Returns stored credentials belonging to one integration. */
  readonly list: (integrationID: IntegrationSchema.ID) => Effect.Effect<Stored[]>
  /** Returns one stored credential by ID. */
  readonly get: (id: ID) => Effect.Effect<Stored | undefined>
  /** Replaces any credential for an integration and returns the new record. */
  readonly create: (input: {
    readonly integrationID: IntegrationSchema.ID
    readonly value: Info
    readonly label?: string
  }) => Effect.Effect<Stored>
  /** Updates the label or secret value of a stored credential. */
  readonly update: (id: ID, updates: Partial<Pick<Stored, "label" | "value">>) => Effect.Effect<void>
  /** Removes a stored credential. */
  readonly remove: (id: ID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Credential") {}

// kilocode_change start - preserve Kilo's account JSON stores and reconcile auth.json on every startup
export const legacyImportLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service
    // v3 repairs the active-only v2 import while remaining safe for users who already ran it.
    const kiloName = "credential.kilo-account-json-v3"
    if (!(yield* db.select().from(DataMigrationTable).where(eq(DataMigrationTable.name, kiloName)).get())) {
      const current = yield* fs.readJson(path.join(global.data, "account.json")).pipe(Effect.option)
      const prior = yield* fs.readJson(path.join(global.data, "auth-v2.json")).pipe(Effect.option)
      const raw = Option.isSome(current) ? current.value : Option.getOrUndefined(prior)
      const values = parseKiloAccounts(raw).toSorted(
        (a, b) => a.connectorID.localeCompare(b.connectorID) || Number(a.active) - Number(b.active),
      )
      if (values.length > 0) {
        yield* db.transaction((tx) =>
          Effect.gen(function* () {
            const existing = yield* tx.select().from(CredentialTable).all()
            const used = new Set<ID>()
            const created = Date.now()
            for (const [index, item] of values.entries()) {
              const integration = IntegrationSchema.ID.make(item.connectorID.replace(/\/+$/, ""))
              const value = legacyValue(integration, item.credential)
              const current = existing.find(
                (row) =>
                  !used.has(row.id) &&
                  row.integration_id === integration &&
                  row.label === item.label &&
                  JSON.stringify(row.value) === JSON.stringify(value),
              )
              const time = created + index
              if (current) {
                used.add(current.id)
                yield* tx
                  .update(CredentialTable)
                  .set({ time_created: time, time_updated: time })
                  .where(eq(CredentialTable.id, current.id))
                  .run()
                continue
              }
              yield* tx.insert(CredentialTable).values({
                id: ID.make(`cred_kilo_${Buffer.from(item.id).toString("base64url")}`),
                integration_id: integration,
                label: item.label,
                value,
                time_created: time,
                time_updated: time,
              })
            }
            yield* tx.insert(DataMigrationTable).values({ name: kiloName, time_completed: Date.now() }).run()
          }),
        )
      }
    }
    const name = "credential.auth-json"
    const raw = yield* fs.readJson(path.join(global.data, "auth.json")).pipe(Effect.option)
    if (Option.isNone(raw) || typeof raw.value !== "object" || raw.value === null || Array.isArray(raw.value)) return
    const decode = Schema.decodeUnknownOption(LegacyValue)
    const values = Object.entries(raw.value).flatMap(([integrationID, value]) => {
      const decoded = decode(value)
      if (Option.isNone(decoded)) return []
      const integration = IntegrationSchema.ID.make(integrationID.replace(/\/+$/, ""))
      return [{ integration, value: legacyValue(integration, decoded.value) }]
    })
    yield* db.transaction((tx) =>
      Effect.gen(function* () {
        for (const item of values) {
          // reconcile on every startup so a released client can update auth.json after import.
          const current = yield* tx
            .select()
            .from(CredentialTable)
            .where(eq(CredentialTable.integration_id, item.integration))
            .orderBy(desc(CredentialTable.time_created)) // kilocode_change - reconcile the active imported account
            .get()
          if (current) {
            yield* tx.update(CredentialTable).set({ value: item.value }).where(eq(CredentialTable.id, current.id)).run()
            continue
          }
          yield* tx.insert(CredentialTable).values({
            id: ID.create(),
            integration_id: item.integration,
            label: "Imported",
            value: item.value,
          })
        }
        yield* tx.insert(DataMigrationTable).values({ name, time_completed: Date.now() }).onConflictDoNothing().run()
      }),
    )
  }).pipe(Effect.orDie),
)
// kilocode_change end

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    // kilocode_change start
    const fs = Option.getOrUndefined(yield* Effect.serviceOption(FSUtil.Service))
    const global = Option.getOrUndefined(yield* Effect.serviceOption(Global.Service))
    // kilocode_change end
    const decode = Schema.decodeUnknownSync(Info)
    const stored = (row: typeof CredentialTable.$inferSelect) => {
      if (!row.integration_id) return
      return new Stored({
        id: row.id,
        integrationID: row.integration_id,
        label: row.label,
        value: decode(row.value),
      })
    }

    // kilocode_change start - process-local workspace credentials override host storage without being persisted
    const content = process.env.KILO_AUTH_CONTENT
    const injected = yield* content === undefined
      ? Effect.succeed(new Map<IntegrationSchema.ID, Stored>())
      : Effect.try({
          try: () => JSON.parse(content) as unknown,
          catch: (cause) => cause,
        }).pipe(
          Effect.flatMap((raw) => {
            if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
              return Effect.succeed(new Map<IntegrationSchema.ID, Stored>())
            }
            const decode = Schema.decodeUnknownOption(LegacyAuth)
            return Effect.succeed(
              new Map(
                Object.entries(raw).flatMap(([name, raw]) => {
                  const decoded = decode(raw)
                  if (Option.isNone(decoded) || decoded.value.type === "wellknown") return []
                  const integration = IntegrationSchema.ID.make(name.replace(/\/+$/, ""))
                  return [
                    [
                      integration,
                      new Stored({
                        id: ID.make(`cred_env_${Buffer.from(integration).toString("base64url")}`),
                        integrationID: integration,
                        label: "Environment",
                        value: legacyValue(integration, decoded.value),
                      }),
                    ] as const,
                  ]
                }),
              ),
            )
          }),
          Effect.catch((cause) =>
            Effect.logWarning("invalid KILO_AUTH_CONTENT; using no process-local credentials", { cause }).pipe(
              Effect.as(new Map<IntegrationSchema.ID, Stored>()),
            ),
          ),
        )
    const isolated = content !== undefined
    const local = new Map(injected)
    const find = (id: ID) => [...local.values()].find((credential) => credential.id === id)

    const lock = Semaphore.makeUnsafe(1)
    const writeLegacy = (integration: IntegrationSchema.ID) =>
      lock.withPermit(
        Effect.gen(function* () {
          if (!fs || !global || isolated) return
          const file = path.join(global.data, "auth.json")
          const raw = yield* fs.readJson(file).pipe(
            Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed({})),
            Effect.catch((cause) =>
              Effect.logWarning("failed to read legacy auth.json; preserving existing file", { cause }).pipe(
                Effect.as(undefined),
              ),
            ),
          )
          if (raw === undefined) return
          const data: Record<string, unknown> =
            typeof raw === "object" && raw !== null && !Array.isArray(raw)
              ? { ...(raw as Record<string, unknown>) }
              : {}
          const row = yield* db
            .select()
            .from(CredentialTable)
            .where(eq(CredentialTable.integration_id, integration))
            .orderBy(desc(CredentialTable.time_created)) // kilocode_change - persist the active imported account
            .get()
            .pipe(Effect.orDie)
          delete data[integration + "/"]
          if (!row) delete data[integration]
          else {
            const value = decode(row.value)
            data[integration] =
              value.type === "key"
                ? { type: "api", key: value.key, metadata: value.metadata }
                : {
                    type: "oauth",
                    refresh: value.refresh,
                    access: value.access,
                    expires: value.expires,
                    accountId: value.metadata?.accountID,
                    enterpriseUrl: value.metadata?.enterpriseURL,
                  }
          }
          yield* fs.writeJson(file, data, 0o600).pipe(Effect.orDie)
        }),
      )
    // kilocode_change end

    return Service.of({
      all: Effect.fn("Credential.all")(function* () {
        if (isolated) return [...local.values()] // kilocode_change
        return (yield* db
          .select()
          .from(CredentialTable)
          .orderBy(asc(CredentialTable.time_created))
          .all()
          .pipe(Effect.orDie)).flatMap((row) => {
          const credential = stored(row)
          return credential ? [credential] : []
        })
      }),
      list: Effect.fn("Credential.list")(function* (integrationID) {
        // kilocode_change start
        if (isolated) {
          const credential = local.get(integrationID)
          return credential ? [credential] : []
        }
        // kilocode_change end
        return (yield* db
          .select()
          .from(CredentialTable)
          .where(eq(CredentialTable.integration_id, integrationID))
          .orderBy(asc(CredentialTable.time_created))
          .all()
          .pipe(Effect.orDie)).flatMap((row) => {
          const credential = stored(row)
          return credential ? [credential] : []
        })
      }),
      get: Effect.fn("Credential.get")(function* (id) {
        if (isolated) return find(id) // kilocode_change - injected workspace credentials are process-local
        const row = yield* db.select().from(CredentialTable).where(eq(CredentialTable.id, id)).get().pipe(Effect.orDie)
        return row ? stored(row) : undefined
      }),
      create: Effect.fn("Credential.create")(function* (input) {
        const credential = new Stored({
          id: ID.create(),
          integrationID: input.integrationID,
          label: input.label ?? "default",
          value: input.value,
        })
        // kilocode_change start - credential changes in isolated workspaces are process-local
        if (isolated) {
          local.set(credential.integrationID, credential)
          return credential
        }
        // kilocode_change end
        yield* db
          .transaction((tx) =>
            Effect.gen(function* () {
              yield* tx
                .delete(CredentialTable)
                .where(eq(CredentialTable.integration_id, credential.integrationID))
                .run()
              yield* tx
                .insert(CredentialTable)
                .values({
                  id: credential.id,
                  integration_id: credential.integrationID,
                  label: credential.label,
                  value: credential.value,
                })
                .run()
            }),
          )
          .pipe(Effect.orDie)
        yield* writeLegacy(credential.integrationID) // kilocode_change
        return credential
      }),
      update: Effect.fn("Credential.update")(function* (id, updates) {
        if (!updates.label && !updates.value) return
        // kilocode_change start - isolated updates never reach the host database
        if (isolated) {
          const credential = find(id)
          if (!credential) return
          local.set(
            credential.integrationID,
            new Stored({
              ...credential,
              label: updates.label ?? credential.label,
              value: updates.value ?? credential.value,
            }),
          )
          return
        }
        const row = yield* db.select().from(CredentialTable).where(eq(CredentialTable.id, id)).get().pipe(Effect.orDie)
        // kilocode_change end
        yield* db
          .update(CredentialTable)
          .set({ label: updates.label, value: updates.value })
          .where(eq(CredentialTable.id, id))
          .run()
          .pipe(Effect.orDie)
        if (row?.integration_id) yield* writeLegacy(row.integration_id) // kilocode_change
      }),
      remove: Effect.fn("Credential.remove")(function* (id) {
        // kilocode_change start - isolated removals remain process-local
        if (isolated) {
          const credential = find(id)
          if (credential) local.delete(credential.integrationID)
          return
        }
        const row = yield* db.select().from(CredentialTable).where(eq(CredentialTable.id, id)).get().pipe(Effect.orDie)
        // kilocode_change end
        yield* db.delete(CredentialTable).where(eq(CredentialTable.id, id)).run().pipe(Effect.orDie)
        if (row?.integration_id) yield* writeLegacy(row.integration_id) // kilocode_change
      }),
    })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Database.defaultLayer),
  // kilocode_change start
  Layer.provide(FSUtil.defaultLayer),
  Layer.provide(Global.defaultLayer),
  Layer.provideMerge(
    legacyImportLayer.pipe(
      Layer.provide(Database.defaultLayer),
      Layer.provide(FSUtil.defaultLayer),
      Layer.provide(Global.defaultLayer),
    ),
  ),
  // kilocode_change end
)
