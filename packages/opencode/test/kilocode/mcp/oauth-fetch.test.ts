import { expect, test } from "bun:test"
import { setTimeout as sleep } from "node:timers/promises"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Effect, Layer } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { McpAuth } from "../../../src/mcp/auth"
import { oauthGuard } from "../../../src/kilocode/mcp/oauth-fetch"
import type { Expected } from "../../../src/kilocode/mcp/invalidation"

const URL_A = "https://mcp.example.com/mcp"
const TOKEN_URL = "https://auth.example.com/token"

function authFile() {
  let raw = "{}"
  const fsLayer = Layer.effect(
    FSUtil.Service,
    Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      return FSUtil.Service.of({
        ...fs,
        readJson: (file) =>
          file.endsWith("mcp-auth.json")
            ? Effect.try({ try: () => JSON.parse(raw), catch: (cause) => new FSUtil.FileSystemError({ method: "readJson", cause }) })
            : fs.readJson(file),
        writeJson: (file, value, mode) =>
          file.endsWith("mcp-auth.json")
            ? Effect.promise(async () => {
                await sleep(1)
                raw = JSON.stringify(value, null, 2)
              })
            : fs.writeJson(file, value, mode),
      })
    }),
  ).pipe(Layer.provide(AppNodeBuilder.build(FSUtil.node)))
  return { fsLayer }
}

function service(fsLayer: Layer.Layer<FSUtil.Service>) {
  return McpAuth.Service.use((auth) => Effect.succeed(auth)).pipe(
    Effect.provide(AppNodeBuilder.build(McpAuth.node, [[FSUtil.node, fsLayer]])),
  )
}

function tokenResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

test("fingerprints a rejected refresh-token grant POST", async () => {
  const file = authFile()
  await Effect.runPromise(
    Effect.gen(function* () {
      const auth = yield* service(file.fsLayer)
      yield* auth.set(
        "atlassian",
        { tokens: { accessToken: "a", refreshToken: "R1", issuer: "https://auth.example.com" } },
        URL_A,
      )

      const marked: Expected[] = []
      const guard = oauthGuard(async () => tokenResponse(400, { error: "invalid_grant" }), {
        name: "atlassian",
        serverUrl: URL_A,
        auth,
        provider: { markRejected: (e) => marked.push(e) },
      })

      const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: "R1" })
      yield* Effect.promise(() => guard(TOKEN_URL, { method: "POST", body }))

      expect(marked).toHaveLength(1)
      expect(marked[0].refreshToken).toBe("R1")
      expect(marked[0].issuer).toBe("https://auth.example.com")
    }),
  )
})

test("does not fingerprint a successful refresh", async () => {
  const file = authFile()
  await Effect.runPromise(
    Effect.gen(function* () {
      const auth = yield* service(file.fsLayer)
      yield* auth.set("atlassian", { tokens: { accessToken: "a", refreshToken: "R1" } }, URL_A)

      const marked: Expected[] = []
      const guard = oauthGuard(async () => tokenResponse(200, { access_token: "b", token_type: "Bearer" }), {
        name: "atlassian",
        serverUrl: URL_A,
        auth,
        provider: { markRejected: (e) => marked.push(e) },
      })

      const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: "R1" })
      yield* Effect.promise(() => guard(TOKEN_URL, { method: "POST", body }))
      expect(marked).toHaveLength(0)
    }),
  )
})

test("does not fingerprint non-refresh requests", async () => {
  const file = authFile()
  await Effect.runPromise(
    Effect.gen(function* () {
      const auth = yield* service(file.fsLayer)
      const marked: Expected[] = []
      let reachedBase = false
      const guard = oauthGuard(
        async () => {
          reachedBase = true
          return tokenResponse(400, { error: "invalid_grant" })
        },
        { name: "atlassian", serverUrl: URL_A, auth, provider: { markRejected: (e) => marked.push(e) } },
      )

      yield* Effect.promise(() =>
        guard(TOKEN_URL, { method: "POST", body: new URLSearchParams({ grant_type: "authorization_code", code: "c" }) }),
      )
      yield* Effect.promise(() => guard(URL_A, { method: "GET" }))

      expect(marked).toHaveLength(0)
      expect(reachedBase).toBe(true)
    }),
  )
})

test("does not fingerprint when the store no longer holds that credential", async () => {
  const file = authFile()
  await Effect.runPromise(
    Effect.gen(function* () {
      const auth = yield* service(file.fsLayer)
      yield* auth.set("atlassian", { tokens: { accessToken: "b", refreshToken: "R2" } }, URL_A)

      const marked: Expected[] = []
      const guard = oauthGuard(async () => tokenResponse(400, { error: "invalid_grant" }), {
        name: "atlassian",
        serverUrl: URL_A,
        auth,
        provider: { markRejected: (e) => marked.push(e) },
      })

      const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: "R1" })
      yield* Effect.promise(() => guard(TOKEN_URL, { method: "POST", body }))
      expect(marked).toHaveLength(0)
    }),
  )
})

