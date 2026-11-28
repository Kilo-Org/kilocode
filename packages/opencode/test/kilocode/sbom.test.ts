import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import * as Sbom from "../../script/kilocode/sbom"
import { LanceDBRuntime } from "../../src/kilocode/lancedb"
import { validate } from "../../../../script/kilocode/sbom/index"
import { pin } from "../../../../script/kilocode/bun"

const release = { version: "9.9.9", channel: "latest", commit: "d".repeat(40) }

async function scratch() {
  return fs.promises.mkdtemp(path.join(os.tmpdir(), "kilo-cli-sbom-"))
}

function delivery(bom: any, name: string) {
  const component = bom.components.find((item: any) => item.name === name)
  return component?.properties?.find((item: any) => item.name === "kilocode:delivery")?.value
}

describe("target", () => {
  test("maps every published archive name to its pinned Bun artifact", async () => {
    expect(Sbom.target("linux-x64")).toEqual({
      name: "@kilocode/cli-linux-x64",
      os: "linux",
      arch: "x64",
      abi: undefined,
      baseline: false,
    })
    expect(Sbom.target("linux-x64-baseline-musl")).toMatchObject({
      os: "linux",
      arch: "x64",
      abi: "musl",
      baseline: true,
    })
    expect(Sbom.target("windows-arm64")).toMatchObject({ os: "win32", arch: "arm64", baseline: false })
    expect(Sbom.target("darwin-x64-baseline")).toMatchObject({ os: "darwin", arch: "x64", baseline: true })

    for (const [slug, artifact] of Object.entries(pin.artifacts)) {
      const graph = await Sbom.graph({ target: Sbom.target(slug), subject: "kilocode:test" })
      const bun = graph.components.find((item) => item.name === "bun")
      expect(bun?.properties).toMatchObject({ "bun:artifact": artifact.name, "bun:integrity": artifact.integrity })
    }
  }, 30_000)

  test("accepts the npm package name form", () => {
    expect(Sbom.target("@kilocode/cli-linux-arm64-musl")).toMatchObject({
      name: "@kilocode/cli-linux-arm64-musl",
      os: "linux",
      arch: "arm64",
      abi: "musl",
    })
  })
})

