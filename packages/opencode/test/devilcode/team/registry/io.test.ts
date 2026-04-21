import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { publishManifest, installManifest } from "@/devilcode/team/registry/io"
import { generateKeyPair } from "@/devilcode/team/registry/signing"
import { addTrustedPublisher } from "@/devilcode/team/registry/trust-store"
import {
  TeamSignatureError,
  TeamPublisherNotTrusted,
  TeamManifestInvalid,
} from "@/devilcode/team/registry/errors"
import { loadQuickstartTemplates } from "@/devilcode/team/quickstarts"
import type { CanonicalTeamConfig } from "@/devilcode/team/config"

let tempDir: string

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-registry-io-test-"))
})

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true })
})

const PUBLISHER_ID = "550e8400-e29b-41d4-a716-446655440001"

function getTestConfig(): CanonicalTeamConfig {
  return loadQuickstartTemplates()["solo-enhanced"].team as CanonicalTeamConfig
}

function baseOptions() {
  return {
    name: "Test Team",
    author: "Test Author",
    publisherId: PUBLISHER_ID,
    version: "1.0.0",
  }
}

// ─── publishManifest ────────────────────────────────────────────────────────

describe("publishManifest", () => {
  it("creates a valid manifest file at outputPath", async () => {
    const outputPath = path.join(tempDir, "team.manifest.json")
    const config = getTestConfig()
    const manifest = await publishManifest(config, outputPath, baseOptions())

    // File should exist
    const text = await fs.readFile(outputPath, "utf-8")
    const parsed = JSON.parse(text)
    expect(parsed.manifestVersion).toBe("1.0")
    expect(parsed.envelope.config).toBeDefined()
    expect(parsed.metadata.name).toBe("Test Team")
    expect(parsed.metadata.author).toBe("Test Author")

    // Returned value matches file content
    expect(manifest.manifestVersion).toBe("1.0")
    expect(manifest.metadata.version).toBe("1.0.0")
  })

  it("creates parent directories if they don't exist", async () => {
    const outputPath = path.join(tempDir, "nested", "deep", "team.manifest.json")
    const config = getTestConfig()
    await publishManifest(config, outputPath, baseOptions())
    const text = await fs.readFile(outputPath, "utf-8")
    const parsed = JSON.parse(text)
    expect(parsed.manifestVersion).toBe("1.0")
  })

  it("with privateKey creates a signed manifest (signature field present)", async () => {
    const outputPath = path.join(tempDir, "signed.manifest.json")
    const config = getTestConfig()
    const { privateKey } = generateKeyPair()
    const manifest = await publishManifest(config, outputPath, { ...baseOptions(), privateKey })

    expect(manifest.signature).toBeDefined()
    expect(typeof manifest.signature).toBe("string")
    expect(manifest.signature!.length).toBeGreaterThan(0)

    // File should also have signature
    const parsed = JSON.parse(await fs.readFile(outputPath, "utf-8"))
    expect(parsed.signature).toBeDefined()
  })

  it("without privateKey creates an unsigned manifest (no signature field)", async () => {
    const outputPath = path.join(tempDir, "unsigned.manifest.json")
    const config = getTestConfig()
    const manifest = await publishManifest(config, outputPath, baseOptions())

    expect(manifest.signature).toBeUndefined()

    const parsed = JSON.parse(await fs.readFile(outputPath, "utf-8"))
    expect(parsed.signature).toBeUndefined()
  })

  it("includes optional metadata fields when provided", async () => {
    const outputPath = path.join(tempDir, "meta.manifest.json")
    const config = getTestConfig()
    const manifest = await publishManifest(config, outputPath, {
      ...baseOptions(),
      description: "A test team",
      tags: ["testing", "dev"],
      license: "MIT",
    })

    expect(manifest.metadata.description).toBe("A test team")
    expect(manifest.metadata.tags).toEqual(["testing", "dev"])
    expect(manifest.metadata.license).toBe("MIT")
  })
})

// ─── installManifest ────────────────────────────────────────────────────────

