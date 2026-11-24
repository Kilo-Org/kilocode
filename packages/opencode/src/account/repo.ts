import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { eq } from "drizzle-orm"
import { serviceUse } from "@opencode-ai/core/effect/service-use"
import { Effect, Layer, Option, Schema, Context } from "effect"

import { Database } from "@opencode-ai/core/database/database"
import { AccountStateTable, AccountTable } from "@opencode-ai/core/account/sql"
// kilocode_change start
import { accountKey, normalizeServerUrl } from "@opencode-ai/core/account/key"
// kilocode_change end
import { AccessToken, AccountID, AccountRepoError, Info, OrgID, RefreshToken, RemoteID } from "./schema" // kilocode_change

export type AccountRow = (typeof AccountTable)["$inferSelect"]

const ACCOUNT_STATE_ID = 1

export interface Interface {
  readonly active: () => Effect.Effect<Option.Option<Info>, AccountRepoError>
  readonly list: () => Effect.Effect<Info[], AccountRepoError>
  readonly remove: (accountID: AccountID) => Effect.Effect<void, AccountRepoError>
  readonly use: (accountID: AccountID, orgID: Option.Option<OrgID>) => Effect.Effect<void, AccountRepoError>
  // kilocode_change start
  /** The organization stored for the account that holds the account state, or none otherwise. */
  readonly selected: (accountID: AccountID) => Effect.Effect<Option.Option<OrgID>, AccountRepoError>
  // kilocode_change end
  readonly getRow: (accountID: AccountID) => Effect.Effect<Option.Option<AccountRow>, AccountRepoError>
  readonly persistToken: (input: {
    accountID: AccountID
    accessToken: AccessToken
    refreshToken: RefreshToken
    expiry: Option.Option<number>
  }) => Effect.Effect<void, AccountRepoError>
  readonly persistAccount: (input: {
    remoteID: RemoteID // kilocode_change
    email: string
    url: string
    accessToken: AccessToken
    refreshToken: RefreshToken
    expiry: number
    orgID: Option.Option<OrgID>
  }) => Effect.Effect<void, AccountRepoError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/AccountRepo") {}

export const use = serviceUse(Service)

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const decode = Schema.decodeUnknownSync(Info)

    const query = <A, E>(effect: Effect.Effect<A, E>) =>
      effect.pipe(Effect.mapError((cause) => new AccountRepoError({ message: "Database operation failed", cause })))

    const current = Effect.fnUntraced(function* () {
      const state = yield* db.select().from(AccountStateTable).where(eq(AccountStateTable.id, ACCOUNT_STATE_ID)).get()
      if (!state?.active_account_id) return
      const account = yield* db.select().from(AccountTable).where(eq(AccountTable.id, state.active_account_id)).get()
      if (!account) return
      return { ...account, active_org_id: state.active_org_id ?? null }
    })

    const state = (accountID: AccountID, orgID: Option.Option<OrgID>) => {
      const id = Option.getOrNull(orgID)
      return db
        .insert(AccountStateTable)
        .values({ id: ACCOUNT_STATE_ID, active_account_id: accountID, active_org_id: id })
        .onConflictDoUpdate({
          target: AccountStateTable.id,
          set: { active_account_id: accountID, active_org_id: id },
        })
        .run()
    }

    const active = Effect.fn("AccountRepo.active")(() =>
      query(current()).pipe(Effect.map((row) => (row ? Option.some(decode(row)) : Option.none()))),
    )

    const list = Effect.fn("AccountRepo.list")(() =>
      query(
        db
          .select()
          .from(AccountTable)
          .all()
          .pipe(Effect.map((rows) => rows.map((row: AccountRow) => decode({ ...row, active_org_id: null })))),
      ),
    )

    const remove = Effect.fn("AccountRepo.remove")((accountID: AccountID) =>
      query(
        db.transaction((tx) =>
          Effect.gen(function* () {
            yield* tx
              .update(AccountStateTable)
              .set({ active_account_id: null, active_org_id: null })
              .where(eq(AccountStateTable.active_account_id, accountID))
              .run()
            yield* tx.delete(AccountTable).where(eq(AccountTable.id, accountID)).run()
          }),
        ),
      ).pipe(Effect.asVoid),
    )

    const use = Effect.fn("AccountRepo.use")((accountID: AccountID, orgID: Option.Option<OrgID>) =>
      query(state(accountID, orgID)).pipe(Effect.asVoid),
    )

    // kilocode_change start
    const selected = Effect.fn("AccountRepo.selected")((accountID: AccountID) =>
      query(db.select().from(AccountStateTable).where(eq(AccountStateTable.id, ACCOUNT_STATE_ID)).get()).pipe(
        Effect.map((row) => {
          if (!row) return Option.none<OrgID>()
          if (row.active_account_id !== accountID) return Option.none<OrgID>()
          if (row.active_org_id === null || row.active_org_id === undefined) return Option.none<OrgID>()
          return Option.some(row.active_org_id)
        }),
      ),
    )
    // kilocode_change end

    const getRow = Effect.fn("AccountRepo.getRow")((accountID: AccountID) =>
      query(db.select().from(AccountTable).where(eq(AccountTable.id, accountID)).get()).pipe(
        Effect.map(Option.fromNullishOr),
      ),
    )

    const persistToken = Effect.fn("AccountRepo.persistToken")((input) =>
      query(
        db
          .update(AccountTable)
          .set({
            access_token: input.accessToken,
            refresh_token: input.refreshToken,
            token_expiry: Option.getOrNull(input.expiry),
          })
          .where(eq(AccountTable.id, input.accountID))
          .run(),
      ).pipe(Effect.asVoid),
    )

    const persistAccount = Effect.fn("AccountRepo.persistAccount")((input) =>
      query(
        db.transaction((tx) =>
          Effect.gen(function* () {
            // kilocode_change start
            const url = normalizeServerUrl(input.url)
            const id = accountKey(url, input.remoteID)

            yield* tx
              .insert(AccountTable)
              .values({
                id,
                email: input.email,
                url,
                access_token: input.accessToken,
                refresh_token: input.refreshToken,
                token_expiry: input.expiry,
              })
              .onConflictDoUpdate({
                target: AccountTable.id,
                set: {
                  email: input.email,
                  access_token: input.accessToken,
                  refresh_token: input.refreshToken,
                  token_expiry: input.expiry,
                },
              })
              .run()
            yield* state(id, input.orgID)
            // kilocode_change end
          }),
        ),
      ).pipe(Effect.asVoid),
    )

    return Service.of({
      active,
      list,
      remove,
      use,
      selected, // kilocode_change
      getRow,
      persistToken,
      persistAccount,
    })
  }),
)

export const node = LayerNode.make({ service: Service, layer: layer, deps: [Database.node] })

export * as AccountRepo from "./repo"
