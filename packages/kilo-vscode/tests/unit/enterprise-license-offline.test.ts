import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { afterEach, describe, expect, it } from "bun:test"
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
  const file = path.join(os.tmpdir(), `license-${Date.now()}.json`)
  fs.writeFileSync(file, JSON.stringify(data))
  tmpFiles.push(file)
  return file
}

describe("parseOfflineLicense", () => {
  it("returns null when file missing", () => {
    expect(parseOfflineLicense("", "k")).toBeNull()
    expect(parseOfflineLicense("/nonexistent/license.json", "k")).toBeNull()
  })

  it("accepts valid license", () => {
    const file = writeLicense({
      key: "offline-1",
      expiresAt: "2099-01-01T00:00:00.000Z",
    })
    expect(parseOfflineLicense(file, "offline-1")).toEqual({ ok: true, reason: "offline", readonly: false })
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
