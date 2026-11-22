import { expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect, Layer, Option } from "effect"
import { sql } from "drizzle-orm"

// kilocode_change start
import { accountKey } from "@opencode-ai/core/account/key"
import { AccountRepo } from "../../src/account/repo"
import { AccessToken, AccountID, OrgID, RefreshToken, RemoteID } from "../../src/account/schema"
// kilocode_change end
import { Database } from "@opencode-ai/core/database/database"
import { testEffect } from "../lib/effect"

const truncate = Layer.effectDiscard(
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* db.run(sql`DELETE FROM account_state`)
    yield* db.run(sql`DELETE FROM account`)
  }),
)
const truncateNode = LayerNode.make({ name: "truncate-account", layer: truncate, deps: [Database.node] })

const it = testEffect(LayerNode.compile(LayerNode.group([AccountRepo.node, truncateNode])))

// kilocode_change start
const CONTROL_URL = "https://control.example.com"

// A stored account is keyed by its normalized server URL and the server-issued user id.
const storedKey = (remoteID: string, url = CONTROL_URL) => accountKey(url, remoteID)
// kilocode_change end

it.live("list returns empty when no accounts exist", () =>
  Effect.gen(function* () {
    const accounts = yield* AccountRepo.use.list()
    expect(accounts).toEqual([])
  }),
)

it.live("active returns none when no accounts exist", () =>
  Effect.gen(function* () {
    const active = yield* AccountRepo.use.active()
    expect(Option.isNone(active)).toBe(true)
  }),
)

// kilocode_change start
it.live("persistAccount inserts and getRow retrieves", () =>
  Effect.gen(function* () {
    const id = storedKey("user-1")
    yield* AccountRepo.Service.use((r) =>
      r.persistAccount({
        remoteID: RemoteID.make("user-1"),
        email: "test@example.com",
        url: CONTROL_URL,
        accessToken: AccessToken.make("at_123"),
        refreshToken: RefreshToken.make("rt_456"),
        expiry: Date.now() + 3600_000,
        orgID: Option.some(OrgID.make("org-1")),
      }),
    )

    const row = yield* AccountRepo.use.getRow(id)
    expect(Option.isSome(row)).toBe(true)
    const value = Option.getOrThrow(row)
    expect(value.id).toBe(storedKey("user-1"))
    expect(value.url).toBe(CONTROL_URL)
    expect(value.email).toBe("test@example.com")

    const active = yield* AccountRepo.use.active()
    expect(Option.getOrThrow(active).active_org_id).toBe(OrgID.make("org-1"))
  }),
)
// kilocode_change end

// kilocode_change start
it.live("persistAccount normalizes trailing slashes in stored server URLs", () =>
  Effect.gen(function* () {
    const id = storedKey("user-1")

    yield* AccountRepo.Service.use((r) =>
      r.persistAccount({
        remoteID: RemoteID.make("user-1"),
        email: "test@example.com",
        url: "https://control.example.com/",
        accessToken: AccessToken.make("at_123"),
        refreshToken: RefreshToken.make("rt_456"),
        expiry: Date.now() + 3600_000,
        orgID: Option.none(),
      }),
    )

    const row = yield* AccountRepo.use.getRow(id)
    const active = yield* AccountRepo.use.active()
    const list = yield* AccountRepo.use.list()

    expect(Option.getOrThrow(row).url).toBe(CONTROL_URL)
    expect(Option.getOrThrow(active).url).toBe(CONTROL_URL)
    expect(list[0]?.url).toBe(CONTROL_URL)
  }),
)
// kilocode_change end

// kilocode_change start
it.live("persistAccount sets the active account and org", () =>
  Effect.gen(function* () {
    yield* AccountRepo.Service.use((r) =>
      r.persistAccount({
        remoteID: RemoteID.make("user-1"),
        email: "first@example.com",
        url: CONTROL_URL,
        accessToken: AccessToken.make("at_1"),
        refreshToken: RefreshToken.make("rt_1"),
        expiry: Date.now() + 3600_000,
        orgID: Option.some(OrgID.make("org-1")),
      }),
    )

    yield* AccountRepo.Service.use((r) =>
      r.persistAccount({
        remoteID: RemoteID.make("user-2"),
        email: "second@example.com",
        url: CONTROL_URL,
        accessToken: AccessToken.make("at_2"),
        refreshToken: RefreshToken.make("rt_2"),
        expiry: Date.now() + 3600_000,
        orgID: Option.some(OrgID.make("org-2")),
      }),
    )

    // Last persisted account is active with its org
    const active = yield* AccountRepo.use.active()
    expect(Option.isSome(active)).toBe(true)
    expect(Option.getOrThrow(active).id).toBe(storedKey("user-2"))
    expect(Option.getOrThrow(active).active_org_id).toBe(OrgID.make("org-2"))
  }),
)
// kilocode_change end

