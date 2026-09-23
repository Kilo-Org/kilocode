import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Artifact, Deps, Manifest, Policy, Scan, compose, dedupe, serial, validate } from "./sbom/index"
import type { Component } from "./sbom/index"

const DIGEST = "a".repeat(64)

function bom(overrides: Partial<Parameters<typeof compose>[0]> = {}) {
  return compose({
    subject: { name: "kilo-linux-x64.tar.gz", sha256: DIGEST, size: 10 },
    product: { name: "kilo-cli", version: "7.7.9" },
    ...overrides,
  })
}

async function scratch() {
  return fs.promises.mkdtemp(path.join(os.tmpdir(), "kilo-sbom-test-"))
}

describe("compose", () => {
  test("produces a valid CycloneDX 1.6 document for an artifact with no dependencies", () => {
    const document = bom()
    expect(document.bomFormat).toBe("CycloneDX")
    expect(document.specVersion).toBe("1.6")
    expect(validate(document)).toEqual([])
  })

  test("binds the document to the exact artifact digest", () => {
    const document = bom()
    expect(document.metadata.component).toMatchObject({ hashes: [{ alg: "SHA-256", content: DIGEST }] })
    const properties = document.metadata.properties as { name: string; value: string }[]
    expect(properties).toContainEqual({ name: "kilocode:subject:name", value: "kilo-linux-x64.tar.gz" })
    expect(properties).toContainEqual({ name: "kilocode:subject:sha256", value: DIGEST })
  })

  test("derives a deterministic serial number from the subject digest", () => {
    expect(bom().serialNumber).toBe(bom().serialNumber)
    expect(serial(DIGEST)).not.toBe(serial("b".repeat(64)))
    expect(serial(DIGEST)).toMatch(/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  test("honours SOURCE_DATE_EPOCH so reproducible builds stay reproducible", () => {
    const previous = process.env.SOURCE_DATE_EPOCH
    process.env.SOURCE_DATE_EPOCH = "1700000000"
    try {
      expect(bom().metadata.timestamp).toBe("2023-11-14T22:13:20.000Z")
    } finally {
      if (previous == null) delete process.env.SOURCE_DATE_EPOCH
      else process.env.SOURCE_DATE_EPOCH = previous
    }
  })

  test("records target and build provenance", () => {
    const document = bom({
      target: { platform: "linux-x64", os: "linux", arch: "x64", abi: "musl", baseline: true },
      build: { commit: "c".repeat(40), channel: "latest", properties: { "build:tag": "jetbrains/v1.2.3" } },
    })
    const properties = document.metadata.properties as { name: string; value: string }[]
    expect(properties).toContainEqual({ name: "kilocode:target:abi", value: "musl" })
    expect(properties).toContainEqual({ name: "kilocode:target:baseline", value: "true" })
    expect(properties).toContainEqual({ name: "kilocode:build:commit", value: "c".repeat(40) })
    expect(properties).toContainEqual({ name: "kilocode:build:tag", value: "jetbrains/v1.2.3" })
  })

  test("maps delivery onto CycloneDX scope so host-provided code is not claimed as shipped", () => {
    const document = bom({
      components: [
        { type: "library", name: "okhttp", version: "4.12.0", purl: "pkg:maven/okhttp@4.12.0", delivery: "contained" },
        { type: "framework", name: "intellij", version: "2026.1", delivery: "provided" },
        { type: "application", name: "ripgrep", version: "15.1.0", delivery: "runtime" },
      ],
    })
    const scopes = Object.fromEntries(document.components.map((item: any) => [item.name, item.scope]))
    expect(scopes).toEqual({ okhttp: "required", intellij: "excluded", ripgrep: "optional" })
    expect(validate(document)).toEqual([])
  })

  test("records coverage gaps instead of silently omitting unknown data", () => {
    const document = bom({ gaps: [{ component: "syft", reason: "not installed" }] })
    expect(document.metadata.properties).toContainEqual({
      name: "kilocode:coverage:gap:syft",
      value: "not installed",
    })
  })

  test("attaches unparented components to the artifact root", () => {
    const document = bom({
      components: [
        { type: "library", name: "a", version: "1", purl: "pkg:npm/a@1" },
        { type: "library", name: "b", version: "1", purl: "pkg:npm/b@1" },
      ],
      dependencies: { "pkg:npm/a@1": ["pkg:npm/b@1"] },
    })
    const root = document.dependencies.find((item) => item.ref.startsWith("kilocode:artifact:"))
    expect(root?.dependsOn).toEqual(["pkg:npm/a@1"])
    expect(document.dependencies.find((item) => item.ref === "pkg:npm/a@1")?.dependsOn).toEqual(["pkg:npm/b@1"])
    expect(validate(document)).toEqual([])
  })

  test("drops dependency edges whose endpoints were filtered out", () => {
    const document = bom({
      components: [{ type: "library", name: "a", version: "1", purl: "pkg:npm/a@1" }],
      dependencies: { "pkg:npm/a@1": ["pkg:npm/removed@1"], "pkg:npm/ghost@1": ["pkg:npm/a@1"] },
    })
    expect(document.dependencies.map((item) => item.ref)).not.toContain("pkg:npm/ghost@1")
    expect(document.dependencies.flatMap((item) => item.dependsOn)).not.toContain("pkg:npm/removed@1")
    expect(validate(document)).toEqual([])
  })
})

describe("dedupe", () => {
  test("merges the same package reported by several generators", () => {
    const merged = dedupe([
      { type: "library", name: "diff", version: "8.0.4", purl: "pkg:npm/diff@8.0.4", licenses: ["BSD-3-Clause"] },
      {
        type: "library",
        name: "diff",
        version: "8.0.4",
        purl: "pkg:npm/diff@8.0.4",
        properties: { source: "syft" },
        hashes: [{ alg: "SHA-256", content: "b".repeat(64) }],
      },
    ])
    expect(merged).toHaveLength(1)
    expect(merged[0].licenses).toEqual(["BSD-3-Clause"])
    expect(merged[0].properties).toEqual({ source: "syft" })
    expect(merged[0].hashes).toHaveLength(1)
  })

  test("keeps different versions of the same package apart", () => {
    const merged = dedupe([
      { type: "library", name: "diff", version: "8.0.4", purl: "pkg:npm/diff@8.0.4" },
      { type: "library", name: "diff", version: "9.0.0", purl: "pkg:npm/diff@9.0.0" },
    ])
    expect(merged).toHaveLength(2)
  })

  test("resolves a contained-versus-runtime conflict to contained, in either order", () => {
    const contained = {
      type: "application" as const,
      name: "kilo",
      version: "7.7.9",
      ref: "kilo",
      delivery: "contained" as const,
    }
    const runtime = { ...contained, delivery: "runtime" as const }
    expect(dedupe([contained, runtime])).toEqual([expect.objectContaining({ delivery: "contained" })])
    expect(dedupe([runtime, contained])).toEqual([expect.objectContaining({ delivery: "contained" })])
  })

  test("resolves a runtime-versus-provided conflict to runtime", () => {
    const provided = {
      type: "library" as const,
      name: "x",
      version: "1",
      purl: "pkg:npm/x@1",
      delivery: "provided" as const,
    }
    expect(dedupe([provided, { ...provided, delivery: "runtime" }])).toEqual([
      expect.objectContaining({ delivery: "runtime" }),
    ])
  })

  test("keeps delivery out of the ref so dependency edges stay resolvable", () => {
    const document = bom({
      components: [
        { type: "application", name: "cli", version: "1", ref: "cli", delivery: "runtime" },
        { type: "library", name: "dep", version: "1", purl: "pkg:npm/dep@1", delivery: "runtime" },
      ],
      dependencies: { cli: ["pkg:npm/dep@1"] },
    })
    expect(validate(document)).toEqual([])
    const root = document.dependencies.find((item) => item.ref.startsWith("kilocode:artifact:"))
    expect(root?.dependsOn).toEqual(["cli"])
    expect(document.dependencies.find((item) => item.ref === "cli")?.dependsOn).toEqual(["pkg:npm/dep@1"])
  })
})

describe("validate", () => {
  test("rejects a document that does not identify its artifact", () => {
    const document = bom()
    document.metadata.properties = []
    expect(validate(document)).toEqual(expect.arrayContaining([expect.stringContaining("kilocode:subject:name")]))
  })

  test("rejects a digest that disagrees with the root component hash", () => {
    const document = bom()
    ;(document.metadata.component as any).hashes = [{ alg: "SHA-256", content: "b".repeat(64) }]
    expect(validate(document)).toEqual(
      expect.arrayContaining([expect.stringContaining("does not match subject digest")]),
    )
  })

  test("rejects a non-reproducible serial number", () => {
    const document = bom()
    document.serialNumber = "urn:uuid:00000000-0000-5000-8000-000000000000"
    expect(validate(document)).toEqual(
      expect.arrayContaining([expect.stringContaining("not derived from the subject digest")]),
    )
  })

  test("rejects dangling dependency references", () => {
    const document = bom({ components: [{ type: "library", name: "a", version: "1", purl: "pkg:npm/a@1" }] })
    document.dependencies.push({ ref: "pkg:npm/a@1", dependsOn: ["pkg:npm/missing@1"] })
    expect(validate(document)).toEqual(
      expect.arrayContaining([expect.stringContaining("does not resolve to a component")]),
    )
  })

  test("rejects a library without a version", () => {
    const document = bom({ components: [{ type: "library", name: "mystery" }] })
    expect(validate(document)).toEqual(expect.arrayContaining([expect.stringContaining("requires a version")]))
  })

  test("rejects a provided component that claims to be shipped", () => {
    const document = bom({
      components: [{ type: "framework", name: "intellij", version: "2026.1", delivery: "provided" }],
    })
    ;(document.components[0] as any).scope = "required"
    expect(validate(document)).toEqual(expect.arrayContaining([expect.stringContaining("host-provided")]))
  })

  test("rejects malformed input rather than throwing", () => {
    expect(validate(null)).toEqual(["SBOM is not an object"])
    expect(validate({ bomFormat: "SPDX" })).toEqual(expect.arrayContaining([expect.stringContaining("bomFormat")]))
  })
})

describe("reconcile", () => {
  test("resolves a sibling across two independently-enriched batches", async () => {
    // Reproduces the JetBrains shape: each platform's closure is enriched
    // separately (a package's own platform variant is never in another
    // platform's closure at all, so `enrich`'s own internal reconciliation
    // sees nothing to borrow from). Only a second pass across the merged
    // result can resolve it.
    const darwin = await scratch()
    const linux = await scratch()
    try {
      await Bun.write(
        path.join(darwin, "@opentui", "core-darwin-arm64", "package.json"),
        JSON.stringify({ license: "MIT" }),
      )
      const a = await Deps.enrich(
        [
          {
            type: "library",
            name: "@opentui/core-darwin-arm64",
            version: "0.5.11",
            purl: "pkg:npm/%40opentui/core-darwin-arm64@0.5.11",
          },
        ],
        darwin,
      )
      const b = await Deps.enrich(
        [
          {
            type: "library",
            name: "@opentui/core-linux-x64",
            version: "0.5.11",
            purl: "pkg:npm/%40opentui/core-linux-x64@0.5.11",
          },
        ],
        linux,
      )
      expect(b.components[0].licenses).toBeUndefined()

      const merged = Deps.reconcile([...a.components, ...b.components], [...a.gaps, ...b.gaps])
      expect(merged.components.find((item) => item.name === "@opentui/core-linux-x64")?.licenses).toEqual(["MIT"])
      expect(merged.gaps).toEqual([])
    } finally {
      await fs.promises.rm(darwin, { recursive: true, force: true })
      await fs.promises.rm(linux, { recursive: true, force: true })
    }
  })
})

describe("deps", () => {
  const lock: Deps.Lock = {
    lockfileVersion: 1,
    workspaces: {
      "": { name: "root" },
      "packages/app": {
        name: "@kilo/app",
        version: "1.0.0",
        dependencies: { shipped: "1.0.0", "@kilo/lib": "workspace:*" },
        devDependencies: { tooling: "1.0.0" },
        optionalDependencies: { "native-linux": "1.0.0", "native-darwin": "1.0.0" },
      },
      "packages/lib": { name: "@kilo/lib", version: "2.0.0", dependencies: { nested: "1.0.0" } },
    },
    packages: {
      shipped: ["shipped@1.0.0", "", { dependencies: { transitive: "1.0.0" } }, "sha512-shipped"],
      transitive: ["transitive@1.0.0", "", {}, "sha512-transitive"],
      "shipped/transitive": ["transitive@2.0.0", "", {}, "sha512-nested-transitive"],
      nested: ["nested@1.0.0", "", {}, "sha512-nested"],
      tooling: ["tooling@1.0.0", "", {}, "sha512-tooling"],
      "native-linux": ["native-linux@1.0.0", "", { os: ["linux"], cpu: ["x64"] }, "sha512-native-linux"],
      "native-darwin": ["native-darwin@1.0.0", "", { os: ["darwin"] }, "sha512-native-darwin"],
      "@kilo/lib": ["@kilo/lib@workspace:packages/lib"],
    },
  }

  test("splits scoped lockfile keys into node_modules segments", () => {
    expect(Deps.segments("a/@scope/b/c")).toEqual(["a", "@scope/b", "c"])
    expect(Deps.segments("@scope/b")).toEqual(["@scope/b"])
  })

  test("includes shipped dependencies and excludes dev dependencies", () => {
    const result = Deps.closure({ lock, workspace: "packages/app" })
    const names = result.components.map((item) => item.name)
    expect(names).toContain("shipped")
    expect(names).not.toContain("tooling")
  })

  test("prefers the nested copy of a transitive dependency", () => {
    const result = Deps.closure({ lock, workspace: "packages/app" })
    const versions = result.components.filter((item) => item.name === "transitive").map((item) => item.version)
    expect(versions).toEqual(["2.0.0"])
  })

  test("records workspace packages as first-party without inventing npm purls", () => {
    const result = Deps.closure({ lock, workspace: "packages/app" })
    const workspace = result.components.find((item) => item.name === "@kilo/lib")
    expect(workspace).toMatchObject({ version: "2.0.0", supplier: "Kilo Code", properties: { origin: "workspace" } })
    expect(workspace?.purl).toBeUndefined()
    expect(result.components.map((item) => item.name)).toContain("nested")
  })

  test("keeps only the optional native packages for the target platform", () => {
    const linux = Deps.closure({ lock, workspace: "packages/app", platform: { os: "linux", arch: "x64" } })
    expect(linux.components.map((item) => item.name)).toContain("native-linux")
    expect(linux.components.map((item) => item.name)).not.toContain("native-darwin")

    const darwin = Deps.closure({ lock, workspace: "packages/app", platform: { os: "darwin", arch: "arm64" } })
    expect(darwin.components.map((item) => item.name)).toContain("native-darwin")
    expect(darwin.components.map((item) => item.name)).not.toContain("native-linux")
  })

  test("carries the lockfile integrity hash into the component", () => {
    const result = Deps.closure({ lock, workspace: "packages/app" })
    expect(result.components.find((item) => item.name === "shipped")?.properties).toMatchObject({
      integrity: "sha512-shipped",
    })
  })

  test("reports unresolvable dependencies as gaps", () => {
    const broken: Deps.Lock = {
      ...lock,
      workspaces: { ...lock.workspaces, "packages/app": { name: "@kilo/app", dependencies: { ghost: "1.0.0" } } },
    }
    const result = Deps.closure({ lock: broken, workspace: "packages/app" })
    expect(result.gaps).toEqual([{ component: "ghost", reason: "not resolvable from <root> in bun.lock" }])
  })

  test("composes into a valid document", () => {
    const result = Deps.closure({ lock, workspace: "packages/app", platform: { os: "linux", arch: "x64" } })
    const document = bom({ components: result.components, dependencies: result.dependencies, gaps: result.gaps })
    expect(validate(document)).toEqual([])
  })

  test("reads the repository lockfile and resolves the CLI workspace", async () => {
    const parsed = await Deps.load(path.join(import.meta.dir, "..", "..", "bun.lock"))
    const result = Deps.closure({
      lock: parsed,
      workspace: "packages/opencode",
      platform: { os: "linux", arch: "x64" },
    })
    expect(result.components.length).toBeGreaterThan(50)
    expect(result.components.every((item) => item.version)).toBe(true)
    const document = bom({ components: result.components, dependencies: result.dependencies, gaps: result.gaps })
    expect(validate(document)).toEqual([])
  })

  test("enriches licences from the installed tree and reports unknown ones", async () => {
    const dir = await scratch()
    try {
      await Bun.write(path.join(dir, "known", "package.json"), JSON.stringify({ license: "MIT", description: "d" }))
      const input: Component[] = [
        { type: "library", name: "known", version: "1.0.0", purl: "pkg:npm/known@1.0.0" },
        { type: "library", name: "absent", version: "1.0.0", purl: "pkg:npm/absent@1.0.0" },
      ]
      const result = await Deps.enrich(input, dir)
      expect(result.components[0]).toMatchObject({ licenses: ["MIT"], description: "d" })
      expect(result.gaps).toEqual([
        { component: "absent@1.0.0", reason: "licence unknown: package not installed locally" },
      ])
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true })
    }
  })

  test("falls back to Bun's isolated-linker store for transitive dependencies", async () => {
    const dir = await scratch()
    try {
      // No flat `<root>/cors` symlink -- only the shared store entry Bun's
      // default (non-Windows) install produces for a transitive dependency.
      await Bun.write(
        path.join(dir, ".bun", "cors@2.8.6", "node_modules", "cors", "package.json"),
        JSON.stringify({ license: "MIT" }),
      )
      const input: Component[] = [{ type: "library", name: "cors", version: "2.8.6", purl: "pkg:npm/cors@2.8.6" }]
      const result = await Deps.enrich(input, dir)
      expect(result.components[0]).toMatchObject({ licenses: ["MIT"] })
      expect(result.gaps).toEqual([])
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true })
    }
  })

  test("matches a peer-variant hash suffix in the isolated store", async () => {
    const dir = await scratch()
    try {
      await Bun.write(
        path.join(dir, ".bun", "oxlint@1.60.0+6c6101fa9d9a1fb4", "node_modules", "oxlint", "package.json"),
        JSON.stringify({ license: "MIT" }),
      )
      const input: Component[] = [{ type: "library", name: "oxlint", version: "1.60.0", purl: "pkg:npm/oxlint@1.60.0" }]
      const result = await Deps.enrich(input, dir)
      expect(result.components[0]).toMatchObject({ licenses: ["MIT"] })
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true })
    }
  })

  test("resolves a scoped package's store directory name from its scope slash", async () => {
    const dir = await scratch()
    try {
      await Bun.write(
        path.join(dir, ".bun", "@actions+core@1.11.1", "node_modules", "@actions", "core", "package.json"),
        JSON.stringify({ license: "MIT" }),
      )
      const input: Component[] = [
        { type: "library", name: "@actions/core", version: "1.11.1", purl: "pkg:npm/%40actions/core@1.11.1" },
      ]
      const result = await Deps.enrich(input, dir)
      expect(result.components[0]).toMatchObject({ licenses: ["MIT"] })
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true })
    }
  })

  test("prefers a flat symlink over the isolated store when both exist", async () => {
    const dir = await scratch()
    try {
      await Bun.write(path.join(dir, "effect", "package.json"), JSON.stringify({ license: "MIT" }))
      await Bun.write(
        path.join(dir, ".bun", "effect@4.0.0", "node_modules", "effect", "package.json"),
        JSON.stringify({ license: "Apache-2.0" }),
      )
      const input: Component[] = [{ type: "library", name: "effect", version: "4.0.0", purl: "pkg:npm/effect@4.0.0" }]
      const result = await Deps.enrich(input, dir)
      expect(result.components[0]).toMatchObject({ licenses: ["MIT"] })
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true })
    }
  })

  test("still reports a gap when neither the flat symlink nor the store has the package", async () => {
    const dir = await scratch()
    try {
      const input: Component[] = [{ type: "library", name: "missing", version: "1.0.0", purl: "pkg:npm/missing@1.0.0" }]
      const result = await Deps.enrich(input, dir)
      expect(result.gaps).toEqual([
        { component: "missing@1.0.0", reason: "licence unknown: package not installed locally" },
      ])
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true })
    }
  })

  test("borrows a licence from a resolved sibling platform package of the same family and version", async () => {
    const dir = await scratch()
    try {
      // Only the host's own platform variant is installed -- the situation
      // when one runner composes closures for every shipped target, as the
      // JetBrains plugin does for all six CLI platforms.
      await Bun.write(
        path.join(dir, "@opentui", "core-darwin-arm64", "package.json"),
        JSON.stringify({ license: "MIT" }),
      )
      const input: Component[] = [
        {
          type: "library",
          name: "@opentui/core-darwin-arm64",
          version: "0.5.11",
          purl: "pkg:npm/%40opentui/core-darwin-arm64@0.5.11",
        },
        {
          type: "library",
          name: "@opentui/core-linux-x64",
          version: "0.5.11",
          purl: "pkg:npm/%40opentui/core-linux-x64@0.5.11",
        },
        {
          type: "library",
          name: "@opentui/core-win32-arm64",
          version: "0.5.11",
          purl: "pkg:npm/%40opentui/core-win32-arm64@0.5.11",
        },
      ]
      const result = await Deps.enrich(input, dir)
      expect(result.components.map((item) => item.licenses)).toEqual([["MIT"], ["MIT"], ["MIT"]])
      expect(result.gaps).toEqual([])
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true })
    }
  })

  test("does not borrow across a version mismatch", async () => {
    const dir = await scratch()
    try {
      await Bun.write(
        path.join(dir, "@opentui", "core-darwin-arm64", "package.json"),
        JSON.stringify({ license: "MIT" }),
      )
      const input: Component[] = [
        {
          type: "library",
          name: "@opentui/core-darwin-arm64",
          version: "0.5.11",
          purl: "pkg:npm/%40opentui/core-darwin-arm64@0.5.11",
        },
        {
          type: "library",
          name: "@opentui/core-linux-x64",
          version: "0.6.0",
          purl: "pkg:npm/%40opentui/core-linux-x64@0.6.0",
        },
      ]
      const result = await Deps.enrich(input, dir)
      expect(result.gaps).toEqual([
        { component: "@opentui/core-linux-x64@0.6.0", reason: "licence unknown: package not installed locally" },
      ])
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true })
    }
  })

  test("does not borrow across a different package family", async () => {
    const dir = await scratch()
    try {
      await Bun.write(path.join(dir, "cors", "package.json"), JSON.stringify({ license: "MIT" }))
      const input: Component[] = [
        { type: "library", name: "cors", version: "2.8.6", purl: "pkg:npm/cors@2.8.6" },
        {
          type: "library",
          name: "@opentui/core-linux-x64",
          version: "2.8.6",
          purl: "pkg:npm/%40opentui/core-linux-x64@2.8.6",
        },
      ]
      const result = await Deps.enrich(input, dir)
      expect(result.gaps).toEqual([
        { component: "@opentui/core-linux-x64@2.8.6", reason: "licence unknown: package not installed locally" },
      ])
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true })
    }
  })

  test("recognises @parcel/watcher's non-standard '-glibc' libc suffix", async () => {
    const dir = await scratch()
    try {
      await Bun.write(
        path.join(dir, "@parcel", "watcher-darwin-arm64", "package.json"),
        JSON.stringify({ license: "MIT" }),
      )
      const input: Component[] = [
        {
          type: "library",
          name: "@parcel/watcher-darwin-arm64",
          version: "2.5.1",
          purl: "pkg:npm/%40parcel/watcher-darwin-arm64@2.5.1",
        },
        {
          type: "library",
          name: "@parcel/watcher-linux-x64-glibc",
          version: "2.5.1",
          purl: "pkg:npm/%40parcel/watcher-linux-x64-glibc@2.5.1",
        },
      ]
      const result = await Deps.enrich(input, dir)
      expect(result.components[1].licenses).toEqual(["MIT"])
      expect(result.gaps).toEqual([])
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true })
    }
  })

  test("does not apply the family heuristic to a plain, non-platform-suffixed name", async () => {
    const dir = await scratch()
    try {
      const input: Component[] = [{ type: "library", name: "cors", version: "1.0.0", purl: "pkg:npm/cors@1.0.0" }]
      const result = await Deps.enrich(input, dir)
      expect(result.gaps).toEqual([
        { component: "cors@1.0.0", reason: "licence unknown: package not installed locally" },
      ])
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true })
    }
  })
})