test("leaves malformed and network errors unmarked", async () => {
  const file = authFile()
  await Effect.runPromise(
    Effect.gen(function* () {
      const auth = yield* service(file.fsLayer)
      yield* auth.set("atlassian", { tokens: { accessToken: "a", refreshToken: "R1" } }, URL_A)
      const marked: Expected[] = []
      const provider = { markRejected: (e: Expected) => marked.push(e) }

      // malformed body on a 500
      const malformed = oauthGuard(async () => new Response("not json", { status: 500 }), {
        name: "atlassian",
        serverUrl: URL_A,
        auth,
        provider,
      })
      const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: "R1" })
      yield* Effect.promise(() => malformed(TOKEN_URL, { method: "POST", body }))

      // a thrown network error surfaces but does not fingerprint
      const network = oauthGuard(async () => {
        throw new Error("network down")
      }, { name: "atlassian", serverUrl: URL_A, auth, provider })
      yield* Effect.promise(() => network(TOKEN_URL, { method: "POST", body }).catch(() => undefined))

      expect(marked).toHaveLength(0)
    }),
  )
})

test("fingerprints tokens without an issuer even when clientInfo has one", async () => {
  const file = authFile()
  await Effect.runPromise(
    Effect.gen(function* () {
      const auth = yield* service(file.fsLayer)
      // Stored tokens carry no issuer while the client binding does; the tokens fingerprint must
      // still match the stored tokens so a genuinely rejected refresh is cleared, not left stuck.
      yield* auth.set(
        "atlassian",
        { tokens: { accessToken: "a", refreshToken: "R1" }, clientInfo: { clientId: "c1", issuer: "https://auth.example.com" } },
        URL_A,
      )

      const marked: Expected[] = []
      const guard = oauthGuard(async () => tokenResponse(400, { error: "invalid_grant" }), {
        name: "atlassian",
        serverUrl: URL_A,
        auth,
        provider: { markRejected: (e) => marked.push(e) },
      })

      const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: "R1" })
      yield* Effect.promise(() => guard(TOKEN_URL, { method: "POST", body }))

      expect(marked).toHaveLength(1)
      expect(marked[0].refreshToken).toBe("R1")
      expect(marked[0].issuer).toBeUndefined()

      // The recorded fingerprint must actually match and clear the stored tokens.
      const outcome = yield* auth.invalidate("atlassian", "tokens", marked[0])
      expect(outcome._tag).toBe("cleared")
    }),
  )
})

test("fingerprints the stored client on a client error when client_id travels in the Authorization header", async () => {
  const file = authFile()
  await Effect.runPromise(
    Effect.gen(function* () {
      const auth = yield* service(file.fsLayer)
      yield* auth.set(
        "atlassian",
        { tokens: { accessToken: "a", refreshToken: "R1" }, clientInfo: { clientId: "c1", clientSecret: "s1" } },
        URL_A,
      )

      const marked: Expected[] = []
      const guard = oauthGuard(async () => tokenResponse(401, { error: "invalid_client" }), {
        name: "atlassian",
        serverUrl: URL_A,
        auth,
        provider: { markRejected: (e) => marked.push(e) },
      })

      // client_secret_basic: no client_id in the form body, only the stored refresh token.
      const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: "R1" })
      yield* Effect.promise(() =>
        guard(TOKEN_URL, { method: "POST", body, headers: { authorization: "Basic YzE6czE=" } }),
      )

      expect(marked).toHaveLength(1)
      expect(marked[0].clientId).toBe("c1")
      expect(marked[0].refreshToken).toBeUndefined()

      const outcome = yield* auth.invalidate("atlassian", "client", marked[0])
      expect(outcome._tag).toBe("cleared")
      const entry = yield* auth.get("atlassian")
      expect(entry?.clientInfo).toBeUndefined()
      expect(entry?.tokens?.refreshToken).toBe("R1")
    }),
  )
})

test("fingerprints the client binding on a client error", async () => {
  const file = authFile()
  await Effect.runPromise(
    Effect.gen(function* () {
      const auth = yield* service(file.fsLayer)
      yield* auth.set(
        "atlassian",
        { tokens: { accessToken: "a", refreshToken: "R1", issuer: "https://auth.example.com" }, clientInfo: { clientId: "c1", issuer: "https://auth.example.com" } },
        URL_A,
      )

      const marked: Expected[] = []
      const guard = oauthGuard(async () => tokenResponse(400, { error: "invalid_client" }), {
        name: "atlassian",
        serverUrl: URL_A,
        auth,
        provider: { markRejected: (e) => marked.push(e) },
      })

      const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: "R1", client_id: "c1" })
      yield* Effect.promise(() => guard(TOKEN_URL, { method: "POST", body }))

      expect(marked).toHaveLength(1)
      expect(marked[0].clientId).toBe("c1")
      expect(marked[0].issuer).toBe("https://auth.example.com")

      const outcome = yield* auth.invalidate("atlassian", "client", marked[0])
      expect(outcome._tag).toBe("cleared")
    }),
  )
})
