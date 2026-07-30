import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "fs"
import path from "path"
import { Cause, Effect, Exit, Option } from "effect"
import { CliError } from "../../../src/cli/effect-cmd"
import {
  AUTH_FILE,
  listConfiguredProviders,
  resolveProvider,
  run,
  tokenFor,
} from "../../../src/kilocode/cli/cmd/auth-token"

const apiKey = { type: "api", key: "kilo-key" } as const
const oauth = { type: "oauth", refresh: "r", access: "oauth-access", expires: 0 } as const
const wellknown = { type: "wellknown", key: "k", token: "wk-token" } as const

const runPromise = <A, E>(eff: Effect.Effect<A, E>) => Effect.runPromiseExit(eff)

describe("auth token: tokenFor", () => {
  test("returns the api key for api credentials", () => {
    expect(Option.getOrUndefined(tokenFor(apiKey))).toBe("kilo-key")
  })

  test("returns the access token for oauth credentials", () => {
    expect(Option.getOrUndefined(tokenFor(oauth))).toBe("oauth-access")
  })

  test("returns the token for wellknown credentials", () => {
    expect(Option.getOrUndefined(tokenFor(wellknown))).toBe("wk-token")
  })
})

describe("auth token: resolveProvider", () => {
  const known = ["kilo", "openai", "anthropic"]

  test("defaults to kilo when no provider is given", () => {
    expect(resolveProvider(undefined, known)).toBe("kilo")
  })

  test("returns the requested provider when it matches a known id exactly", () => {
    expect(resolveProvider("openai", known)).toBe("openai")
  })

  test("matches the provider id case-insensitively", () => {
    expect(resolveProvider("Anthropic", known)).toBe("anthropic")
  })

  test("passes the input through when no known provider matches", () => {
    expect(resolveProvider("custom", known)).toBe("custom")
  })
})

describe("auth token: run", () => {
  test("prints the kilo api key when no provider is given", async () => {
    const writes: string[] = []
    const exit = await runPromise(
      run({ all: { kilo: apiKey, openai: { type: "api", key: "openai-key" } }, write: (c) => writes.push(c) }),
    )
    expect(Exit.isSuccess(exit)).toBe(true)
    expect(writes.join("")).toBe("kilo-key\n")
  })

  test("prints the requested provider's token", async () => {
    const writes: string[] = []
    const exit = await runPromise(
      run({
        provider: "openai",
        all: { kilo: apiKey, openai: { type: "api", key: "openai-key" } },
        write: (c) => writes.push(c),
      }),
    )
    expect(Exit.isSuccess(exit)).toBe(true)
    expect(writes.join("")).toBe("openai-key\n")
  })

  test("matches the provider id case-insensitively", async () => {
    const writes: string[] = []
    const exit = await runPromise(run({ provider: "KILO", all: { kilo: apiKey }, write: (c) => writes.push(c) }))
    expect(Exit.isSuccess(exit)).toBe(true)
    expect(writes.join("")).toBe("kilo-key\n")
  })

  test("fails when the requested provider has no credentials", async () => {
    const writes: string[] = []
    const exit = await runPromise(run({ provider: "custom", all: { kilo: apiKey }, write: (c) => writes.push(c) }))
    if (!Exit.isFailure(exit)) throw new Error("expected failure")
    const err = Cause.squash(exit.cause)
    expect(err).toBeInstanceOf(CliError)
    expect((err as CliError).message).toContain('Not authenticated with "custom"')
    expect((err as CliError).message).toContain("kilo")
    expect(writes).toEqual([])
  })

  test("fails when there are no credentials at all", async () => {
    const exit = await runPromise(run({ all: {}, write: () => {} }))
    if (!Exit.isFailure(exit)) throw new Error("expected failure")
    const err = Cause.squash(exit.cause)
    expect(err).toBeInstanceOf(CliError)
    expect((err as CliError).message).toContain("kilo auth login")
  })

  test("writes the access token for oauth credentials", async () => {
    const writes: string[] = []
    const exit = await runPromise(run({ all: { kilo: oauth }, write: (c) => writes.push(c) }))
    expect(Exit.isSuccess(exit)).toBe(true)
    expect(writes.join("")).toBe("oauth-access\n")
  })
})

describe("auth token: listConfiguredProviders", () => {
  const originalEnv = process.env.KILO_AUTH_CONTENT
  let backup: string | undefined

  const dir = path.dirname(AUTH_FILE)

  beforeEach(() => {
    backup =
      fs.existsSync(AUTH_FILE) && fs.statSync(AUTH_FILE).isFile() ? fs.readFileSync(AUTH_FILE, "utf8") : undefined
    delete process.env.KILO_AUTH_CONTENT
  })

  afterEach(() => {
    try {
      fs.rmSync(AUTH_FILE, { recursive: true, force: true })
    } catch {}
    if (backup !== undefined) fs.writeFileSync(AUTH_FILE, backup)
    if (originalEnv === undefined) delete process.env.KILO_AUTH_CONTENT
    else process.env.KILO_AUTH_CONTENT = originalEnv
  })

  test("returns the configured provider keys from auth.json", () => {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(AUTH_FILE, JSON.stringify({ kilo: apiKey, "opencode-go": apiKey, minimax: oauth }))
    expect(listConfiguredProviders().sort()).toEqual(["kilo", "minimax", "opencode-go"])
  })

  test("returns an empty list when auth.json is missing", () => {
    try {
      fs.unlinkSync(AUTH_FILE)
    } catch {}
    expect(listConfiguredProviders()).toEqual([])
  })

  test("returns an empty list when auth.json is malformed", () => {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(AUTH_FILE, "not json")
    expect(listConfiguredProviders()).toEqual([])
  })

  test("prefers KILO_AUTH_CONTENT when set", () => {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(AUTH_FILE, JSON.stringify({ kilo: apiKey }))
    process.env.KILO_AUTH_CONTENT = JSON.stringify({ "opencode-go": apiKey })
    expect(listConfiguredProviders()).toEqual(["opencode-go"])
  })

  test("falls back to auth.json when KILO_AUTH_CONTENT is malformed", () => {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(AUTH_FILE, JSON.stringify({ kilo: apiKey, "opencode-go": apiKey }))
    process.env.KILO_AUTH_CONTENT = "not json"
    expect(listConfiguredProviders().sort()).toEqual(["kilo", "opencode-go"])
  })
})
