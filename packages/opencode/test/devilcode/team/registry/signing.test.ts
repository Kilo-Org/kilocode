import { describe, it, expect } from "bun:test"
import {
  generateKeyPair,
  signManifest,
  verifyManifestSignature,
  getPublicKeyFingerprint,
  computeSignaturePayload,
} from "@/devilcode/team/registry/signing"
import type { TeamRegistryManifest } from "@/devilcode/team/registry/manifest"
import { loadQuickstartTemplates } from "@/devilcode/team/quickstarts"

const NOW = new Date().toISOString()
const PUBLISHER_ID = "550e8400-e29b-41d4-a716-446655440000"

function makeEnvelope() {
  const team = loadQuickstartTemplates()["solo-enhanced"].team
  return {
    version: "1.1.0" as const,
    checksum: "a".repeat(64),
    config: team,
    exportedAt: NOW,
  }
}

function makeMetadata() {
  return {
    name: "Signing Test Team",
    author: "Tester",
    publisherId: PUBLISHER_ID,
    version: "1.0.0",
    publishedAt: NOW,
  }
}

describe("generateKeyPair", () => {
  it("produces PEM-encoded public and private keys", () => {
    const { publicKey, privateKey } = generateKeyPair()
    expect(publicKey).toMatch(/^-----BEGIN PUBLIC KEY-----/)
    expect(privateKey).toMatch(/^-----BEGIN PRIVATE KEY-----/)
  })

  it("generates unique key pairs each time", () => {
    const kp1 = generateKeyPair()
    const kp2 = generateKeyPair()
    expect(kp1.publicKey).not.toBe(kp2.publicKey)
    expect(kp1.privateKey).not.toBe(kp2.privateKey)
  })
})

describe("signManifest + verifyManifestSignature (round-trip)", () => {
  it("sign → verify succeeds with matching key pair", () => {
    const { publicKey, privateKey } = generateKeyPair()
    const envelope = makeEnvelope()
    const metadata = makeMetadata()
    const signature = signManifest(envelope, metadata, privateKey)
    expect(typeof signature).toBe("string")
    expect(signature.length).toBeGreaterThan(0)

    const manifest: TeamRegistryManifest = {
      manifestVersion: "1.0",
      envelope,
      metadata,
      signature,
    }
    expect(verifyManifestSignature(manifest, publicKey)).toBe(true)
  })

  it("returns false for tampered signature", () => {
    const { publicKey, privateKey } = generateKeyPair()
    const envelope = makeEnvelope()
    const metadata = makeMetadata()
    const signature = signManifest(envelope, metadata, privateKey)

    // Corrupt the signature by replacing a character
    const tampered = signature.slice(0, -4) + "XXXX"
    const manifest: TeamRegistryManifest = {
      manifestVersion: "1.0",
      envelope,
      metadata,
      signature: tampered,
    }
    expect(verifyManifestSignature(manifest, publicKey)).toBe(false)
  })

  it("returns false with a different (wrong) public key", () => {
    const { privateKey } = generateKeyPair()
    const { publicKey: wrongPublicKey } = generateKeyPair()
    const envelope = makeEnvelope()
    const metadata = makeMetadata()
    const signature = signManifest(envelope, metadata, privateKey)

    const manifest: TeamRegistryManifest = {
      manifestVersion: "1.0",
      envelope,
      metadata,
      signature,
    }
    expect(verifyManifestSignature(manifest, wrongPublicKey)).toBe(false)
  })

  it("returns false when manifest has no signature field", () => {
    const { publicKey } = generateKeyPair()
    const manifest: TeamRegistryManifest = {
      manifestVersion: "1.0",
      envelope: makeEnvelope(),
      metadata: makeMetadata(),
    }
    expect(verifyManifestSignature(manifest, publicKey)).toBe(false)
  })
})

describe("verifyManifestSignature — invalid inputs", () => {
  it("returns false (does not throw) on invalid public key format", () => {
    const { privateKey } = generateKeyPair()
    const envelope = makeEnvelope()
    const metadata = makeMetadata()
    const signature = signManifest(envelope, metadata, privateKey)

    const manifest: TeamRegistryManifest = {
      manifestVersion: "1.0",
      envelope,
      metadata,
      signature,
    }
    expect(() => verifyManifestSignature(manifest, "not-a-pem-key")).not.toThrow()
    expect(verifyManifestSignature(manifest, "not-a-pem-key")).toBe(false)
  })

  it("returns false on empty string public key", () => {
    const { privateKey } = generateKeyPair()
    const signature = signManifest(makeEnvelope(), makeMetadata(), privateKey)
    const manifest: TeamRegistryManifest = {
      manifestVersion: "1.0",
      envelope: makeEnvelope(),
      metadata: makeMetadata(),
      signature,
    }
    expect(verifyManifestSignature(manifest, "")).toBe(false)
  })
})

describe("getPublicKeyFingerprint", () => {
  it("returns a 16-character hex string", () => {
    const { publicKey } = generateKeyPair()
    const fingerprint = getPublicKeyFingerprint(publicKey)
    expect(fingerprint).toHaveLength(16)
    expect(fingerprint).toMatch(/^[a-f0-9]{16}$/)
  })

  it("is stable — same key always yields same fingerprint", () => {
    const { publicKey } = generateKeyPair()
    expect(getPublicKeyFingerprint(publicKey)).toBe(getPublicKeyFingerprint(publicKey))
  })

  it("different keys produce different fingerprints", () => {
    const { publicKey: pk1 } = generateKeyPair()
    const { publicKey: pk2 } = generateKeyPair()
    expect(getPublicKeyFingerprint(pk1)).not.toBe(getPublicKeyFingerprint(pk2))
  })
})

describe("computeSignaturePayload", () => {
  it("returns a non-empty string", () => {
    const payload = computeSignaturePayload(makeEnvelope(), makeMetadata())
    expect(typeof payload).toBe("string")
    expect(payload.length).toBeGreaterThan(0)
  })

  it("is deterministic for the same inputs", () => {
    const envelope = makeEnvelope()
    const metadata = makeMetadata()
    expect(computeSignaturePayload(envelope, metadata)).toBe(computeSignaturePayload(envelope, metadata))
  })
})
