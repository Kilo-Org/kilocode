import fs from "fs/promises"
import path from "path"
import { TeamRegistryManifest, TeamManifestMetadata, type TeamRegistryManifest as TeamRegistryManifestType } from "./manifest"
import { TeamManifestFetchFailed, TeamManifestInvalid, TeamPublisherNotTrusted, TeamSignatureError } from "./errors"
import { signManifest, verifyManifestSignature } from "./signing"
import { fetchManifest } from "./http-client"
import { getTrustedPublisher } from "./trust-store"
import { computeTeamChecksum } from "../checksum"
import type { CanonicalTeamConfig } from "../config"
import { CURRENT_TEAM_CONFIG_VERSION } from "../versioning"

export interface PublishOptions {
  name: string
  author: string
  publisherId: string
  version: string
  license?: string
  description?: string
  tags?: string[]
  homepage?: string
  repository?: string
  privateKey?: string // If provided, sign the manifest
}

export async function publishManifest(
  config: CanonicalTeamConfig,
  outputPath: string,
  options: PublishOptions,
): Promise<TeamRegistryManifestType> {
  const checksum = computeTeamChecksum(config)
  const envelope = {
    version: CURRENT_TEAM_CONFIG_VERSION,
    config,
    checksum,
    exportedAt: new Date().toISOString(),
  }

  const metadata = TeamManifestMetadata.parse({
    name: options.name,
    author: options.author,
    publisherId: options.publisherId,
    version: options.version,
    license: options.license,
    description: options.description,
    tags: options.tags,
    publishedAt: new Date().toISOString(),
    homepage: options.homepage,
    repository: options.repository,
  })

  const signature = options.privateKey ? signManifest(envelope as any, metadata, options.privateKey) : undefined

  const manifest: TeamRegistryManifestType = {
    manifestVersion: "1.0",
    envelope: envelope as any,
    metadata,
    ...(signature !== undefined ? { signature } : {}),
  }

  // Validate the assembled manifest before writing
  TeamRegistryManifest.parse(manifest)

  await fs.mkdir(path.dirname(path.resolve(outputPath)), { recursive: true })
  await fs.writeFile(path.resolve(outputPath), JSON.stringify(manifest, null, 2) + "\n", "utf-8")

  return manifest
}

export interface InstallOptions {
  requireSignature?: boolean
  skipTrustCheck?: boolean
}

export async function installManifest(
  source: string,
  options?: InstallOptions,
): Promise<{ config: CanonicalTeamConfig; manifest: TeamRegistryManifestType; warnings: string[] }> {
  const warnings: string[] = []

  // Detect URL vs file path
  const isUrl = source.startsWith("http://") || source.startsWith("https://")

  let raw: unknown
  if (isUrl) {
    try {
      raw = await fetchManifest<unknown>(source)
    } catch (err) {
      if (err instanceof TeamManifestFetchFailed) throw err
      throw new TeamManifestFetchFailed({ url: source, message: err instanceof Error ? err.message : String(err) })
    }
  } else {
    let text: string
    try {
      text = await fs.readFile(source, "utf-8")
    } catch (err) {
      throw new TeamManifestFetchFailed({ url: source, message: err instanceof Error ? err.message : String(err) })
    }
    try {
      raw = JSON.parse(text)
    } catch (err) {
      throw new TeamManifestInvalid({ issues: ["Invalid JSON"], source, message: `Manifest at "${source}" is not valid JSON` })
    }
  }

  const parseResult = TeamRegistryManifest.safeParse(raw)
  if (!parseResult.success) {
    throw new TeamManifestInvalid({
      issues: parseResult.error.issues.map((i) => i.message),
      source,
      message: `Manifest from "${source}" failed schema validation`,
    })
  }

  const manifest = parseResult.data

  if (manifest.signature) {
    if (!options?.skipTrustCheck) {
      const trusted = await getTrustedPublisher(manifest.metadata.publisherId)
      if (!trusted) {
        throw new TeamPublisherNotTrusted(manifest.metadata.publisherId)
      }
      const valid = verifyManifestSignature(manifest, trusted.publicKey)
      if (!valid) {
        throw new TeamSignatureError("Manifest signature verification failed")
      }
    }
  } else {
    if (options?.requireSignature) {
      throw new TeamSignatureError("Manifest is unsigned but signature required")
    } else {
      warnings.push("Manifest is unsigned — authenticity not verified")
    }
  }

  return { config: manifest.envelope.config, manifest, warnings }
}