// kilocode_change start
it.live("list returns all accounts", () =>
  Effect.gen(function* () {
    yield* AccountRepo.Service.use((r) =>
      r.persistAccount({
        remoteID: RemoteID.make("user-1"),
        email: "a@example.com",
        url: CONTROL_URL,
        accessToken: AccessToken.make("at_1"),
        refreshToken: RefreshToken.make("rt_1"),
        expiry: Date.now() + 3600_000,
        orgID: Option.none(),
      }),
    )

    yield* AccountRepo.Service.use((r) =>
      r.persistAccount({
        remoteID: RemoteID.make("user-2"),
        email: "b@example.com",
        url: CONTROL_URL,
        accessToken: AccessToken.make("at_2"),
        refreshToken: RefreshToken.make("rt_2"),
        expiry: Date.now() + 3600_000,
        orgID: Option.some(OrgID.make("org-1")),
      }),
    )

    const accounts = yield* AccountRepo.use.list()
    expect(accounts.length).toBe(2)
    expect(accounts.map((a) => a.email).sort()).toEqual(["a@example.com", "b@example.com"])
  }),
)
// kilocode_change end

// kilocode_change start
it.live("remove deletes an account", () =>
  Effect.gen(function* () {
    const id = storedKey("user-1")

    yield* AccountRepo.Service.use((r) =>
      r.persistAccount({
        remoteID: RemoteID.make("user-1"),
        email: "test@example.com",
        url: CONTROL_URL,
        accessToken: AccessToken.make("at_1"),
        refreshToken: RefreshToken.make("rt_1"),
        expiry: Date.now() + 3600_000,
        orgID: Option.none(),
      }),
    )

    yield* AccountRepo.use.remove(id)

    const row = yield* AccountRepo.use.getRow(id)
    expect(Option.isNone(row)).toBe(true)
  }),
)
// kilocode_change end

// kilocode_change start
it.live("use stores the selected org and marks the account active", () =>
  Effect.gen(function* () {
    const id1 = storedKey("user-1")

    yield* AccountRepo.Service.use((r) =>
      r.persistAccount({
        remoteID: RemoteID.make("user-1"),
        email: "first@example.com",
        url: CONTROL_URL,
        accessToken: AccessToken.make("at_1"),
        refreshToken: RefreshToken.make("rt_1"),
        expiry: Date.now() + 3600_000,
        orgID: Option.none(),
      }),
    )

    yield* AccountRepo.Service.use((r) =>
      r.persistAccount({
        remoteID: RemoteID.make("user-2"),
        email: "second@example.com",
        url: CONTROL_URL,
        accessToken: AccessToken.make("at_2"),
        refreshToken: RefreshToken.make("rt_2"),
        expiry: Date.now() + 3600_000,
        orgID: Option.none(),
      }),
    )

    yield* AccountRepo.Service.use((r) => r.use(id1, Option.some(OrgID.make("org-99"))))
    const active1 = yield* AccountRepo.use.active()
    expect(Option.getOrThrow(active1).id).toBe(id1)
    expect(Option.getOrThrow(active1).active_org_id).toBe(OrgID.make("org-99"))

    yield* AccountRepo.Service.use((r) => r.use(id1, Option.none()))
    const active2 = yield* AccountRepo.use.active()
    expect(Option.getOrThrow(active2).active_org_id).toBeNull()
  }),
)
// kilocode_change end

// kilocode_change start
it.live("persistToken updates token fields", () =>
  Effect.gen(function* () {
    const id = storedKey("user-1")

    yield* AccountRepo.Service.use((r) =>
      r.persistAccount({
        remoteID: RemoteID.make("user-1"),
        email: "test@example.com",
        url: CONTROL_URL,
        accessToken: AccessToken.make("old_token"),
        refreshToken: RefreshToken.make("old_refresh"),
        expiry: 1000,
        orgID: Option.none(),
      }),
    )

    const expiry = Date.now() + 7200_000
    yield* AccountRepo.Service.use((r) =>
      r.persistToken({
        accountID: id,
        accessToken: AccessToken.make("new_token"),
        refreshToken: RefreshToken.make("new_refresh"),
        expiry: Option.some(expiry),
      }),
    )

    const row = yield* AccountRepo.use.getRow(id)
    const value = Option.getOrThrow(row)
    expect(value.access_token).toBe(AccessToken.make("new_token"))
    expect(value.refresh_token).toBe(RefreshToken.make("new_refresh"))
    expect(value.token_expiry).toBe(expiry)
  }),
)
// kilocode_change end