describe("archive", () => {
  test("describes an archive with the compiled dependency closure and a matching digest", async () => {
    const dir = await scratch()
    try {
      const file = path.join(dir, "kilo-linux-x64.tar.gz")
      await Bun.write(file, "archive-bytes")
      const result = await Sbom.archive({ file, target: Sbom.target("linux-x64"), release })
      const bom = await Bun.file(result.sidecar).json()

      expect(await validate(bom)).toEqual([])
      expect(bom.components.length).toBeGreaterThan(100)
      expect(result.entry).toMatchObject({ artifact: "kilo-linux-x64.tar.gz", target: "linux-x64" })
      expect(bom.metadata.component.hashes[0].content).toBe(result.entry.sha256)
      expect(bom.metadata.properties).toContainEqual({ name: "kilocode:build:commit", value: release.commit })
      const runtime = bom.components.find((item: { name: string }) => item.name === "bun")
      expect(runtime.version).toBe(pin.runtime)
      expect(runtime.purl).toBe(`pkg:generic/bun@${pin.runtime}`)
      expect(runtime.properties).toContainEqual({ name: "kilocode:bun:revision", value: pin.revision })
      expect(runtime.properties).toContainEqual({ name: "kilocode:bun:runtime-version", value: pin.runtime })
      expect(runtime.properties).toContainEqual({ name: "kilocode:bun:package-version", value: pin.version })
      expect(runtime.properties).toContainEqual({
        name: "kilocode:bun:artifact",
        value: pin.artifacts["linux-x64"].name,
      })
      expect(runtime.properties).toContainEqual({
        name: "kilocode:bun:integrity",
        value: pin.artifacts["linux-x64"].integrity,
      })
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true })
    }
  })

  test("identifies the archive by the npm package that carries the same binary", async () => {
    const dir = await scratch()
    try {
      const file = path.join(dir, "kilo-linux-x64-musl.tar.gz")
      await Bun.write(file, "a")
      const result = await Sbom.archive({ file, target: Sbom.target("linux-x64-musl"), release })
      const root = (await Bun.file(result.sidecar).json()).metadata.component
      expect(root.name).toBe("@kilocode/cli-linux-x64-musl")
      expect(root.purl).toBe("pkg:npm/%40kilocode/cli-linux-x64-musl@9.9.9")
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true })
    }
  })

  test("keeps the dependency edges of reclassified runtime components", async () => {
    const dir = await scratch()
    try {
      const file = path.join(dir, "kilo-linux-x64.tar.gz")
      await Bun.write(file, "a")
      const result = await Sbom.archive({ file, target: Sbom.target("linux-x64"), release })
      const bom = await Bun.file(result.sidecar).json()
      // Located by name rather than a pinned purl so a LanceDB version bump
      // cannot turn this into a false failure; the assertion is about the edge.
      const lance = bom.components.find((item: any) => item.name === LanceDBRuntime.pkg)
      expect(lance?.scope).toBe("optional")
      const edges = bom.dependencies.find((item: any) => item.ref === lance?.["bom-ref"])
      expect(edges?.dependsOn.length).toBeGreaterThan(0)
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true })
    }
  })

  test("ships Bubblewrap only on Linux", async () => {
    const dir = await scratch()
    try {
      const linux = path.join(dir, "kilo-linux-arm64.tar.gz")
      const mac = path.join(dir, "kilo-darwin-arm64.zip")
      await Bun.write(linux, "a")
      await Bun.write(mac, "b")
      const [a, b] = await Promise.all([
        Sbom.archive({ file: linux, target: Sbom.target("linux-arm64"), release }),
        Sbom.archive({ file: mac, target: Sbom.target("darwin-arm64"), release }),
      ])
      expect(delivery(await Bun.file(a.sidecar).json(), "bubblewrap")).toBe("contained")
      expect(delivery(await Bun.file(b.sidecar).json(), "bubblewrap")).toBeUndefined()
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true })
    }
  })

  test("marks externalized and downloaded components as runtime-delivered", async () => {
    const dir = await scratch()
    try {
      const file = path.join(dir, "kilo-linux-x64.tar.gz")
      await Bun.write(file, "a")
      const result = await Sbom.archive({ file, target: Sbom.target("linux-x64"), release })
      const bom = await Bun.file(result.sidecar).json()
      expect(delivery(bom, "ripgrep")).toBe("runtime")
      expect(delivery(bom, "@lancedb/lancedb")).toBe("runtime")
      expect(delivery(bom, "bun")).toBe("contained")
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true })
    }
  })

  test("keeps target-specific native packages out of other targets", async () => {
    const dir = await scratch()
    try {
      const file = path.join(dir, "kilo-darwin-arm64.zip")
      await Bun.write(file, "a")
      const result = await Sbom.archive({ file, target: Sbom.target("darwin-arm64"), release })
      const names = (await Bun.file(result.sidecar).json()).components.map((item: any) => item.name)
      expect(names).not.toContain("@opentui/core-linux-x64")
      expect(names.some((name: string) => name.startsWith("@opentui/core-darwin"))).toBe(true)
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true })
    }
  })
})

describe("npm package", () => {
  test("links the launcher package to every platform package it installs", async () => {
    const dir = await scratch()
    try {
      const file = path.join(dir, "kilocode-cli-9.9.9.tgz")
      await Bun.write(file, "a")
      const result = await Sbom.npmPackage({ file, name: "@kilocode/cli", release })
      const bom = await Bun.file(result.sidecar).json()
      expect(await validate(bom)).toEqual([])
      const root = bom.dependencies.find((item: any) => item.ref.startsWith("kilocode:artifact:"))
      expect(root.dependsOn).toHaveLength(12)
      expect(result.entry).toMatchObject({ distribution: "npm" })
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true })
    }
  })
})

