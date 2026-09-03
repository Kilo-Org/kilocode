import { describe, expect, test } from "bun:test"
import path from "node:path"
import { Effect, Redacted, Result } from "effect"
import {
  decodeMetadata,
  encodeMetadata,
  endpoint,
  normalizeLoopbackEndpoint,
  parseConfig,
  parseStore,
  type Metadata,
} from "../../../src/kilocode/anaconda-desktop/domain"
import {
  candidates,
  command,
  directory,
  environment,
  supported,
  type Info,
} from "../../../src/kilocode/anaconda-desktop/platform"
import { Process } from "../../../src/util/process"

const linux = (env: NodeJS.ProcessEnv = {}): Info => ({
  platform: "linux",
  arch: "x64",
  home: "/home/kilo",
  env,
})

const metadata: Metadata = {
  version: "1",
  serverID: "server-1",
  baseURL: "http://127.0.0.1:8080/v1",
  models: [
    {
      id: "local-model",
      name: "Local Model",
      input: ["text"],
      output: ["text"],
      description: "Tool-call support is unknown.",
    },
  ],
  context: 8192,
  toolcall: "unknown",
}

describe("Anaconda Desktop config", () => {
  test("strictly parses the management key and port into a redacted value", () => {
    const parsed = Effect.runSync(
      parseConfig(JSON.stringify({ aiNavApiKey: "test-management-key", aiNavApiServerPort: 8001 })),
    )

    expect(Redacted.isRedacted(parsed.aiNavApiKey)).toBe(true)
    expect(Redacted.value(parsed.aiNavApiKey)).toBe("test-management-key")
    expect(parsed.aiNavApiServerPort).toBe(8001)
    expect(JSON.stringify(parsed)).not.toContain("test-management-key")
  })

  test("classifies malformed, missing-key, and invalid-port values without echoing input", () => {
    const cases = [
      ["not-json:test-management-key", "malformed"],
      [JSON.stringify({ aiNavApiKey: "", aiNavApiServerPort: 8001 }), "missing-key"],
      [JSON.stringify({ aiNavApiKey: "test-management-key", aiNavApiServerPort: "8001" }), "invalid-port"],
      [JSON.stringify({ aiNavApiKey: "test-management-key", aiNavApiServerPort: 70_000 }), "invalid-port"],
    ] as const

    for (const [input, reason] of cases) {
      const result = Effect.runSync(Effect.result(parseConfig(input)))
      expect(Result.isFailure(result)).toBe(true)
      if (Result.isFailure(result)) {
        expect(result.failure.reason).toBe(reason)
        expect(JSON.stringify(result.failure)).not.toContain("test-management-key")
      }
    }
  })

  test("checks only opaque non-empty OAuth entries with the required suffix", () => {
    expect(
      Effect.runSync(parseStore(JSON.stringify({ "account_ai-navigator-workos-oauth": "opaque-encrypted-value" }))),
    ).toBe(true)
    expect(Effect.runSync(parseStore(JSON.stringify({ "account_ai-navigator-workos-oauth": "" })))).toBe(false)
    expect(Effect.runSync(parseStore(JSON.stringify({ unrelated: "opaque-encrypted-value" })))).toBe(false)

    const result = Effect.runSync(Effect.result(parseStore("[]")))
    expect(Result.isFailure(result)).toBe(true)
  })
})

describe("Anaconda Desktop metadata", () => {
  test("round-trips trusted loopback metadata and rejects malformed or remote records", () => {
    const encoded = encodeMetadata(metadata)
    expect(encoded).toBeDefined()
    if (!encoded) throw new Error("metadata did not encode")
    expect(decodeMetadata(encoded)).toEqual(metadata)
    expect(decodeMetadata({ ...encoded, version: "2" })).toBeUndefined()
    expect(decodeMetadata({ ...encoded, models: "not-json" })).toBeUndefined()
    expect(decodeMetadata({ ...encoded, baseURL: "http://example.com:8080/v1" })).toBeUndefined()
    expect(endpoint("0.0.0.0", 8080)).toBe("http://127.0.0.1:8080/v1")
    expect(endpoint("::", 8080)).toBe("http://[::1]:8080/v1")
    expect(normalizeLoopbackEndpoint("http://localhost:8080/")).toBe("http://localhost:8080/v1")
    expect(normalizeLoopbackEndpoint("https://127.0.0.1:8080/v1")).toBeUndefined()
    expect(normalizeLoopbackEndpoint("http://192.168.1.2:8080/v1")).toBeUndefined()
  })
})

describe("Anaconda Desktop platform adapters", () => {
  test("resolves official cross-platform user-data locations", () => {
    expect(directory({ platform: "darwin", arch: "arm64", home: "/Users/kilo", env: {} })).toBe(
      "/Users/kilo/Library/Application Support/anaconda-desktop",
    )
    expect(
      directory({ platform: "win32", arch: "x64", home: "C:\\Users\\kilo", env: { APPDATA: "D:\\Roaming" } }),
    ).toBe(path.win32.join("D:\\Roaming", "anaconda-desktop"))
    expect(directory(linux({ XDG_DATA_HOME: "/data" }))).toBe("/data/anaconda-desktop")
    expect(directory(linux())).toBe("/home/kilo/.local/share/anaconda-desktop")
  })

  test("supports only documented operating-system and architecture pairs", () => {
    expect(supported({ platform: "darwin", arch: "arm64" })).toBe(true)
    expect(supported({ platform: "darwin", arch: "x64" })).toBe(false)
    expect(supported({ platform: "win32", arch: "x64" })).toBe(true)
    expect(supported({ platform: "linux", arch: "arm64" })).toBe(true)
    expect(supported({ platform: "freebsd", arch: "x64" })).toBe(false)
  })

  test("builds hidden Windows and Wayland-safe Linux launch commands", () => {
    const windows: Info = {
      platform: "win32",
      arch: "x64",
      home: "C:\\Users\\kilo",
      env: { LOCALAPPDATA: "C:\\Users\\kilo\\AppData\\Local" },
    }
    const executable = candidates(windows)[0]
    expect(command(windows, { path: executable })).toEqual([executable])
    expect(command(linux({ XDG_SESSION_TYPE: "wayland" }), { path: "/usr/bin/anaconda-desktop" })).toEqual([
      "/usr/bin/anaconda-desktop",
      "--ozone-platform=x11",
    ])
  })

  test("passes only required desktop environment variables to the launched app", async () => {
    const env = environment(
      linux({
        PATH: "/usr/bin",
        DISPLAY: ":0",
        KILO_SERVER_PASSWORD: "secret",
        ANTHROPIC_API_KEY: "secret",
      }),
    )
    const output = await Process.run(
      [
        process.execPath,
        "-e",
        "process.stdout.write(JSON.stringify({ path: process.env.PATH, secret: process.env.KILO_SERVER_PASSWORD }))",
      ],
      { env },
    )

    expect(JSON.parse(output.stdout.toString())).toEqual({ path: "/usr/bin" })
  })
})
