import * as crypto from "crypto"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { afterEach, describe, expect, it } from "bun:test"
import { offlinePayloadBytes, signRsaSha256, verifyRsaSha256 } from "../../src/enterprise/license-crypto"
import { parseOfflineLicense } from "../../src/enterprise/license"

const tmpFiles: string[] = []

afterEach(() => {
  for (const file of tmpFiles) {
    try {
      fs.unlinkSync(file)
    } catch {
      // ignore
    }
  }
  tmpFiles.length = 0
})

function writeLicense(data: object) {
  const file = path.join(os.tmpdir(), `license-${Date.now()}-${Math.random()}.json`)
  fs.writeFileSync(file, JSON.stringify(data))
  tmpFiles.push(file)
  return file
}

function devKeys() {
  return crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  })
}

describe("license-crypto", () => {
  it("sign and verify RSA-SHA256 payload", () => {
    const keys = devKeys()
    const payload = { key: "k1", expiresAt: "2099-01-01T00:00:00.000Z" }
    const sig = signRsaSha256(payload, keys.privateKey)
    expect(verifyRsaSha256(payload, sig, keys.publicKey)).toBe(true)
    expect(verifyRsaSha256({ ...payload, key: "other" }, sig, keys.publicKey)).toBe(false)
  })

  it("uses stable canonical bytes", () => {
    const payload = { key: "a", expiresAt: "2099-01-01T00:00:00.000Z" }
    expect(offlinePayloadBytes(payload).toString()).toBe('{"expiresAt":"2099-01-01T00:00:00.000Z","key":"a"}')
  })
})

describe("parseOfflineLicense", () => {
  it("returns null when file missing", () => {
    expect(parseOfflineLicense("", "k")).toBeNull()
    expect(parseOfflineLicense("/nonexistent/license.json", "k")).toBeNull()
  })

  it("accepts valid unsigned license (legacy)", () => {
    const file = writeLicense({
      key: "offline-1",
      expiresAt: "2099-01-01T00:00:00.000Z",
    })
    expect(parseOfflineLicense(file, "offline-1")).toEqual({ ok: true, reason: "offline", readonly: false })
  })

  it("accepts RSA-signed license", () => {
    const keys = devKeys()
    const payload = { key: "offline-rsa", expiresAt: "2099-01-01T00:00:00.000Z" }
    const signature = signRsaSha256(payload, keys.privateKey)
    const file = writeLicense({ ...payload, signature, algorithm: "RSA-SHA256" })
    expect(parseOfflineLicense(file, "offline-rsa", keys.publicKey)).toEqual({
      ok: true,
      reason: "offline_rsa",
      readonly: false,
    })
  })

  it("rejects bad RSA signature", () => {
    const keys = devKeys()
    const file = writeLicense({
      key: "offline-rsa",
      expiresAt: "2099-01-01T00:00:00.000Z",
      signature: Buffer.from("bad").toString("base64"),
    })
    expect(parseOfflineLicense(file, "offline-rsa", keys.publicKey)?.reason).toBe("offline_bad_signature")
  })

  it("requires public key when signature present", () => {
    const keys = devKeys()
    const payload = { key: "offline-rsa", expiresAt: "2099-01-01T00:00:00.000Z" }
    const signature = signRsaSha256(payload, keys.privateKey)
    const file = writeLicense({ ...payload, signature })
    expect(parseOfflineLicense(file, "offline-rsa", "")?.reason).toBe("offline_no_public_key")
  })

  it("rejects expired license", () => {
    const file = writeLicense({
      key: "offline-1",
      expiresAt: "2020-01-01T00:00:00.000Z",
    })
    expect(parseOfflineLicense(file, "offline-1")?.ok).toBe(false)
  })

  it("rejects key mismatch", () => {
    const file = writeLicense({
      key: "a",
      expiresAt: "2099-01-01T00:00:00.000Z",
    })
    expect(parseOfflineLicense(file, "b")?.reason).toBe("offline_key_mismatch")
  })
})