describe("oci image", () => {
  test("names a failed and a successful description identically", () => {
    expect(Sbom.ociName("sha256:" + "a".repeat(64), "linux/amd64")).toBe("kilo-oci-linux-amd64@aaaaaaaaaaaa")
    expect(Sbom.ociName("sha256:" + "a".repeat(64))).toBe("kilo-oci-index@aaaaaaaaaaaa")
  })

  test("records an empty image inventory as a failure rather than valid evidence", async () => {
    const dir = await scratch()
    const previous = process.env.SYFT
    process.env.SYFT = ""
    try {
      const result = await Sbom.ociImage({
        reference: "ghcr.io/kilo-org/kilocode@sha256:" + "b".repeat(64),
        digest: "sha256:" + "b".repeat(64),
        platform: "linux/arm64",
        release,
        out: dir,
      })
      expect(result.entry.error).toContain("image inventory is empty")
      expect(result.entry.error).toContain("syft is not installed")
    } finally {
      if (previous == null) delete process.env.SYFT
      else process.env.SYFT = previous
      await fs.promises.rm(dir, { recursive: true, force: true })
    }
  })
})

describe("evidence", () => {
  test("covers every produced archive and writes a manifest plus checksums", async () => {
    const dir = await scratch()
    try {
      await Bun.write(path.join(dir, "kilo-linux-x64.tar.gz"), "a")
      await Bun.write(path.join(dir, "kilo-windows-x64.zip"), "b")
      const result = await Sbom.evidence({ dir, release, expected: 2 })

      expect(result.manifest.entries.map((entry) => entry.artifact)).toEqual([
        "kilo-linux-x64.tar.gz",
        "kilo-windows-x64.zip",
      ])
      expect(result.manifest.entries.every((entry) => entry.sbom && !entry.error)).toBe(true)
      const sums = await Bun.file(path.join(dir, Sbom.CHECKSUMS)).text()
      expect(sums).toContain("kilo-linux-x64.tar.gz\n")
      expect(sums).toContain("kilo-windows-x64.zip.cdx.json\n")
      expect(result.files.some((file) => file.endsWith("cli-sbom-evidence.json"))).toBe(true)
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true })
    }
  })

  test("reports a shortfall when the build stopped emitting a platform", async () => {
    const dir = await scratch()
    try {
      await Bun.write(path.join(dir, "kilo-linux-x64.tar.gz"), "a")
      const result = await Sbom.evidence({ dir, release, expected: 12 })
      expect(result.manifest.expected).toBe(12)
      expect(result.manifest.entries).toHaveLength(1)
    } finally {
      process.exitCode = 0
      await fs.promises.rm(dir, { recursive: true, force: true })
    }
  })

  test("ignores files that are not release archives", async () => {
    const dir = await scratch()
    try {
      await Bun.write(path.join(dir, "kilo-linux-x64.tar.gz"), "a")
      await Bun.write(path.join(dir, "notes.txt"), "b")
      await fs.promises.mkdir(path.join(dir, "@kilocode"), { recursive: true })
      const result = await Sbom.evidence({ dir, release, expected: 1 })
      expect(result.manifest.entries.map((entry) => entry.artifact)).toEqual(["kilo-linux-x64.tar.gz"])
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true })
    }
  })
})