describe("scan", () => {
  test("converts a syft document and drops its scan-target root", () => {
    const components = Scan.convert({
      metadata: { component: { "bom-ref": "root" } },
      components: [
        { "bom-ref": "root", type: "file", name: "kilo-linux-x64.tar.gz" },
        {
          "bom-ref": "pkg-1",
          type: "library",
          name: "diff",
          version: "8.0.4",
          purl: "pkg:npm/diff@8.0.4",
          licenses: [{ license: { id: "BSD-3-Clause" } }],
          properties: [
            { name: "syft:location:0:path", value: "/bin/x" },
            { name: "other", value: "ignored" },
          ],
        },
      ],
    })
    expect(components).toHaveLength(1)
    expect(components[0]).toMatchObject({
      name: "diff",
      version: "8.0.4",
      licenses: ["BSD-3-Clause"],
      delivery: "contained",
      properties: { source: "syft", "syft.location:0:path": "/bin/x" },
    })
  })

  test("records a gap instead of claiming an empty artifact when syft is unavailable", async () => {
    const previous = process.env.SYFT
    process.env.SYFT = ""
    try {
      const result = await Scan.scan("file:/does/not/exist")
      expect(result.components).toEqual([])
      expect(result.tools).toEqual([])
      expect(result.gaps).toEqual([
        { component: "file:/does/not/exist", reason: "file-level inventory unavailable: syft is not installed" },
      ])
    } finally {
      if (previous == null) delete process.env.SYFT
      else process.env.SYFT = previous
    }
  })
})

