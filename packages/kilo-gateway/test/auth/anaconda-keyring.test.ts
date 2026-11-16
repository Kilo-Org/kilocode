import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { saveCredential, getApiKey } from "../../src/auth/anaconda-keyring.js"

let tmpdir: string
let keyringFile: string

beforeEach(() => {
  tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), "keyring-test-"))
  keyringFile = path.join(tmpdir, "keyring")
  process.env.ANA_KEYRING_PATH = keyringFile
})

afterEach(() => {
  delete process.env.ANA_KEYRING_PATH
  fs.rmSync(tmpdir, { recursive: true, force: true })
})

describe("saveCredential + getApiKey", () => {
  test("save and retrieve an API key", () => {
    saveCredential({ apiKey: "ad-test-key-12345" })
    expect(getApiKey()).toBe("ad-test-key-12345")
  })

  test("defaults to anaconda.com domain", () => {
    saveCredential({ apiKey: "ad-key" })
    expect(getApiKey("anaconda.com")).toBe("ad-key")
  })

  test("returns undefined when no key exists", () => {
    expect(getApiKey()).toBeUndefined()
  })

  test("returns undefined for wrong domain", () => {
    saveCredential({ apiKey: "ad-key", domain: "staging.anaconda.com" })
    expect(getApiKey("anaconda.com")).toBeUndefined()
    expect(getApiKey("staging.anaconda.com")).toBe("ad-key")
  })
})

describe("multiple domains", () => {
  test("preserves credentials for other domains", () => {
    saveCredential({ apiKey: "key-1", domain: "domain1.com" })
    saveCredential({ apiKey: "key-2", domain: "domain2.com" })

    expect(getApiKey("domain1.com")).toBe("key-1")
    expect(getApiKey("domain2.com")).toBe("key-2")
  })

  test("overwrites same domain without affecting others", () => {
    saveCredential({ apiKey: "old-key", domain: "anaconda.com" })
    saveCredential({ apiKey: "other-key", domain: "staging.anaconda.com" })
    saveCredential({ apiKey: "new-key", domain: "anaconda.com" })

    expect(getApiKey("anaconda.com")).toBe("new-key")
    expect(getApiKey("staging.anaconda.com")).toBe("other-key")
  })
})

describe("keyring JSON format", () => {
  test("matches anaconda-cli format: Anaconda Cloud -> domain -> base64", () => {
    saveCredential({ apiKey: "my-api-key", domain: "example.com" })

    const raw = fs.readFileSync(keyringFile, "utf-8")
    const keyring = JSON.parse(raw)

    expect(keyring).toHaveProperty("Anaconda Cloud")
    expect("example.com" in keyring["Anaconda Cloud"]).toBe(true)

    const encoded = keyring["Anaconda Cloud"]["example.com"]
    const decoded = JSON.parse(Buffer.from(encoded, "base64").toString("utf-8"))

    expect(decoded.domain).toBe("example.com")
    expect(decoded.api_key).toBe("my-api-key")
    expect(decoded.repo_tokens).toEqual([])
    expect(decoded.version).toBe(2)
  })

  test("omits user_id and username when not provided", () => {
    saveCredential({ apiKey: "key" })

    const raw = fs.readFileSync(keyringFile, "utf-8")
    const keyring = JSON.parse(raw)
    const encoded = keyring["Anaconda Cloud"]["anaconda.com"]
    const decoded = JSON.parse(Buffer.from(encoded, "base64").toString("utf-8"))

    expect(decoded).not.toHaveProperty("user_id")
    expect(decoded).not.toHaveProperty("username")
  })

  test("includes user_id and username when provided", () => {
    saveCredential({ apiKey: "key", userId: "user-123", username: "alice" })

    const raw = fs.readFileSync(keyringFile, "utf-8")
    const keyring = JSON.parse(raw)
    const encoded = keyring["Anaconda Cloud"]["anaconda.com"]
    const decoded = JSON.parse(Buffer.from(encoded, "base64").toString("utf-8"))

    expect(decoded.user_id).toBe("user-123")
    expect(decoded.username).toBe("alice")
  })
})

const unix = process.platform !== "win32"

describe("file permissions", () => {
  test.skipIf(!unix)("keyring file has 0o600 permissions", () => {
    saveCredential({ apiKey: "key" })

    const stats = fs.statSync(keyringFile)
    expect(stats.mode & 0o777).toBe(0o600)
  })

  test.skipIf(!unix)("parent directory has 0o700 permissions", () => {
    // Use a nested path so ensureDir creates the parent
    const nested = path.join(tmpdir, "nested", "keyring")
    process.env.ANA_KEYRING_PATH = nested

    saveCredential({ apiKey: "key" })

    const stats = fs.statSync(path.dirname(nested))
    expect(stats.mode & 0o777).toBe(0o700)
  })

  test("creates parent directories if missing", () => {
    const nested = path.join(tmpdir, "a", "b", "c", "keyring")
    process.env.ANA_KEYRING_PATH = nested

    saveCredential({ apiKey: "key" })

    expect(fs.existsSync(nested)).toBe(true)
    expect(getApiKey()).toBe("key")
  })
})

describe("compatibility with anaconda-cli", () => {
  test("can read a credential written by anaconda-cli format", () => {
    // Simulate what anaconda-cli (Rust) writes
    const credential = {
      domain: "anaconda.com",
      api_key: "ad-rust-written-key",
      repo_tokens: [{ token: "rt-1", org_name: "myorg" }],
      version: 2,
      username: "testuser",
    }
    const encoded = Buffer.from(JSON.stringify(credential)).toString("base64")
    const keyring = { "Anaconda Cloud": { "anaconda.com": encoded } }
    fs.writeFileSync(keyringFile, JSON.stringify(keyring))

    expect(getApiKey()).toBe("ad-rust-written-key")
  })

  test("preserves existing anaconda-cli entries when adding a new domain", () => {
    // Pre-populate with a credential from anaconda-cli
    const existing = {
      domain: "staging.anaconda.com",
      api_key: "ad-staging-key",
      repo_tokens: [],
      version: 2,
      username: "staging-user",
    }
    const encoded = Buffer.from(JSON.stringify(existing)).toString("base64")
    const keyring = { "Anaconda Cloud": { "staging.anaconda.com": encoded } }
    fs.writeFileSync(keyringFile, JSON.stringify(keyring))

    // Save a new credential for a different domain
    saveCredential({ apiKey: "ad-prod-key", domain: "anaconda.com" })

    // Both should be readable
    expect(getApiKey("staging.anaconda.com")).toBe("ad-staging-key")
    expect(getApiKey("anaconda.com")).toBe("ad-prod-key")

    // Verify the raw file still has both
    const raw = JSON.parse(fs.readFileSync(keyringFile, "utf-8"))
    expect(Object.keys(raw["Anaconda Cloud"])).toEqual(
      expect.arrayContaining(["staging.anaconda.com", "anaconda.com"]),
    )
  })
})