describe("signed", () => {
  test("describes the signed Windows zips and keeps every other build entry", async () => {
    const dir = await scratch()
    try {
      const evidence = path.join(dir, "evidence")
      const zips = path.join(dir, "windows")
      await fs.promises.mkdir(evidence)
      await fs.promises.mkdir(zips)
      await Bun.write(path.join(evidence, "kilo-linux-x64.tar.gz"), "linux")
      await Bun.write(path.join(evidence, "kilo-windows-x64.zip"), "unsigned")
      const built = await Sbom.evidence({ dir: evidence, release, expected: 2 })
      await fs.promises.rm(path.join(evidence, "kilo-linux-x64.tar.gz"))
      await fs.promises.rm(path.join(evidence, "kilo-windows-x64.zip"))
      await Bun.write(path.join(zips, "kilo-windows-x64.zip"), "signed")
      const sha = new Bun.CryptoHasher("sha256").update("signed").digest("hex")

      const result = await Sbom.signed({
        dir: evidence,
        zips,
        digests: new Map([["kilo-windows-x64.zip", sha]]),
        release,
      })
      const windows = result.manifest.entries.find((entry) => entry.artifact === "kilo-windows-x64.zip")!
      expect(windows.sha256).toBe(sha)
      const bom = await Bun.file(path.join(evidence, windows.sbom!)).json()
      expect(await validate(bom)).toEqual([])
      expect(bom.metadata.component.hashes[0].content).toBe(sha)
      const sidecar = await Bun.file(path.join(evidence, windows.sbom!)).arrayBuffer()
      expect(windows.sbomSha256).toBe(new Bun.CryptoHasher("sha256").update(sidecar).digest("hex"))
      expect(result.manifest.entries.find((entry) => entry.artifact === "kilo-linux-x64.tar.gz")).toEqual(
        built.manifest.entries.find((entry) => entry.artifact === "kilo-linux-x64.tar.gz"),
      )
      const written = await Bun.file(path.join(evidence, "cli-sbom-evidence.json")).json()
      expect(
        written.entries.find((entry: { artifact: string }) => entry.artifact === "kilo-windows-x64.zip").sha256,
      ).toBe(sha)
      const sums = await Bun.file(path.join(evidence, Sbom.CHECKSUMS)).text()
      expect(sums).toContain(`${sha}  kilo-windows-x64.zip\n`)
      expect(sums).toContain(`${windows.sbomSha256}  kilo-windows-x64.zip.cdx.json\n`)
      expect((await fs.promises.readdir(evidence)).sort()).toEqual(
        [
          Sbom.CHECKSUMS,
          "cli-sbom-evidence.json",
          "kilo-linux-x64.tar.gz.cdx.json",
          "kilo-windows-x64.zip.cdx.json",
        ].sort(),
      )
      expect(await fs.promises.readdir(zips)).toEqual(["kilo-windows-x64.zip"])
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true })
    }
  })

  test("refuses a zip that is not the one sign-cli-windows recorded", async () => {
    const dir = await scratch()
    try {
      const evidence = path.join(dir, "evidence")
      const zips = path.join(dir, "windows")
      await fs.promises.mkdir(evidence)
      await fs.promises.mkdir(zips)
      await Bun.write(path.join(evidence, "kilo-windows-x64.zip"), "unsigned")
      await Sbom.evidence({ dir: evidence, release, expected: 1 })
      await fs.promises.rm(path.join(evidence, "kilo-windows-x64.zip"))
      await Bun.write(path.join(zips, "kilo-windows-x64.zip"), "unsigned")
      const run = (digests: Map<string, string>) => Sbom.signed({ dir: evidence, zips, digests, release })

      await expect(run(new Map([["kilo-windows-x64.zip", "a".repeat(64)]]))).rejects.toThrow(
        /kilo-windows-x64\.zip has digest [0-9a-f]{64}; sign-cli-windows recorded a{64}/,
      )
      await expect(run(new Map([["kilo-windows-arm64.zip", "a".repeat(64)]]))).rejects.toThrow(/Windows zips/)
      await Bun.write(path.join(zips, "kilo-windows-arm64.zip"), "extra")
      await expect(run(new Map([["kilo-windows-x64.zip", "a".repeat(64)]]))).rejects.toThrow(/Windows zips/)
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true })
    }
  })

  test("installs the cross-platform packages the build installs", async () => {
    const build = await Bun.file(path.join(import.meta.dir, "../../script/build.ts")).text()
    const names = [...build.matchAll(/bun install --os="\*" --cpu="\*" (\S+)@\$\{/g)].map((match) => match[1])
    expect(names).toEqual(Sbom.CROSS_PLATFORM)
  })
})