describe("manifest", () => {
  async function fixture(dir: string, name: string, overrides: Partial<Parameters<typeof compose>[0]> = {}) {
    const file = path.join(dir, name)
    await Bun.write(file, "artifact-bytes")
    const subject = await Artifact.subject(file)
    const document = compose({
      subject,
      product: { name: "kilo-cli", version: "7.7.9" },
      ...overrides,
    })
    await Bun.write(Artifact.sidecar(file), `${JSON.stringify(document, null, 2)}\n`)
    return {
      artifact: name,
      sha256: subject.sha256,
      size: subject.size,
      sbom: `${name}.cdx.json`,
    }
  }

  test("accepts a complete set", async () => {
    const dir = await scratch()
    try {
      const entry = await fixture(dir, "kilo-linux-x64.tar.gz")
      const report = await Manifest.verify({
        manifest: { version: "7.7.9", product: "cli", generated: "", expected: 1, entries: [entry] },
        dir,
      })
      expect(report).toMatchObject({ issues: [], ok: 1, missing: 0 })
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true })
    }
  })

  test("detects a missing sidecar", async () => {
    const dir = await scratch()
    try {
      const report = await Manifest.verify({
        manifest: {
          version: "7.7.9",
          product: "cli",
          generated: "",
          expected: 1,
          entries: [{ artifact: "kilo-linux-x64.tar.gz", sha256: DIGEST, sbom: "kilo-linux-x64.tar.gz.cdx.json" }],
        },
        dir,
      })
      expect(report.missing).toBe(1)
      expect(report.issues[0]).toContain("is missing from")
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true })
    }
  })

  test("detects a sidecar generated for different bytes", async () => {
    const dir = await scratch()
    try {
      const entry = await fixture(dir, "kilo-linux-x64.tar.gz")
      const report = await Manifest.verify({
        manifest: {
          version: "7.7.9",
          product: "cli",
          generated: "",
          expected: 1,
          entries: [{ ...entry, sha256: "b".repeat(64) }],
        },
        dir,
      })
      expect(report.missing).toBe(1)
      expect(report.issues[0]).toContain("declares digest")
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true })
    }
  })

  test("detects an incomplete artifact set", async () => {
    const dir = await scratch()
    try {
      const entry = await fixture(dir, "kilo-linux-x64.tar.gz")
      const report = await Manifest.verify({
        manifest: { version: "7.7.9", product: "cli", generated: "", expected: 12, entries: [entry] },
        dir,
      })
      expect(report.issues).toEqual([expect.stringContaining("expected 12 artifacts, manifest records 1")])
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true })
    }
  })

  test("reports a recorded generation failure", async () => {
    const report = await Manifest.verify({
      manifest: {
        version: "7.7.9",
        product: "cli",
        generated: "",
        expected: 1,
        entries: [{ artifact: "a.zip", sha256: DIGEST, error: "syft crashed" }],
      },
      dir: "/nonexistent",
    })
    expect(report.missing).toBe(1)
    expect(report.issues[0]).toContain("syft crashed")
  })

  test("merges a later workflow stage into an existing release manifest", () => {
    const lean: Manifest.Manifest = {
      version: "1.0.0",
      product: "jetbrains",
      generated: "",
      expected: 1,
      entries: [{ artifact: "lean.zip", sha256: DIGEST, sbom: "lean.zip.cdx.json" }],
    }
    const bundled: Manifest.Manifest = {
      version: "1.0.0",
      product: "jetbrains",
      generated: "",
      expected: 2,
      entries: [{ artifact: "bundled.zip", sha256: "b".repeat(64), sbom: "bundled.zip.cdx.json" }],
    }
    const merged = Manifest.merge(lean, bundled)
    expect(merged.expected).toBe(2)
    expect(merged.entries.map((item) => item.artifact).sort()).toEqual(["bundled.zip", "lean.zip"])
  })

  test("allows an identical retry but refuses to silently replace published bytes", () => {
    const base: Manifest.Manifest = {
      version: "1.0.0",
      product: "cli",
      generated: "",
      expected: 1,
      entries: [{ artifact: "a.zip", sha256: DIGEST }],
    }
    expect(Manifest.merge(base, base).entries).toHaveLength(1)
    expect(() => Manifest.merge(base, { ...base, entries: [{ artifact: "a.zip", sha256: "b".repeat(64) }] })).toThrow(
      /refusing to overwrite/,
    )
  })

  test("refuses to merge evidence across releases", () => {
    const base: Manifest.Manifest = { version: "1.0.0", product: "cli", generated: "", expected: 0, entries: [] }
    expect(() => Manifest.merge(base, { ...base, version: "1.0.1" })).toThrow(/Cannot merge evidence/)
  })

  test("omits digest-less failure entries from checksums instead of writing a malformed line", async () => {
    const text = await Manifest.checksums({
      manifest: {
        version: "7.7.9",
        product: "cli",
        generated: "",
        expected: 1,
        entries: [{ artifact: "@kilocode/cli@7.7.9", sha256: "", error: "failed" }],
      },
      dir: "/nonexistent",
    })
    expect(text).toBe("\n")
  })

  test("writes checksums for artifacts and their sidecars", async () => {
    const dir = await scratch()
    try {
      const entry = await fixture(dir, "kilo-linux-x64.tar.gz")
      const text = await Manifest.checksums({
        manifest: { version: "7.7.9", product: "cli", generated: "", expected: 1, entries: [entry] },
        dir,
      })
      expect(text).toContain(`${entry.sha256}  kilo-linux-x64.tar.gz\n`)
      expect(text).toContain("  kilo-linux-x64.tar.gz.cdx.json\n")
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true })
    }
  })

  test("round-trips through disk", async () => {
    const dir = await scratch()
    try {
      const file = path.join(dir, Manifest.name("cli"))
      const manifest: Manifest.Manifest = {
        version: "7.7.9",
        product: "cli",
        generated: "now",
        expected: 2,
        entries: [
          { artifact: "b.zip", sha256: DIGEST },
          { artifact: "a.zip", sha256: DIGEST },
        ],
      }
      await Manifest.write(file, manifest)
      const read = await Manifest.read(file)
      expect(read.entries.map((item) => item.artifact)).toEqual(["a.zip", "b.zip"])
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true })
    }
  })
})

