import { describe, it, expect } from "bun:test"
import { TeamRegistryManifest, TeamManifestMetadata, RegistryIndex } from "@/devilcode/team/registry/manifest"
import { loadQuickstartTemplates } from "@/devilcode/team/quickstarts"

const VALID_PUBLISHER_ID = "550e8400-e29b-41d4-a716-446655440000"
const NOW = new Date().toISOString()

function makeEnvelope(): Record<string, unknown> {
  const team = loadQuickstartTemplates()["solo-enhanced"].team
  return {
    version: "1.1.0",
    checksum: "a".repeat(64),
    config: team,
    exportedAt: NOW,
  }
}

function makeMetadata(): Record<string, unknown> {
  return {
    name: "My Test Team",
    author: "Test Author",
    publisherId: VALID_PUBLISHER_ID,
    version: "1.0.0",
    publishedAt: NOW,
  }
}

function makeManifest(): Record<string, unknown> {
  return {
    manifestVersion: "1.0",
    envelope: makeEnvelope(),
    metadata: makeMetadata(),
  }
}

// --- TeamManifestMetadata ---

describe("TeamManifestMetadata", () => {
  it("accepts valid metadata with required fields only", () => {
    const parsed = TeamManifestMetadata.parse(makeMetadata())
    expect(parsed.name).toBe("My Test Team")
    expect(parsed.author).toBe("Test Author")
    expect(parsed.publisherId).toBe(VALID_PUBLISHER_ID)
    expect(parsed.version).toBe("1.0.0")
    expect(parsed.license).toBeUndefined()
    expect(parsed.description).toBeUndefined()
    expect(parsed.tags).toBeUndefined()
  })

  it("accepts all optional fields", () => {
    const parsed = TeamManifestMetadata.parse({
      ...makeMetadata(),
      license: "MIT",
      description: "A test team",
      tags: ["testing", "example"],
      homepage: "https://example.com",
      repository: "https://github.com/example/repo",
    })
    expect(parsed.license).toBe("MIT")
    expect(parsed.description).toBe("A test team")
    expect(parsed.tags).toEqual(["testing", "example"])
    expect(parsed.homepage).toBe("https://example.com")
    expect(parsed.repository).toBe("https://github.com/example/repo")
  })

  it("rejects unknown fields (strict)", () => {
    expect(() => TeamManifestMetadata.parse({ ...makeMetadata(), unknownField: "oops" })).toThrow()
  })

  it("rejects invalid publisherId (not UUID)", () => {
    expect(() => TeamManifestMetadata.parse({ ...makeMetadata(), publisherId: "not-a-uuid" })).toThrow()
  })

  it("rejects invalid version (not semver)", () => {
    expect(() => TeamManifestMetadata.parse({ ...makeMetadata(), version: "v1.0.0" })).toThrow()
    expect(() => TeamManifestMetadata.parse({ ...makeMetadata(), version: "1.0" })).toThrow()
    expect(() => TeamManifestMetadata.parse({ ...makeMetadata(), version: "latest" })).toThrow()
  })

  it("rejects invalid publishedAt (not ISO datetime)", () => {
    expect(() => TeamManifestMetadata.parse({ ...makeMetadata(), publishedAt: "yesterday" })).toThrow()
  })

  it("rejects invalid homepage URL", () => {
    expect(() => TeamManifestMetadata.parse({ ...makeMetadata(), homepage: "not-a-url" })).toThrow()
  })

  it("rejects missing required fields", () => {
    const { name, ...rest } = makeMetadata()
    void name
    expect(() => TeamManifestMetadata.parse(rest)).toThrow()
  })
})

// --- TeamRegistryManifest ---

describe("TeamRegistryManifest", () => {
  it("accepts a valid manifest without signature", () => {
    const parsed = TeamRegistryManifest.parse(makeManifest())
    expect(parsed.manifestVersion).toBe("1.0")
    expect(parsed.signature).toBeUndefined()
  })

  it("accepts optional signature", () => {
    const parsed = TeamRegistryManifest.parse({ ...makeManifest(), signature: "base64sighere==" })
    expect(parsed.signature).toBe("base64sighere==")
  })

  it("rejects wrong manifestVersion literal", () => {
    expect(() => TeamRegistryManifest.parse({ ...makeManifest(), manifestVersion: "2.0" })).toThrow()
  })

  it("rejects unknown top-level keys (strict)", () => {
    expect(() => TeamRegistryManifest.parse({ ...makeManifest(), extraField: true })).toThrow()
  })

  it("rejects missing envelope", () => {
    const { envelope, ...rest } = makeManifest()
    void envelope
    expect(() => TeamRegistryManifest.parse(rest)).toThrow()
  })

  it("rejects missing metadata", () => {
    const { metadata, ...rest } = makeManifest()
    void metadata
    expect(() => TeamRegistryManifest.parse(rest)).toThrow()
  })

  it("rejects invalid nested envelope (strict propagation)", () => {
    expect(() =>
      TeamRegistryManifest.parse({
        ...makeManifest(),
        envelope: { ...makeEnvelope(), badField: "oops" },
      }),
    ).toThrow()
  })
})

// --- RegistryIndex ---

describe("RegistryIndex", () => {
  it("accepts valid index with empty manifests array", () => {
    const parsed = RegistryIndex.parse({ version: "1.0", updatedAt: NOW, manifests: [] })
    expect(parsed.version).toBe("1.0")
    expect(parsed.manifests).toHaveLength(0)
  })

  it("accepts index with manifests", () => {
    const parsed = RegistryIndex.parse({
      version: "1.0",
      updatedAt: NOW,
      manifests: [makeManifest()],
    })
    expect(parsed.manifests).toHaveLength(1)
    expect(parsed.manifests[0]!.manifestVersion).toBe("1.0")
  })

  it("rejects wrong version literal", () => {
    expect(() => RegistryIndex.parse({ version: "2.0", updatedAt: NOW, manifests: [] })).toThrow()
  })

  it("rejects unknown fields (strict)", () => {
    expect(() =>
      RegistryIndex.parse({ version: "1.0", updatedAt: NOW, manifests: [], extra: "no" }),
    ).toThrow()
  })

  it("rejects non-ISO updatedAt", () => {
    expect(() => RegistryIndex.parse({ version: "1.0", updatedAt: "not-a-date", manifests: [] })).toThrow()
  })

  it("rejects invalid manifest inside the array", () => {
    expect(() =>
      RegistryIndex.parse({
        version: "1.0",
        updatedAt: NOW,
        manifests: [{ manifestVersion: "1.0", metadata: makeMetadata() }],
      }),
    ).toThrow()
  })
})
