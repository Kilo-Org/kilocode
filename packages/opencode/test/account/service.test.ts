import { expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { httpClient } from "@opencode-ai/core/effect/app-node-platform"
import { Duration, Effect, Layer, Option, Schema } from "effect"
import { sql } from "drizzle-orm"
import { HttpClient, HttpClientError, HttpClientResponse } from "effect/unstable/http"

// kilocode_change start
import { accountKey } from "@opencode-ai/core/account/key"
// kilocode_change end
import { AccountRepo } from "../../src/account/repo"
import { Account } from "../../src/account/account"
import {
  AccessToken,
  AccountServiceError,
  AccountTransportError,
  DeviceCode,
  Login,
  Org,
  OrgID,
  RefreshToken,
  RemoteID, // kilocode_change
  UserCode,
} from "../../src/account/schema"
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

const insideEagerRefreshWindow = Duration.toMillis(Duration.minutes(1))
const outsideEagerRefreshWindow = Duration.toMillis(Duration.minutes(10))

// kilocode_change start
const ONE = "https://one.example.com"
const TWO = "https://two.example.com"

// A stored account is keyed by its normalized server URL and the server-issued user id.
const storedKey = (remoteID: string, url: string) => accountKey(url, remoteID)
// kilocode_change end

const live = (client: HttpClient.HttpClient) =>
  LayerNode.compile(Account.node, [[httpClient, Layer.succeed(HttpClient.HttpClient, client)]])

const json = (req: Parameters<typeof HttpClientResponse.fromWeb>[0], body: unknown, status = 200) =>
  HttpClientResponse.fromWeb(
    req,
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  )

const encodeOrg = Schema.encodeSync(Org)

const org = (id: string, name: string) => encodeOrg(new Org({ id: OrgID.make(id), name }))

const login = () =>
  new Login({
    code: DeviceCode.make("device-code"),
    user: UserCode.make("user-code"),
    url: "https://one.example.com/verify",
    server: "https://one.example.com",
    expiry: Duration.seconds(600),
    interval: Duration.seconds(5),
  })

const deviceTokenClient = (body: unknown, status = 400) =>
  HttpClient.make((req) =>
    Effect.succeed(
      req.url === "https://one.example.com/auth/device/token" ? json(req, body, status) : json(req, {}, 404),
    ),
  )

const poll = (body: unknown, status = 400) =>
  Account.Service.use((s) => s.poll(login())).pipe(Effect.provide(live(deviceTokenClient(body, status))))

it.live("login resolves origin-rooted verification URLs from servers with base paths", () =>
  Effect.gen(function* () {
    const seen: Array<string> = []
    const client = HttpClient.make((req) =>
      Effect.gen(function* () {
        seen.push(`${req.method} ${req.url}`)

        if (req.url === "https://one.example.com/console/auth/device/code") {
          return json(req, {
            device_code: "device-code",
            user_code: "user-code",
            verification_uri_complete: "/console/device?user_code=user-code",
            expires_in: 600,
            interval: 5,
          })
        }

        return json(req, {}, 404)
      }),
    )

    const result = yield* Account.use.login("https://one.example.com/console/").pipe(Effect.provide(live(client)))

    expect(seen).toEqual(["POST https://one.example.com/console/auth/device/code"])
    expect(result.server).toBe("https://one.example.com/console")
    expect(result.url).toBe("https://one.example.com/console/device?user_code=user-code")
  }),
)

it.live("login rejects malformed device verification URLs", () =>
  Effect.gen(function* () {
    const client = HttpClient.make((req) =>
      Effect.succeed(
        json(req, {
          device_code: "device-code",
          user_code: "user-code",
          verification_uri_complete: "http://[::1",
          expires_in: 600,
          interval: 5,
        }),
      ),
    )

    const error = yield* Effect.flip(Account.use.login("https://one.example.com").pipe(Effect.provide(live(client))))
    expect(error).toBeInstanceOf(AccountServiceError)
    if (error instanceof AccountServiceError) expect(error.message).toBe("Invalid device verification URL")
  }),
)

it.live("login maps transport failures to account transport errors", () =>
  Effect.gen(function* () {
    const client = HttpClient.make((req) =>
      Effect.fail(
        new HttpClientError.HttpClientError({
          reason: new HttpClientError.TransportError({ request: req }),
        }),
      ),
    )

    const error = yield* Effect.flip(Account.use.login("https://one.example.com").pipe(Effect.provide(live(client))))

    expect(error).toBeInstanceOf(AccountTransportError)
    if (error instanceof AccountTransportError) {
      expect(error.method).toBe("POST")
      expect(error.url).toBe("https://one.example.com/auth/device/code")
    }
  }),
)

// kilocode_change start
it.live("orgsByAccount groups orgs per account", () =>
  Effect.gen(function* () {
    yield* AccountRepo.Service.use((r) =>
      r.persistAccount({
        remoteID: RemoteID.make("user-1"),
        email: "one@example.com",
        url: ONE,
        accessToken: AccessToken.make("at_1"),
        refreshToken: RefreshToken.make("rt_1"),
        expiry: Date.now() + outsideEagerRefreshWindow,
        orgID: Option.none(),
      }),
    )

    yield* AccountRepo.Service.use((r) =>
      r.persistAccount({
        remoteID: RemoteID.make("user-2"),
        email: "two@example.com",
        url: TWO,
        accessToken: AccessToken.make("at_2"),
        refreshToken: RefreshToken.make("rt_2"),
        expiry: Date.now() + outsideEagerRefreshWindow,
        orgID: Option.none(),
      }),
    )

    const seen: Array<string> = []
    const client = HttpClient.make((req) =>
      Effect.gen(function* () {
        seen.push(`${req.method} ${req.url}`)

        if (req.url === `${ONE}/api/orgs`) {
          return json(req, [org("org-1", "One")])
        }

        if (req.url === `${TWO}/api/orgs`) {
          return json(req, [org("org-2", "Two A"), org("org-3", "Two B")])
        }

        return json(req, [], 404)
      }),
    )

    const rows = yield* Account.use.orgsByAccount().pipe(Effect.provide(live(client)))

    expect(rows.map((row) => [row.account.id, row.orgs.map((org) => org.id)])).toEqual([
      [storedKey("user-1", ONE), [OrgID.make("org-1")]],
      [storedKey("user-2", TWO), [OrgID.make("org-2"), OrgID.make("org-3")]],
    ])
    expect(seen).toEqual([`GET ${ONE}/api/orgs`, `GET ${TWO}/api/orgs`])
  }),
)
// kilocode_change end

// kilocode_change start
it.live("login and poll keep two accounts for one remote id on different servers", () =>
  Effect.gen(function* () {
    const seen: Array<string> = []
    const client = HttpClient.make((req) =>
      Effect.gen(function* () {
        seen.push(`${req.method} ${req.url}`)

        if (req.method === "POST" && (req.url === `${ONE}/auth/device/code` || req.url === `${TWO}/auth/device/code`)) {
          return json(req, {
            device_code: "device-code",
            user_code: "user-code",
            verification_uri_complete: "/device?user_code=user-code",
            expires_in: 600,
            interval: 5,
          })
        }

        if (req.method === "POST" && (req.url === `${ONE}/auth/device/token` || req.url === `${TWO}/auth/device/token`)) {
          const suffix = req.url === `${ONE}/auth/device/token` ? "one" : "two"
          return json(req, {
            access_token: `at_${suffix}`,
            refresh_token: `rt_${suffix}`,
            token_type: "Bearer",
            expires_in: 3600,
          })
        }

        if (req.method === "GET" && (req.url === `${ONE}/api/user` || req.url === `${TWO}/api/user`)) {
          // Both servers issue the same user id for this person.
          return json(req, { id: "user-1", email: "user@example.com" })
        }

        if (req.method === "GET" && req.url === `${ONE}/api/orgs`) {
          return json(req, [org("org-one", "One")])
        }

        if (req.method === "GET" && req.url === `${TWO}/api/orgs`) {
          return json(req, [org("org-two-a", "Two A"), org("org-two-b", "Two B")])
        }

        return json(req, {}, 404)
      }),
    )

    const [first, second] = yield* Effect.gen(function* () {
      const oneLogin = yield* Account.use.login(ONE)
      const first = yield* Account.Service.use((s) => s.poll(oneLogin))
      const twoLogin = yield* Account.use.login(TWO)
      const second = yield* Account.Service.use((s) => s.poll(twoLogin))
      return [first, second] as const
    }).pipe(Effect.provide(live(client)))

    expect(first._tag).toBe("PollSuccess")
    expect(second._tag).toBe("PollSuccess")

    const accounts = yield* AccountRepo.use.list()
    expect(
      accounts
        .map((account) => [account.id, account.url, account.email])
        .sort((a, b) => a[1].localeCompare(b[1])),
    ).toEqual([
      [storedKey("user-1", ONE), ONE, "user@example.com"],
      [storedKey("user-1", TWO), TWO, "user@example.com"],
    ])

    const oneRow = Option.getOrThrow(yield* AccountRepo.use.getRow(storedKey("user-1", ONE)))
    const twoRow = Option.getOrThrow(yield* AccountRepo.use.getRow(storedKey("user-1", TWO)))
    expect([oneRow.access_token, oneRow.refresh_token]).toEqual([AccessToken.make("at_one"), RefreshToken.make("rt_one")])
    expect([twoRow.access_token, twoRow.refresh_token]).toEqual([AccessToken.make("at_two"), RefreshToken.make("rt_two")])

    seen.length = 0
    const rows = yield* Account.use.orgsByAccount().pipe(Effect.provide(live(client)))

    expect(rows.map((row) => [row.account.url, row.orgs.map((item) => item.id)])).toEqual([
      [ONE, [OrgID.make("org-one")]],
      [TWO, [OrgID.make("org-two-a"), OrgID.make("org-two-b")]],
    ])
    expect(seen).toEqual([`GET ${ONE}/api/orgs`, `GET ${TWO}/api/orgs`])
  }),
)
// kilocode_change end

// kilocode_change start
it.live("token refresh rewrites only the expired account that shares a remote id", () =>
  Effect.gen(function* () {
    const expired = storedKey("user-1", ONE)
    const fresh = storedKey("user-1", TWO)

    yield* AccountRepo.Service.use((r) =>
      r.persistAccount({
        remoteID: RemoteID.make("user-1"),
        email: "one@example.com",
        url: ONE,
        accessToken: AccessToken.make("at_old"),
        refreshToken: RefreshToken.make("rt_old"),
        expiry: Date.now() - 1_000,
        orgID: Option.none(),
      }),
    )

    yield* AccountRepo.Service.use((r) =>
      r.persistAccount({
        remoteID: RemoteID.make("user-1"),
        email: "two@example.com",
        url: TWO,
        accessToken: AccessToken.make("at_fresh"),
        refreshToken: RefreshToken.make("rt_fresh"),
        expiry: Date.now() + outsideEagerRefreshWindow,
        orgID: Option.none(),
      }),
    )

    const otherBefore = Option.getOrThrow(yield* AccountRepo.use.getRow(fresh))

    const client = HttpClient.make((req) =>
      Effect.succeed(
        req.url === `${ONE}/auth/device/token`
          ? json(req, { access_token: "at_new", refresh_token: "rt_new", expires_in: 60 })
          : json(req, {}, 404),
      ),
    )

    const token = yield* Account.use.token(expired).pipe(Effect.provide(live(client)))
    expect(String(Option.getOrThrow(token))).toBe("at_new")

    const refreshed = Option.getOrThrow(yield* AccountRepo.use.getRow(expired))
    expect(refreshed.access_token).toBe(AccessToken.make("at_new"))
    expect(refreshed.refresh_token).toBe(RefreshToken.make("rt_new"))
    expect(refreshed.token_expiry).toBeGreaterThan(Date.now())

    const otherAfter = Option.getOrThrow(yield* AccountRepo.use.getRow(fresh))
    expect(otherAfter.access_token).toBe(otherBefore.access_token)
    expect(otherAfter.refresh_token).toBe(otherBefore.refresh_token)
    expect(otherAfter.token_expiry).toBe(otherBefore.token_expiry)
    expect(otherAfter).toEqual(otherBefore)
  }),
)
// kilocode_change end

// kilocode_change start
it.live("remove switches to another org when the active account is removed", () =>
  Effect.gen(function* () {
    const first = storedKey("user-1", ONE)
    const second = storedKey("user-2", TWO)

    yield* AccountRepo.Service.use((r) =>
      r.persistAccount({
        remoteID: RemoteID.make("user-1"),
        email: "one@example.com",
        url: ONE,
        accessToken: AccessToken.make("at_1"),
        refreshToken: RefreshToken.make("rt_1"),
        expiry: Date.now() + outsideEagerRefreshWindow,
        orgID: Option.some(OrgID.make("org-1")),
      }),
    )

    yield* AccountRepo.Service.use((r) =>
      r.persistAccount({
        remoteID: RemoteID.make("user-2"),
        email: "two@example.com",
        url: TWO,
        accessToken: AccessToken.make("at_2"),
        refreshToken: RefreshToken.make("rt_2"),
        expiry: Date.now() + outsideEagerRefreshWindow,
        orgID: Option.some(OrgID.make("org-2")),
      }),
    )

    const client = HttpClient.make((req) =>
      Effect.succeed(req.url === `${ONE}/api/orgs` ? json(req, [org("org-1", "One")]) : json(req, [], 404)),
    )

    yield* Account.use.remove(second).pipe(Effect.provide(live(client)))

    const active = yield* AccountRepo.use.active()
    expect(Option.getOrThrow(active)).toEqual(
      expect.objectContaining({
        id: first,
        active_org_id: OrgID.make("org-1"),
      }),
    )
  }),
)
// kilocode_change end

// kilocode_change start
it.live("remove keeps an account active when the remaining account has no organizations", () =>
  Effect.gen(function* () {
    const first = storedKey("user-1", ONE)
    const second = storedKey("user-2", TWO)

    yield* AccountRepo.Service.use((r) =>
      r.persistAccount({
        remoteID: RemoteID.make("user-1"),
        email: "one@example.com",
        url: ONE,
        accessToken: AccessToken.make("at_1"),
        refreshToken: RefreshToken.make("rt_1"),
        expiry: Date.now() + outsideEagerRefreshWindow,
        orgID: Option.none(),
      }),
    )

    yield* AccountRepo.Service.use((r) =>
      r.persistAccount({
        remoteID: RemoteID.make("user-2"),
        email: "two@example.com",
        url: TWO,
        accessToken: AccessToken.make("at_2"),
        refreshToken: RefreshToken.make("rt_2"),
        expiry: Date.now() + outsideEagerRefreshWindow,
        orgID: Option.none(),
      }),
    )

    const client = HttpClient.make((req) => Effect.succeed(json(req, [])))

    yield* Account.use.remove(second).pipe(Effect.provide(live(client)))

    const active = yield* AccountRepo.use.active()
    expect(Option.getOrThrow(active)).toEqual(
      expect.objectContaining({
        id: first,
        active_org_id: null,
      }),
    )
  }),
)
// kilocode_change end

// kilocode_change start
it.live("remove keeps an account active when the remaining account org read fails", () =>
  Effect.gen(function* () {
    const first = storedKey("user-1", ONE)
    const second = storedKey("user-2", TWO)

    yield* AccountRepo.Service.use((r) =>
      r.persistAccount({
        remoteID: RemoteID.make("user-1"),
        email: "one@example.com",
        url: ONE,
        accessToken: AccessToken.make("at_1"),
        refreshToken: RefreshToken.make("rt_1"),
        expiry: Date.now() + outsideEagerRefreshWindow,
        orgID: Option.some(OrgID.make("org-1")),
      }),
    )

    yield* AccountRepo.Service.use((r) =>
      r.persistAccount({
        remoteID: RemoteID.make("user-2"),
        email: "two@example.com",
        url: TWO,
        accessToken: AccessToken.make("at_2"),
        refreshToken: RefreshToken.make("rt_2"),
        expiry: Date.now() + outsideEagerRefreshWindow,
        orgID: Option.some(OrgID.make("org-2")),
      }),
    )

    const client = HttpClient.make((req) =>
      Effect.succeed(req.url === `${ONE}/api/orgs` ? json(req, {}, 500) : json(req, [], 404)),
    )

    yield* Account.use.remove(second).pipe(Effect.provide(live(client)))

    const active = yield* AccountRepo.use.active()
    expect(Option.getOrThrow(active)).toEqual(
      expect.objectContaining({
        id: first,
        active_org_id: null,
      }),
    )
  }),
)
// kilocode_change end

// kilocode_change start
it.live("token refresh persists the new token", () =>
  Effect.gen(function* () {
    const id = storedKey("user-1", ONE)

    yield* AccountRepo.Service.use((r) =>
      r.persistAccount({
        remoteID: RemoteID.make("user-1"),
        email: "user@example.com",
        url: ONE,
        accessToken: AccessToken.make("at_old"),
        refreshToken: RefreshToken.make("rt_old"),
        expiry: Date.now() - 1_000,
        orgID: Option.none(),
      }),
    )

    const client = HttpClient.make((req) =>
      Effect.succeed(
        req.url === `${ONE}/auth/device/token`
          ? json(req, {
              access_token: "at_new",
              refresh_token: "rt_new",
              expires_in: 60,
            })
          : json(req, {}, 404),
      ),
    )

    const token = yield* Account.use.token(id).pipe(Effect.provide(live(client)))

    expect(Option.getOrThrow(token)).toBeDefined()
    expect(String(Option.getOrThrow(token))).toBe("at_new")

    const row = yield* AccountRepo.use.getRow(id)
    const value = Option.getOrThrow(row)
    expect(value.access_token).toBe(AccessToken.make("at_new"))
    expect(value.refresh_token).toBe(RefreshToken.make("rt_new"))
    expect(value.token_expiry).toBeGreaterThan(Date.now())
  }),
)
// kilocode_change end

// kilocode_change start
it.live("token refreshes before expiry when inside the eager refresh window", () =>
  Effect.gen(function* () {
    const id = storedKey("user-1", ONE)

    yield* AccountRepo.Service.use((r) =>
      r.persistAccount({
        remoteID: RemoteID.make("user-1"),
        email: "user@example.com",
        url: ONE,
        accessToken: AccessToken.make("at_old"),
        refreshToken: RefreshToken.make("rt_old"),
        expiry: Date.now() + insideEagerRefreshWindow,
        orgID: Option.none(),
      }),
    )

    let refreshCalls = 0
    const client = HttpClient.make((req) =>
      Effect.promise(async () => {
        if (req.url === `${ONE}/auth/device/token`) {
          refreshCalls += 1
          return json(req, {
            access_token: "at_new",
            refresh_token: "rt_new",
            expires_in: 60,
          })
        }

        return json(req, {}, 404)
      }),
    )

    const token = yield* Account.use.token(id).pipe(Effect.provide(live(client)))

    expect(String(Option.getOrThrow(token))).toBe("at_new")
    expect(refreshCalls).toBe(1)

    const row = yield* AccountRepo.use.getRow(id)
    const value = Option.getOrThrow(row)
    expect(value.access_token).toBe(AccessToken.make("at_new"))
    expect(value.refresh_token).toBe(RefreshToken.make("rt_new"))
  }),
)

it.live("concurrent config and token requests coalesce token refresh", () =>
  Effect.gen(function* () {
    const id = storedKey("user-1", ONE)

    yield* AccountRepo.Service.use((r) =>
      r.persistAccount({
        remoteID: RemoteID.make("user-1"),
        email: "user@example.com",
        url: ONE,
        accessToken: AccessToken.make("at_old"),
        refreshToken: RefreshToken.make("rt_old"),
        expiry: Date.now() - 1_000,
        orgID: Option.some(OrgID.make("org-9")),
      }),
    )

    let refreshCalls = 0
    const client = HttpClient.make((req) =>
      Effect.promise(async () => {
        if (req.url === `${ONE}/auth/device/token`) {
          refreshCalls += 1

          if (refreshCalls === 1) {
            await new Promise((resolve) => setTimeout(resolve, 25))
            return json(req, {
              access_token: "at_new",
              refresh_token: "rt_new",
              expires_in: 60,
            })
          }

          return json(
            req,
            {
              error: "invalid_grant",
              error_description: "refresh token already used",
            },
            400,
          )
        }

        if (req.url === `${ONE}/api/config`) {
          return json(req, { config: { theme: "light", seats: 5 } })
        }

        return json(req, {}, 404)
      }),
    )

    const [cfg, token] = yield* Account.Service.use((s) =>
      Effect.all([s.config(id, OrgID.make("org-9")), s.token(id)], { concurrency: 2 }),
    ).pipe(Effect.provide(live(client)))

    expect(Option.getOrThrow(cfg)).toEqual({ theme: "light", seats: 5 })
    expect(String(Option.getOrThrow(token))).toBe("at_new")
    expect(refreshCalls).toBe(1)

    const row = yield* AccountRepo.use.getRow(id)
    const value = Option.getOrThrow(row)
    expect(value.access_token).toBe(AccessToken.make("at_new"))
    expect(value.refresh_token).toBe(RefreshToken.make("rt_new"))
  }),
)

it.live("config sends the selected org header", () =>
  Effect.gen(function* () {
    const id = storedKey("user-1", ONE)

    yield* AccountRepo.Service.use((r) =>
      r.persistAccount({
        remoteID: RemoteID.make("user-1"),
        email: "user@example.com",
        url: ONE,
        accessToken: AccessToken.make("at_1"),
        refreshToken: RefreshToken.make("rt_1"),
        expiry: Date.now() + outsideEagerRefreshWindow,
        orgID: Option.none(),
      }),
    )

    const seen: { auth?: string; org?: string } = {}
    const client = HttpClient.make((req) =>
      Effect.gen(function* () {
        seen.auth = req.headers.authorization
        seen.org = req.headers["x-org-id"]

        if (req.url === `${ONE}/api/config`) {
          return json(req, { config: { theme: "light", seats: 5 } })
        }

        return json(req, {}, 404)
      }),
    )

    const cfg = yield* Account.Service.use((s) => s.config(id, OrgID.make("org-9"))).pipe(Effect.provide(live(client)))

    expect(Option.getOrThrow(cfg)).toEqual({ theme: "light", seats: 5 })
    expect(seen).toEqual({
      auth: "Bearer at_1",
      org: "org-9",
    })
  }),
)

it.live("poll stores the account and first org on success", () =>
  Effect.gen(function* () {
    const client = HttpClient.make((req) =>
      Effect.succeed(
        req.url === "https://one.example.com/auth/device/token"
          ? json(req, {
              access_token: "at_1",
              refresh_token: "rt_1",
              token_type: "Bearer",
              expires_in: 60,
            })
          : req.url === "https://one.example.com/api/user"
            ? json(req, { id: "user-1", email: "user@example.com" })
            : req.url === "https://one.example.com/api/orgs"
              ? json(req, [org("org-1", "One")])
              : json(req, {}, 404),
      ),
    )

    const res = yield* Account.Service.use((s) => s.poll(login())).pipe(Effect.provide(live(client)))

    expect(res._tag).toBe("PollSuccess")
    if (res._tag === "PollSuccess") {
      expect(res.email).toBe("user@example.com")
    }

    const active = yield* AccountRepo.use.active()
    expect(Option.getOrThrow(active)).toEqual(
      expect.objectContaining({
        id: storedKey("user-1", ONE),
        url: ONE,
        email: "user@example.com",
        active_org_id: "org-1",
      }),
    )
  }),
)

const reauthClient = (remoteID: string, orgs: unknown[]) =>
  HttpClient.make((req) =>
    Effect.succeed(
      req.url === `${ONE}/auth/device/token`
        ? json(req, {
            access_token: "at_1",
            refresh_token: "rt_1",
            token_type: "Bearer",
            expires_in: 60,
          })
        : req.url === `${ONE}/api/user`
          ? json(req, { id: remoteID, email: "user@example.com" })
          : req.url === `${ONE}/api/orgs`
            ? json(req, orgs)
            : json(req, {}, 404),
    ),
  )

const seedSelection = (remoteID: string, orgID: Option.Option<OrgID>) =>
  AccountRepo.Service.use((r) =>
    r.persistAccount({
      remoteID: RemoteID.make(remoteID),
      email: "user@example.com",
      url: ONE,
      accessToken: AccessToken.make("at_old"),
      refreshToken: RefreshToken.make("rt_old"),
      expiry: Date.now() + outsideEagerRefreshWindow,
      orgID,
    }),
  )

it.live("poll keeps the stored org when the account signs in again", () =>
  Effect.gen(function* () {
    yield* seedSelection("user-1", Option.some(OrgID.make("org-2")))

    const client = reauthClient("user-1", [org("org-1", "One"), org("org-2", "Two")])
    const res = yield* Account.Service.use((s) => s.poll(login())).pipe(Effect.provide(live(client)))

    expect(res._tag).toBe("PollSuccess")

    const active = yield* AccountRepo.use.active()
    expect(Option.getOrThrow(active).active_org_id).toBe(OrgID.make("org-2"))
  }),
)

it.live("poll falls back to the first listed org when the stored org is gone", () =>
  Effect.gen(function* () {
    yield* seedSelection("user-1", Option.some(OrgID.make("org-2")))

    const client = reauthClient("user-1", [org("org-1", "One"), org("org-3", "Three")])
    const res = yield* Account.Service.use((s) => s.poll(login())).pipe(Effect.provide(live(client)))

    expect(res._tag).toBe("PollSuccess")

    const active = yield* AccountRepo.use.active()
    expect(Option.getOrThrow(active).active_org_id).toBe(OrgID.make("org-1"))
  }),
)

it.live("poll selects the first listed org for an account with no stored selection", () =>
  Effect.gen(function* () {
    const client = reauthClient("user-2", [org("org-1", "One"), org("org-2", "Two")])
    const res = yield* Account.Service.use((s) => s.poll(login())).pipe(Effect.provide(live(client)))

    expect(res._tag).toBe("PollSuccess")

    const active = yield* AccountRepo.use.active()
    expect(Option.getOrThrow(active).active_org_id).toBe(OrgID.make("org-1"))
  }),
)
// kilocode_change end

for (const [name, body, expectedTag] of [
  [
    "pending",
    {
      error: "authorization_pending",
      error_description: "The authorization request is still pending",
    },
    "PollPending",
  ],
  [
    "slow",
    {
      error: "slow_down",
      error_description: "Polling too frequently, please slow down",
    },
    "PollSlow",
  ],
  [
    "denied",
    {
      error: "access_denied",
      error_description: "The authorization request was denied",
    },
    "PollDenied",
  ],
  [
    "expired",
    {
      error: "expired_token",
      error_description: "The device code has expired",
    },
    "PollExpired",
  ],
] as const) {
  it.live(`poll returns ${name} for ${body.error}`, () =>
    Effect.gen(function* () {
      const result = yield* poll(body)
      expect(result._tag).toBe(expectedTag)
    }),
  )
}

it.live("poll returns poll error for other OAuth errors", () =>
  Effect.gen(function* () {
    const result = yield* poll({
      error: "server_error",
      error_description: "An unexpected error occurred",
    })

    expect(result._tag).toBe("PollError")
    if (result._tag === "PollError") {
      expect(String(result.cause)).toContain("server_error")
    }
  }),
)
