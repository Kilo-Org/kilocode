import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import * as Sbom from "../../script/kilocode/sbom"
import { validate } from "../../../../script/kilocode/sbom/index"

const release = { version: "9.9.9", channel: "latest", commit: "d".repeat(40) }

async function scratch() {
  return fs.promises.mkdtemp(path.join(os.tmpdir(), "kilo-cli-sbom-"))
}

function delivery(bom: any, name: string) {
  const component = bom.components.find((item: any) => item.name === name)
  return component?.properties?.find((item: any) => item.name === "kilocode:delivery")?.value
}

describe("target", () => {
  test("parses every published archive name", () => {
    expect(Sbom.target("linux-x64")).toEqual({
      name: "linux-x64",
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
  })

  test("accepts the npm package name form", () => {
    expect(Sbom.target("@kilocode/cli-linux-arm64-musl")).toMatchObject({ os: "linux", arch: "arm64", abi: "musl" })
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

      expect(validate(bom)).toEqual([])
      expect(bom.components.length).toBeGreaterThan(100)
      expect(result.entry).toMatchObject({ artifact: "kilo-linux-x64.tar.gz", target: "linux-x64" })
      expect(bom.metadata.component.hashes[0].content).toBe(result.entry.sha256)
      expect(bom.metadata.properties).toContainEqual({ name: "kilocode:build:commit", value: release.commit })
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
