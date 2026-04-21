/**
 * Security test suite — Team Registry
 *
 * Validates that all cryptographic attack vectors against the registry are
 * correctly rejected. Each describe block maps to one of the five threat
 * categories defined in the Phase 08-03 threat model.
 *
 * Trust store interactions with installManifest:
 *   installManifest calls getTrustedPublisher(id) without a path parameter,
 *   so it always hits TRUST_STORE_PATH. Tests that exercise this path write
 *   to and clean up the real global store in afterEach. Tests that only need
 *   to verify cryptographic properties use skipTrustCheck:true to isolate
 *   the layer under test.
 */
import { describe, test, expect, beforeAll, beforeEach, afterEach } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { generateKeyPair, signManifest, verifyManifestSignature } from "@/devilcode/team/registry/signing"
import { publishManifest, installManifest } from "@/devilcode/team/registry/io"
import {
  addTrustedPublisher,
  removeTrustedPublisher,
  loadTrustStore,
} from "@/devilcode/team/registry/trust-store"
import {
  TeamSignatureError,
  TeamPublisherNotTrusted,
  TeamManifestInvalid,
} from "@/devilcode/team/registry/errors"
import { loadQuickstartTemplates } from "@/devilcode/team/quickstarts"
import { computeTeamChecksum } from "@/devilcode/team/checksum"
import type { CanonicalTeamConfig } from "@/devilcode/team/config"
import type { TeamRegistryManifest } from "@/devilcode/team/registry/manifest"

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const PUBLISHER_ID = "550e8400-e29b-41d4-a716-446655440099"

let kp1: { publicKey: string; privateKey: string }
let kp2: { publicKey: string; privateKey: string }
let tempDir: string

function getTestConfig(): CanonicalTeamConfig {
  return loadQuickstartTemplates()["code-review-pair"].team as CanonicalTeamConfig
}

function baseOptions(overrides?: object) {
  return {
    name: "Security Test Team",
    author: "Security Tester",
    publisherId: PUBLISHER_ID,
    version: "1.0.0",
    ...overrides,
  }
}

const NOW = new Date().toISOString()

/** Build a signed manifest object in memory (no file I/O) */
function buildSignedManifestObject(privateKey: string): TeamRegistryManifest {
  const config = getTestConfig()
  const checksum = computeTeamChecksum(config)
  const envelope = {
    version: "1.1.0" as const,
    checksum,
    config,
    exportedAt: NOW,
  }
  const metadata = {
    name: "Security Test Team",
    author: "Security Tester",
    publisherId: PUBLISHER_ID,
    version: "1.0.0",
    publishedAt: NOW,
  }
  const signature = signManifest(envelope as any, metadata as any, privateKey)
  return { manifestVersion: "1.0", envelope: envelope as any, metadata: metadata as any, signature }
}

beforeAll(async () => {
  kp1 = generateKeyPair()
  kp2 = generateKeyPair()
})

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-security-test-"))
})

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true })
  // Clean up the global trust store entry added by this test suite
  await removeTrustedPublisher(PUBLISHER_ID).catch(() => {})
})

// ---------------------------------------------------------------------------
// 1. Signature Forgery Resistance
// ---------------------------------------------------------------------------