// kilocode_change start
it.live("persistToken with no expiry sets token_expiry to null", () =>
  Effect.gen(function* () {
    const id = storedKey("user-1")

    yield* AccountRepo.Service.use((r) =>
      r.persistAccount({
        remoteID: RemoteID.make("user-1"),
        email: "test@example.com",
        url: CONTROL_URL,
        accessToken: AccessToken.make("old_token"),
        refreshToken: RefreshToken.make("old_refresh"),
        expiry: 1000,
        orgID: Option.none(),
      }),
    )

    yield* AccountRepo.Service.use((r) =>
      r.persistToken({
        accountID: id,
        accessToken: AccessToken.make("new_token"),
        refreshToken: RefreshToken.make("new_refresh"),
        expiry: Option.none(),
      }),
    )

    const row = yield* AccountRepo.use.getRow(id)
    expect(Option.getOrThrow(row).token_expiry).toBeNull()
  }),
)
// kilocode_change end

// kilocode_change start
it.live("persistAccount upserts on conflict", () =>
  Effect.gen(function* () {
    const id = storedKey("user-1")

    yield* AccountRepo.Service.use((r) =>
      r.persistAccount({
        remoteID: RemoteID.make("user-1"),
        email: "test@example.com",
        url: CONTROL_URL,
        accessToken: AccessToken.make("at_v1"),
        refreshToken: RefreshToken.make("rt_v1"),
        expiry: 1000,
        orgID: Option.some(OrgID.make("org-1")),
      }),
    )

    yield* AccountRepo.Service.use((r) =>
      r.persistAccount({
        remoteID: RemoteID.make("user-1"),
        email: "test@example.com",
        url: CONTROL_URL,
        accessToken: AccessToken.make("at_v2"),
        refreshToken: RefreshToken.make("rt_v2"),
        expiry: 2000,
        orgID: Option.some(OrgID.make("org-2")),
      }),
    )

    const accounts = yield* AccountRepo.use.list()
    expect(accounts.length).toBe(1)

    const row = yield* AccountRepo.use.getRow(id)
    const value = Option.getOrThrow(row)
    expect(value.access_token).toBe(AccessToken.make("at_v2"))

    const active = yield* AccountRepo.use.active()
    expect(Option.getOrThrow(active).active_org_id).toBe(OrgID.make("org-2"))
  }),
)
// kilocode_change end

// kilocode_change start
it.live("persistAccount keeps one account per server for a shared remote id", () =>
  Effect.gen(function* () {
    const one = storedKey("user-1", "https://one.example.com")
    const two = storedKey("user-1", "https://two.example.com")

    yield* AccountRepo.Service.use((r) =>
      r.persistAccount({
        remoteID: RemoteID.make("user-1"),
        email: "one@example.com",
        url: "https://one.example.com",
        accessToken: AccessToken.make("at_one"),
        refreshToken: RefreshToken.make("rt_one"),
        expiry: 1000,
        orgID: Option.some(OrgID.make("org-one")),
      }),
    )

    const first = Option.getOrThrow(yield* AccountRepo.use.getRow(one))

    yield* AccountRepo.Service.use((r) =>
      r.persistAccount({
        remoteID: RemoteID.make("user-1"),
        email: "two@example.com",
        url: "https://two.example.com",
        accessToken: AccessToken.make("at_two"),
        refreshToken: RefreshToken.make("rt_two"),
        expiry: 2000,
        orgID: Option.some(OrgID.make("org-two")),
      }),
    )

    expect(one).toBe(accountKey("https://one.example.com", "user-1"))
    expect(two).toBe(accountKey("https://two.example.com", "user-1"))
    expect(one).not.toBe(two)

    const accounts = yield* AccountRepo.use.list()
    expect(
      accounts
        .map((account) => [account.id, account.url, account.email])
        .sort((a, b) => a[1].localeCompare(b[1])),
    ).toEqual([
      [one, "https://one.example.com", "one@example.com"],
      [two, "https://two.example.com", "two@example.com"],
    ])

    const firstAfter = Option.getOrThrow(yield* AccountRepo.use.getRow(one))
    expect(firstAfter.access_token).toBe(AccessToken.make("at_one"))
    expect(firstAfter.refresh_token).toBe(RefreshToken.make("rt_one"))
    expect(firstAfter.token_expiry).toBe(1000)
    expect(firstAfter).toEqual(first)

    const second = Option.getOrThrow(yield* AccountRepo.use.getRow(two))
    expect(second.access_token).toBe(AccessToken.make("at_two"))
    expect(second.refresh_token).toBe(RefreshToken.make("rt_two"))
  }),
)
// kilocode_change end

