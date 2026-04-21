import crypto from "crypto"
import { stableStringify } from "../checksum"
import type { TeamExportEnvelope } from "../export-envelope"
import type { TeamManifestMetadata, TeamRegistryManifest } from "./manifest"

export interface KeyPair {
  publicKey: string
  privateKey: string
}

export function generateKeyPair(): KeyPair {
  return crypto.generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  })
}

export function computeSignaturePayload(envelope: TeamExportEnvelope, metadata: TeamManifestMetadata): string {
  return stableStringify({ envelope, metadata })
}

export function signManifest(envelope: TeamExportEnvelope, metadata: TeamManifestMetadata, privateKey: string): string {
  const payload = computeSignaturePayload(envelope, metadata)
  const signature = crypto.sign(null, Buffer.from(payload), privateKey)
  return signature.toString("base64")
}

export function verifyManifestSignature(manifest: TeamRegistryManifest, publicKey: string): boolean {
  if (!manifest.signature) return false
  try {
    const payload = computeSignaturePayload(manifest.envelope, manifest.metadata)
    const signatureBuffer = Buffer.from(manifest.signature, "base64")
    return crypto.verify(null, Buffer.from(payload), publicKey, signatureBuffer)
  } catch {
    return false
  }
}

export function getPublicKeyFingerprint(publicKey: string): string {
  return crypto.createHash("sha256").update(publicKey, "utf-8").digest("hex").slice(0, 16)
}
