import { expect, test } from "bun:test"
import { setTimeout as sleep } from "node:timers/promises"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Effect, Layer } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { McpAuth } from "../../../src/mcp/auth"

const URL_A = "https://mcp.example.com/mcp"
const URL_B = "https://other.example.com/mcp"

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

  return { fsLayer, raw: () => raw }
}

function service(fsLayer: Layer.Layer<FSUtil.Service>) {
  return McpAuth.Service.use((auth) => Effect.succeed(auth)).pipe(
    Effect.provide(AppNodeBuilder.build(McpAuth.node, [[FSUtil.node, fsLayer]])),
  )
}

test("clears tokens only when the stored refresh token still matches the rejected one", async () => {
  const file = authFile()
  await Effect.runPromise(
    Effect.gen(function* () {
      const auth = yield* service(file.fsLayer)
      yield* auth.set(
        "atlassian",
        { tokens: { accessToken: "old-access", refreshToken: "R1" }, clientInfo: { clientId: "c1" } },
        URL_A,
      )

      const outcome = yield* auth.invalidate("atlassian", "tokens", {
        serverUrl: URL_A,
        refreshToken: "R1",
        clientId: "c1",
      })

      expect(outcome._tag).toBe("cleared")
      const entry = yield* auth.get("atlassian")
      expect(entry?.tokens).toBeUndefined()
      // the unrelated client binding survives
      expect(entry?.clientInfo?.clientId).toBe("c1")
    }),
  )
})

test("keeps newer rotated tokens when the rejected refresh token is stale", async () => {
  const file = authFile()
  await Effect.runPromise(
    Effect.gen(function* () {
      const auth = yield* service(file.fsLayer)
      // Another instance already rotated R1 -> R2 and saved them.
      yield* auth.set("atlassian", { tokens: { accessToken: "new-access", refreshToken: "R2" } }, URL_A)

      const outcome = yield* auth.invalidate("atlassian", "tokens", {
        serverUrl: URL_A,
        refreshToken: "R1",
      })

      expect(outcome._tag).toBe("superseded")
      const entry = yield* auth.get("atlassian")
      expect(entry?.tokens?.refreshToken).toBe("R2")
      expect(entry?.tokens?.accessToken).toBe("new-access")
    }),
  )
})

test("does not clear an entry bound to a different server URL", async () => {
  const file = authFile()
  await Effect.runPromise(
    Effect.gen(function* () {
      const auth = yield* service(file.fsLayer)
      yield* auth.set("atlassian", { tokens: { accessToken: "a", refreshToken: "R1" } }, URL_B)

      const outcome = yield* auth.invalidate("atlassian", "tokens", { serverUrl: URL_A, refreshToken: "R1" })

      expect(outcome._tag).toBe("superseded")
      const entry = yield* auth.get("atlassian")
      expect(entry?.tokens?.refreshToken).toBe("R1")
    }),
  )
})

test("clears the client binding without touching tokens", async () => {
  const file = authFile()
  await Effect.runPromise(
    Effect.gen(function* () {
      const auth = yield* service(file.fsLayer)
      yield* auth.set(
        "atlassian",
        { tokens: { accessToken: "a", refreshToken: "R1" }, clientInfo: { clientId: "c1" } },
        URL_A,
      )

      const outcome = yield* auth.invalidate("atlassian", "client", { serverUrl: URL_A, clientId: "c1" })

      expect(outcome._tag).toBe("cleared")
      const entry = yield* auth.get("atlassian")
      expect(entry?.clientInfo).toBeUndefined()
      expect(entry?.tokens?.refreshToken).toBe("R1")
    }),
  )
})

test("preserves PKCE verifier and OAuth state when clearing tokens", async () => {
  const file = authFile()
  await Effect.runPromise(
    Effect.gen(function* () {
      const auth = yield* service(file.fsLayer)
      yield* auth.set(
        "atlassian",
        { tokens: { accessToken: "a", refreshToken: "R1" }, codeVerifier: "verifier", oauthState: "state" },
        URL_A,
      )

      yield* auth.invalidate("atlassian", "tokens", { serverUrl: URL_A, refreshToken: "R1" })

      const entry = yield* auth.get("atlassian")
      expect(entry?.codeVerifier).toBe("verifier")
      expect(entry?.oauthState).toBe("state")
      expect(entry?.tokens).toBeUndefined()
    }),
  )
})

test("reports missing when no entry exists", async () => {
  const file = authFile()
  await Effect.runPromise(
    Effect.gen(function* () {
      const auth = yield* service(file.fsLayer)
      const outcome = yield* auth.invalidate("atlassian", "tokens", { serverUrl: URL_A, refreshToken: "R1" })
      expect(outcome._tag).toBe("missing")
    }),
  )
})
