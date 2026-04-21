import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { promises as fs } from "fs"
import fsSync from "fs"
import path from "path"
import os from "os"
import { exportTeamToFile, importTeamFromFile } from "@/devilcode/team/io"
import {
  TeamImportError,
  TeamVersionMismatchError,
  TeamChecksumError,
  TeamSchemaValidationError,
} from "@/devilcode/team/errors"
import { computeTeamChecksum } from "@/devilcode/team/checksum"
import { loadQuickstartTemplates } from "@/devilcode/team/quickstarts"

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "devilcode-team-"))
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

function writeRaw(name: string, data: unknown): string {
  const p = path.join(tmpDir, name)
  fsSync.writeFileSync(p, JSON.stringify(data, null, 2), "utf-8")
  return p
}

describe("exportTeamToFile", () => {
  it("writes a valid envelope with current version and checksum", async () => {
    const team = loadQuickstartTemplates()["solo-enhanced"].team
    const target = path.join(tmpDir, "exp.json")
    const envelope = await exportTeamToFile(target, team, { exportedBy: "tester" })
    expect(envelope.version).toBe("1.0.0")
    expect(envelope.checksum).toMatch(/^[a-f0-9]{64}$/)
    expect(envelope.exportedBy).toBe("tester")
    const text = await fs.readFile(target, "utf-8")
    expect(text.endsWith("\n")).toBe(true)
    const parsed = JSON.parse(text)
    expect(parsed.version).toBe("1.0.0")
  })
})

describe("importTeamFromFile — malformed inputs", () => {
  it("1. ENOENT → TeamImportError{kind:file-not-found}", async () => {
    const missing = path.join(tmpDir, "does-not-exist.json")
    try {
      await importTeamFromFile(missing)
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(TeamImportError)
      expect((err as TeamImportError).kind).toBe("file-not-found")
      expect((err as TeamImportError).filePath).toBe(missing)
    }
  })

  it("2. non-JSON file → TeamImportError{kind:json-parse-failed}", async () => {
    const p = path.join(tmpDir, "binary.json")
    await fs.writeFile(p, "this is not JSON {{{", "utf-8")
    try {
      await importTeamFromFile(p)
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(TeamImportError)
      expect((err as TeamImportError).kind).toBe("json-parse-failed")
    }
  })

  it("3. bare-config rejected by CanonicalTeamConfig → TeamSchemaValidationError{layer:config}", async () => {
    const p = writeRaw("bare.json", { not: "an-envelope" })
    try {
      await importTeamFromFile(p)
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(TeamSchemaValidationError)
      expect((err as TeamSchemaValidationError).layer).toBe("config")
    }
  })

  it("4. envelope with wrong version → TeamVersionMismatchError", async () => {
    const team = loadQuickstartTemplates()["solo-enhanced"].team
    const p = writeRaw("vmismatch.json", {
      version: "9.9.9",
      checksum: computeTeamChecksum(team),
      config: team,
      exportedAt: new Date().toISOString(),
    })
    try {
      await importTeamFromFile(p)
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(TeamVersionMismatchError)
      expect((err as TeamVersionMismatchError).found).toBe("9.9.9")
      expect((err as TeamVersionMismatchError).required).toBe("1.0.0")
    }
  })

  it("5. envelope checksum mismatch → TeamChecksumError", async () => {
    const team = loadQuickstartTemplates()["solo-enhanced"].team
    const p = writeRaw("cksumbad.json", {
      version: "1.0.0",
      checksum: "0".repeat(64),
      config: team,
      exportedAt: new Date().toISOString(),
    })
    try {
      await importTeamFromFile(p)
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(TeamChecksumError)
    }
  })

  it("6. envelope with unknown top-level key → TeamSchemaValidationError{layer:envelope}", async () => {
    const team = loadQuickstartTemplates()["solo-enhanced"].team
    const p = writeRaw("unknown.json", {
      version: "1.0.0",
      checksum: computeTeamChecksum(team),
      config: team,
      exportedAt: new Date().toISOString(),
      foo: 1,
    })
    try {
      await importTeamFromFile(p)
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(TeamSchemaValidationError)
      expect((err as TeamSchemaValidationError).layer).toBe("envelope")
    }
  })

  it("7. envelope with non-hex checksum → TeamSchemaValidationError{layer:envelope}", async () => {
    const team = loadQuickstartTemplates()["solo-enhanced"].team
    const p = writeRaw("nonhex.json", {
      version: "1.0.0",
      checksum: "not-hex",
      config: team,
      exportedAt: new Date().toISOString(),
    })
    try {
      await importTeamFromFile(p)
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(TeamSchemaValidationError)
      expect((err as TeamSchemaValidationError).layer).toBe("envelope")
    }
  })

  it("8. envelope config missing required field → TeamSchemaValidationError{layer:envelope}", async () => {
    const team = loadQuickstartTemplates()["solo-enhanced"].team
    const brokenConfig = { ...team, roles: "oops" }
    const p = writeRaw("brokennested.json", {
      version: "1.0.0",
      checksum: "a".repeat(64),
      config: brokenConfig,
      exportedAt: new Date().toISOString(),
    })
    try {
      await importTeamFromFile(p)
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(TeamSchemaValidationError)
      expect((err as TeamSchemaValidationError).layer).toBe("envelope")
    }
  })
})