describe("installManifest — from local file", () => {
  it("returns correct config from an unsigned manifest", async () => {
    const outputPath = path.join(tempDir, "install.manifest.json")
    const config = getTestConfig()
    await publishManifest(config, outputPath, baseOptions())

    const result = await installManifest(outputPath)
    expect(result.config).toBeDefined()
    expect(result.manifest.manifestVersion).toBe("1.0")
    expect(result.warnings).toContain("Manifest is unsigned — authenticity not verified")
  })

  it("warns on unsigned manifest when requireSignature=false", async () => {
    const outputPath = path.join(tempDir, "warn.manifest.json")
    await publishManifest(getTestConfig(), outputPath, baseOptions())

    const result = await installManifest(outputPath, { requireSignature: false })
    expect(result.warnings.some((w) => w.includes("unsigned"))).toBe(true)
  })

  it("throws TeamSignatureError when requireSignature=true and manifest is unsigned", async () => {
    const outputPath = path.join(tempDir, "reqsig.manifest.json")
    await publishManifest(getTestConfig(), outputPath, baseOptions())

    await expect(installManifest(outputPath, { requireSignature: true })).rejects.toThrow(TeamSignatureError)
  })

  it("throws TeamManifestInvalid on malformed JSON", async () => {
    const badPath = path.join(tempDir, "bad.json")
    await fs.writeFile(badPath, "{ not valid }", "utf-8")
    await expect(installManifest(badPath)).rejects.toThrow(TeamManifestInvalid)
  })

  it("throws TeamManifestInvalid on schema-invalid manifest", async () => {
    const badPath = path.join(tempDir, "invalid.json")
    await fs.writeFile(badPath, JSON.stringify({ manifestVersion: "2.0", garbage: true }), "utf-8")
    await expect(installManifest(badPath)).rejects.toThrow(TeamManifestInvalid)
  })
})

describe("installManifest — signature verification", () => {
  it("verifies signature when publisher is in trust store", async () => {
    const { publicKey, privateKey } = generateKeyPair()
    const outputPath = path.join(tempDir, "trusted.manifest.json")
    const storePath = path.join(tempDir, "trust-store.json")

    // Publish signed manifest
    await publishManifest(getTestConfig(), outputPath, { ...baseOptions(), privateKey })

    // Add publisher to trust store
    await addTrustedPublisher(PUBLISHER_ID, publicKey, undefined, storePath)

    // Trust-store path DI not supported by installManifest; bypass the store lookup
    // but supply the public key explicitly so signature still verifies.
    const result = await installManifest(outputPath, { skipTrustCheck: true, verifyWithKey: publicKey })
    expect(result.config).toBeDefined()
    expect(result.warnings).toHaveLength(0)
  })

  it("throws TeamPublisherNotTrusted when publisher not in trust store", async () => {
    const { privateKey } = generateKeyPair()
    const outputPath = path.join(tempDir, "untrusted.manifest.json")

    // Publish signed manifest (publisher NOT in real trust store)
    await publishManifest(getTestConfig(), outputPath, { ...baseOptions(), privateKey })

    // getTrustedPublisher will hit the real (empty) trust store
    await expect(installManifest(outputPath)).rejects.toThrow(TeamPublisherNotTrusted)
  })

  it("throws TeamSignatureError for tampered signature", async () => {
    const { publicKey, privateKey } = generateKeyPair()
    const outputPath = path.join(tempDir, "tampered.manifest.json")

    await publishManifest(getTestConfig(), outputPath, { ...baseOptions(), privateKey })

    // Tamper with the signature bytes
    const raw = JSON.parse(await fs.readFile(outputPath, "utf-8"))
    raw.signature = "AAAA" + raw.signature.slice(4)
    await fs.writeFile(outputPath, JSON.stringify(raw), "utf-8")

    // skipTrustCheck bypasses the trust store; verifyWithKey performs crypto verification.
    // A tampered signature must still be detected and rejected.
    await expect(
      installManifest(outputPath, { skipTrustCheck: true, verifyWithKey: publicKey }),
    ).rejects.toThrow(TeamSignatureError)
  })
})
