import { afterEach, describe, expect, test } from "bun:test"
import { Option, Redacted } from "effect"
import { Flag } from "@opencode-ai/core/flag/flag"
import { ServerAuth } from "../../src/server/auth"

const original = {
  KILO_SERVER_PASSWORD: Flag.KILO_SERVER_PASSWORD,
  KILO_SERVER_USERNAME: Flag.KILO_SERVER_USERNAME,
}

afterEach(() => {
  Flag.KILO_SERVER_PASSWORD = original.KILO_SERVER_PASSWORD
  Flag.KILO_SERVER_USERNAME = original.KILO_SERVER_USERNAME
})

describe("ServerAuth", () => {
  test("does not emit auth headers without a password", () => {
    Flag.KILO_SERVER_PASSWORD = undefined
    Flag.KILO_SERVER_USERNAME = "alice"

    expect(ServerAuth.header()).toBeUndefined()
    expect(ServerAuth.headers()).toBeUndefined()
  })

  test("defaults to the kilo username", () => {
    // kilocode_change
    Flag.KILO_SERVER_PASSWORD = "secret"
    Flag.KILO_SERVER_USERNAME = undefined

    expect(ServerAuth.headers()).toEqual({
      Authorization: `Basic ${Buffer.from("kilo:secret").toString("base64")}`, // kilocode_change
    })
  })

  test("uses the configured username", () => {
    Flag.KILO_SERVER_PASSWORD = "secret"
    Flag.KILO_SERVER_USERNAME = "alice"

    expect(ServerAuth.headers()).toEqual({
      Authorization: `Basic ${Buffer.from("alice:secret").toString("base64")}`,
    })
  })

  test("prefers explicit credentials", () => {
    Flag.KILO_SERVER_PASSWORD = "secret"
    Flag.KILO_SERVER_USERNAME = "alice"

    expect(ServerAuth.headers({ password: "cli-secret", username: "bob" })).toEqual({
      Authorization: `Basic ${Buffer.from("bob:cli-secret").toString("base64")}`,
    })
  })

  test("validates decoded credentials against effect config", () => {
    const config = { password: Option.some("secret"), username: "alice" }

    expect(ServerAuth.required(config)).toBe(true)
    expect(ServerAuth.authorized({ username: "alice", password: Redacted.make("secret") }, config)).toBe(true)
    expect(ServerAuth.authorized({ username: "kilo", password: Redacted.make("secret") }, config)).toBe(false) // kilocode_change
  })
})