describe("policy", () => {
  test("defaults to advisory mode", () => {
    expect(Policy.policy({}).enforce).toBe(false)
    expect(Policy.policy({ SBOM_ENFORCE: "false" }).enforce).toBe(false)
    expect(Policy.policy({ SBOM_ENFORCE: "true" }).enforce).toBe(true)
    expect(Policy.policy({ SBOM_ENFORCE: "1" }).enforce).toBe(true)
  })

  test("does not block a release while advisory", () => {
    expect(Policy.report({ label: "cli", issues: ["broken"], env: {} })).toEqual({ ok: false, enforce: false })
  })

  test("blocks a release once enforcing", () => {
    expect(Policy.report({ label: "cli", issues: ["broken"], env: { SBOM_ENFORCE: "true" } })).toEqual({
      ok: false,
      enforce: true,
    })
  })

  test("passes clean evidence in both modes", () => {
    expect(Policy.report({ label: "cli", issues: [], env: {} }).ok).toBe(true)
    expect(Policy.report({ label: "cli", issues: [], env: { SBOM_ENFORCE: "true" } }).ok).toBe(true)
  })
})

describe("artifact", () => {
  test("hashes and names a real file", async () => {
    const dir = await scratch()
    try {
      const file = path.join(dir, "kilo-darwin-arm64.zip")
      await Bun.write(file, "bytes")
      const subject = await Artifact.subject(file)
      expect(subject.name).toBe("kilo-darwin-arm64.zip")
      expect(subject.size).toBe(5)
      expect(subject.sha256).toBe(new Bun.CryptoHasher("sha256").update("bytes").digest("hex"))
      expect(Artifact.sidecar(file)).toBe(`${file}.cdx.json`)
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true })
    }
  })
})