describe("Signature Forgery Resistance", () => {
  test("verifyManifestSignature returns false when verified against wrong public key", () => {
    // Sign with kp1.privateKey — attacker cannot forge with kp2
    const manifest = buildSignedManifestObject(kp1.privateKey)
    // Verifying with kp2's public key must fail
    expect(verifyManifestSignature(manifest, kp2.publicKey)).toBe(false)
  })

  test("verifyManifestSignature returns false for random bytes as signature", () => {
    const manifest = buildSignedManifestObject(kp1.privateKey)
    // Replace the real signature with random base64 bytes
    const tampered: TeamRegistryManifest = {
      ...manifest,
      signature: Buffer.from("random-attacker-bytes-1234567890abcdef").toString("base64"),
    }
    expect(verifyManifestSignature(tampered, kp1.publicKey)).toBe(false)
  })

  test("verifyManifestSignature returns false for empty signature string", () => {
    const manifest = buildSignedManifestObject(kp1.privateKey)
    const emptySignature: TeamRegistryManifest = { ...manifest, signature: "" }
    // Empty string is falsy — verifyManifestSignature guards: if (!manifest.signature) return false
    expect(verifyManifestSignature(emptySignature, kp1.publicKey)).toBe(false)
  })

  test("installManifest rejects a manifest signed with wrong key even when publisher is trusted with correct key", async () => {
    // Publish signed with kp1 (the legitimate publisher key)
    const outputPath = path.join(tempDir, "wrong-key.manifest.json")
    await publishManifest(getTestConfig(), outputPath, {
      ...baseOptions(),
      privateKey: kp1.privateKey,
    })

    // Trust store registers kp2.publicKey for this publisher — not kp1
    await addTrustedPublisher(PUBLISHER_ID, kp2.publicKey)

    // installManifest should fetch kp2's key, verify against it — signature invalid
    await expect(installManifest(outputPath)).rejects.toThrow(TeamSignatureError)
  })

  test("verifyManifestSignature returns false for all-zero signature bytes", () => {
    const manifest = buildSignedManifestObject(kp1.privateKey)
    const zeroBytes = Buffer.alloc(64, 0).toString("base64")
    const zeroed: TeamRegistryManifest = { ...manifest, signature: zeroBytes }
    expect(verifyManifestSignature(zeroed, kp1.publicKey)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 2. Manifest Tampering Detection
// ---------------------------------------------------------------------------

describe("Manifest Tampering Detection", () => {
  // These tests use verifyManifestSignature directly — no trust store needed.
  // The signature payload covers every field in envelope + metadata, so any
  // mutation — however small — invalidates the signature.

  test("verifyManifestSignature detects modification to envelope config after signing", () => {
    const manifest = buildSignedManifestObject(kp1.privateKey)
    // Mutate enabled flag without re-signing
    const tampered = {
      ...manifest,
      envelope: {
        ...manifest.envelope,
        config: { ...manifest.envelope.config, enabled: !manifest.envelope.config.enabled },
      },
    } as TeamRegistryManifest
    expect(verifyManifestSignature(tampered, kp1.publicKey)).toBe(false)
  })

  test("verifyManifestSignature detects modification to metadata.name after signing", () => {
    const manifest = buildSignedManifestObject(kp1.privateKey)
    const tampered: TeamRegistryManifest = {
      ...manifest,
      metadata: { ...manifest.metadata, name: "Attacker Injected Name" },
    }
    expect(verifyManifestSignature(tampered, kp1.publicKey)).toBe(false)
  })

  test("verifyManifestSignature detects modification to metadata.version after signing", () => {
    const manifest = buildSignedManifestObject(kp1.privateKey)
    // Bump version without re-signing — attacker cannot forge a version upgrade
    const tampered: TeamRegistryManifest = {
      ...manifest,
      metadata: { ...manifest.metadata, version: "9.9.9" },
    }
    expect(verifyManifestSignature(tampered, kp1.publicKey)).toBe(false)
  })

  test("verifyManifestSignature detects modification to envelope.exportedAt after signing", () => {
    const manifest = buildSignedManifestObject(kp1.privateKey)
    const tampered: TeamRegistryManifest = {
      ...manifest,
      envelope: { ...manifest.envelope, exportedAt: "2000-01-01T00:00:00.000Z" },
    }
    expect(verifyManifestSignature(tampered, kp1.publicKey)).toBe(false)
  })

  test("verifyManifestSignature detects modification to envelope.checksum after signing", () => {
    const manifest = buildSignedManifestObject(kp1.privateKey)
    const fakeChecksum = "b".repeat(64)
    const tampered: TeamRegistryManifest = {
      ...manifest,
      envelope: { ...manifest.envelope, checksum: fakeChecksum },
    }
    expect(verifyManifestSignature(tampered, kp1.publicKey)).toBe(false)
  })

  test("installManifest detects tampered metadata.author via trusted publisher path (file-level MITM)", async () => {
    // End-to-end tamper test: publisher is trusted so signature verification runs,
    // then catches the MITM modification to metadata.
    const outputPath = path.join(tempDir, "tamper-author.manifest.json")
    await publishManifest(getTestConfig(), outputPath, {
      ...baseOptions(),
      privateKey: kp1.privateKey,
    })

    // MITM tampering: change the author field after signing
    const raw = JSON.parse(await fs.readFile(outputPath, "utf-8"))
    raw.metadata.author = "MITM Attacker"
    const tamperedPath = path.join(tempDir, "tamper-author-modified.manifest.json")
    await fs.writeFile(tamperedPath, JSON.stringify(raw), "utf-8")

    // Trust the publisher with the correct key — verification runs and catches tampering
    await addTrustedPublisher(PUBLISHER_ID, kp1.publicKey)
    await expect(installManifest(tamperedPath)).rejects.toThrow(TeamSignatureError)
  })
})

// ---------------------------------------------------------------------------
// 3. Trust Store Integrity
// ---------------------------------------------------------------------------

describe("Trust Store Integrity", () => {
  test("installManifest rejects signed manifest from unknown publisher", async () => {
    const outputPath = path.join(tempDir, "unknown-publisher.manifest.json")
    // Publisher NOT in global trust store
    await publishManifest(getTestConfig(), outputPath, {
      ...baseOptions(),
      privateKey: kp1.privateKey,
    })

    // getTrustedPublisher will return undefined — must throw
    await expect(installManifest(outputPath)).rejects.toThrow(TeamPublisherNotTrusted)
  })

  test("installManifest rejects manifest after publisher removed from trust store", async () => {
    const outputPath = path.join(tempDir, "revoked.manifest.json")
    await publishManifest(getTestConfig(), outputPath, {
      ...baseOptions(),
      privateKey: kp1.privateKey,
    })

    // Trust, then immediately revoke
    await addTrustedPublisher(PUBLISHER_ID, kp1.publicKey)
    await removeTrustedPublisher(PUBLISHER_ID)

    // Publisher no longer trusted — must reject
    await expect(installManifest(outputPath)).rejects.toThrow(TeamPublisherNotTrusted)
  })

  test("installManifest accepts manifest when publisher is trusted with matching key", async () => {
    const outputPath = path.join(tempDir, "trusted-publisher.manifest.json")
    await publishManifest(getTestConfig(), outputPath, {
      ...baseOptions(),
      privateKey: kp1.privateKey,
    })

    // Trust the publisher with the correct public key
    await addTrustedPublisher(PUBLISHER_ID, kp1.publicKey)

    const result = await installManifest(outputPath)
    expect(result.config).toBeDefined()
    expect(result.warnings).toHaveLength(0)
    expect(result.manifest.metadata.name).toBe("Security Test Team")
  })

  test("loadTrustStore recovers to empty store on malformed JSON", async () => {
    const storePath = path.join(tempDir, "corrupt-store.json")
    await fs.writeFile(storePath, "{ this is not valid json at all !!!", "utf-8")
    const store = await loadTrustStore(storePath)
    expect(store.version).toBe("1.0")
    expect(store.publishers).toEqual({})
  })

  test("loadTrustStore recovers to empty store on truncated JSON", async () => {
    const storePath = path.join(tempDir, "truncated-store.json")
    await fs.writeFile(storePath, '{"version":"1.0","publishers":{"pub-1":{"pub', "utf-8")
    const store = await loadTrustStore(storePath)
    expect(store.version).toBe("1.0")
    expect(store.publishers).toEqual({})
  })

  test("TeamPublisherNotTrusted error carries the correct publisherId", async () => {
    const outputPath = path.join(tempDir, "id-check.manifest.json")
    await publishManifest(getTestConfig(), outputPath, {
      ...baseOptions(),
      privateKey: kp1.privateKey,
    })

    try {
      await installManifest(outputPath)
      expect(true).toBe(false) // must not reach
    } catch (err) {
      expect(err).toBeInstanceOf(TeamPublisherNotTrusted)
      expect((err as TeamPublisherNotTrusted).publisherId).toBe(PUBLISHER_ID)
    }
  })
})

// ---------------------------------------------------------------------------
// 4. Unsigned Manifest Safety (requireSignature / skipTrustCheck)
// ---------------------------------------------------------------------------

describe("Install Safety", () => {
  test("installManifest rejects unsigned manifest when requireSignature=true", async () => {
    const outputPath = path.join(tempDir, "unsigned-required.manifest.json")
    await publishManifest(getTestConfig(), outputPath, baseOptions())

    await expect(installManifest(outputPath, { requireSignature: true })).rejects.toThrow(TeamSignatureError)
  })

  test("installManifest throws TeamSignatureError with correct kind for unsigned+required", async () => {
    const outputPath = path.join(tempDir, "unsigned-kind.manifest.json")
    await publishManifest(getTestConfig(), outputPath, baseOptions())

    try {
      await installManifest(outputPath, { requireSignature: true })
      expect(true).toBe(false) // must not reach
    } catch (err) {
      expect(err).toBeInstanceOf(TeamSignatureError)
      expect((err as TeamSignatureError).kind).toBe("signature_error")
    }
  })

  test("installManifest warns on unsigned manifest when requireSignature=false", async () => {
    const outputPath = path.join(tempDir, "unsigned-warn.manifest.json")
    await publishManifest(getTestConfig(), outputPath, baseOptions())

    const result = await installManifest(outputPath, { requireSignature: false })
    expect(result.warnings.some((w) => w.toLowerCase().includes("unsigned"))).toBe(true)
  })

  test("installManifest warns on unsigned manifest when no options provided (default)", async () => {
    const outputPath = path.join(tempDir, "unsigned-default.manifest.json")
    await publishManifest(getTestConfig(), outputPath, baseOptions())

    const result = await installManifest(outputPath)
    expect(result.warnings).toContain("Manifest is unsigned — authenticity not verified")
  })

  test("installManifest with skipTrustCheck=true bypasses publisher trust check for signed manifests", async () => {
    const outputPath = path.join(tempDir, "skip-trust.manifest.json")
    await publishManifest(getTestConfig(), outputPath, {
      ...baseOptions(),
      privateKey: kp1.privateKey,
    })

    // Publisher NOT in trust store but skipTrustCheck skips that gate
    const result = await installManifest(outputPath, { skipTrustCheck: true })
    expect(result.config).toBeDefined()
    expect(result.warnings).toHaveLength(0)
  })

  test("installManifest validates manifest schema — rejects arbitrary JSON object", async () => {
    const badPath = path.join(tempDir, "bad-schema.json")
    await fs.writeFile(
      badPath,
      JSON.stringify({ manifestVersion: "2.0", garbage: true, no: "envelope" }),
      "utf-8",
    )
    await expect(installManifest(badPath)).rejects.toThrow(TeamManifestInvalid)
  })

  test("installManifest validates manifest schema — rejects invalid JSON", async () => {
    const badPath = path.join(tempDir, "not-json.json")
    await fs.writeFile(badPath, "THIS IS NOT JSON { broken", "utf-8")
    await expect(installManifest(badPath)).rejects.toThrow(TeamManifestInvalid)
  })

  test("installManifest rejects manifest with extra fields (strict schema)", async () => {
    const outputPath = path.join(tempDir, "signed-valid.manifest.json")
    await publishManifest(getTestConfig(), outputPath, {
      ...baseOptions(),
      privateKey: kp1.privateKey,
    })

    // Inject an extra field — TeamRegistryManifest is strict()
    const raw = JSON.parse(await fs.readFile(outputPath, "utf-8"))
    raw.__injected = "attacker controlled field"
    const injectedPath = path.join(tempDir, "injected.manifest.json")
    await fs.writeFile(injectedPath, JSON.stringify(raw), "utf-8")

    await expect(installManifest(injectedPath, { skipTrustCheck: true })).rejects.toThrow(TeamManifestInvalid)
  })
})