// kilocode_change start
it.live("persistAccount refreshes tokens in place for a repeated login on one server", () =>
  Effect.gen(function* () {
    yield* AccountRepo.Service.use((r) =>
      r.persistAccount({
        remoteID: RemoteID.make("user-1"),
        email: "test@example.com",
        url: CONTROL_URL,
        accessToken: AccessToken.make("at_v1"),
        refreshToken: RefreshToken.make("rt_v1"),
        expiry: 1000,
        orgID: Option.none(),
      }),
    )

    // A trailing slash normalizes to the same server, so this is the same account.
    yield* AccountRepo.Service.use((r) =>
      r.persistAccount({
        remoteID: RemoteID.make("user-1"),
        email: "test@example.com",
        url: `${CONTROL_URL}/`,
        accessToken: AccessToken.make("at_v2"),
        refreshToken: RefreshToken.make("rt_v2"),
        expiry: 2000,
        orgID: Option.none(),
      }),
    )

    const accounts = yield* AccountRepo.use.list()
    expect(accounts.length).toBe(1)
    expect(accounts[0]?.id).toBe(storedKey("user-1"))

    const value = Option.getOrThrow(yield* AccountRepo.use.getRow(storedKey("user-1")))
    expect(value.url).toBe(CONTROL_URL)
    expect(value.email).toBe("test@example.com")
    expect(value.access_token).toBe(AccessToken.make("at_v2"))
    expect(value.refresh_token).toBe(RefreshToken.make("rt_v2"))
    expect(value.token_expiry).toBe(2000)
  }),
)
// kilocode_change end

// kilocode_change start
it.live("remove clears active state when deleting the active account", () =>
  Effect.gen(function* () {
    const id = storedKey("user-1")

    yield* AccountRepo.Service.use((r) =>
      r.persistAccount({
        remoteID: RemoteID.make("user-1"),
        email: "test@example.com",
        url: CONTROL_URL,
        accessToken: AccessToken.make("at_1"),
        refreshToken: RefreshToken.make("rt_1"),
        expiry: Date.now() + 3600_000,
        orgID: Option.some(OrgID.make("org-1")),
      }),
    )

    yield* AccountRepo.use.remove(id)

    const active = yield* AccountRepo.use.active()
    expect(Option.isNone(active)).toBe(true)
  }),
)
// kilocode_change end

it.live("getRow returns none for nonexistent account", () =>
  Effect.gen(function* () {
    const row = yield* AccountRepo.Service.use((r) => r.getRow(AccountID.make("nope")))
    expect(Option.isNone(row)).toBe(true)
  }),
)

// kilocode_change start
it.live("selected returns the stored org only for the account that holds the state", () =>
  Effect.gen(function* () {
    const id1 = storedKey("user-1")
    const id2 = storedKey("user-2")

    yield* AccountRepo.Service.use((r) =>
      r.persistAccount({
        remoteID: RemoteID.make("user-1"),
        email: "first@example.com",
        url: CONTROL_URL,
        accessToken: AccessToken.make("at_1"),
        refreshToken: RefreshToken.make("rt_1"),
        expiry: Date.now() + 3600_000,
        orgID: Option.some(OrgID.make("org-1")),
      }),
    )

    yield* AccountRepo.Service.use((r) =>
      r.persistAccount({
        remoteID: RemoteID.make("user-2"),
        email: "second@example.com",
        url: CONTROL_URL,
        accessToken: AccessToken.make("at_2"),
        refreshToken: RefreshToken.make("rt_2"),
        expiry: Date.now() + 3600_000,
        orgID: Option.some(OrgID.make("org-2")),
      }),
    )

    const first = yield* AccountRepo.Service.use((r) => r.selected(id1))
    expect(Option.isNone(first)).toBe(true)

    const second = yield* AccountRepo.Service.use((r) => r.selected(id2))
    expect(Option.getOrThrow(second)).toBe(OrgID.make("org-2"))
  }),
)
// kilocode_change end
