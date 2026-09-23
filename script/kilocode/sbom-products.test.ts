import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import * as JetBrains from "../../packages/kilo-jetbrains/script/sbom"
import * as VsCode from "../../packages/kilo-vscode/script/sbom"
import { validate } from "./sbom/index"

const release = { version: "9.9.9", channel: "latest" }

async function scratch() {
  return fs.promises.mkdtemp(path.join(os.tmpdir(), "kilo-product-sbom-"))
}

function names(bom: any) {
  return bom.components.map((item: any) => item.name)
}

function scope(bom: any, name: string) {
  return bom.components.find((item: any) => item.name === name)?.scope
}

describe("jetbrains version catalog", () => {
  test("resolves both literal versions and version references", () => {
    const parsed = JetBrains.catalog(`
[versions]
okhttp = "4.12.0"

[libraries]
okhttp = { module = "com.squareup.okhttp3:okhttp", version.ref = "okhttp" }
pinned = { module = "com.example:pinned", version = "1.2.3" }

[plugins]
detekt = { id = "io.gitlab.arturbosch.detekt", version.ref = "detekt" }
`)
    expect(parsed.libraries).toEqual([
      { group: "com.squareup.okhttp3", name: "okhttp", version: "4.12.0" },
      { group: "com.example", name: "pinned", version: "1.2.3" },
    ])
  })

  test("ignores libraries whose version cannot be resolved", () => {
    const parsed = JetBrains.catalog(`
[libraries]
broken = { module = "com.example:broken", version.ref = "missing" }
`)
    expect(parsed.libraries).toEqual([])
  })

  test("reads the real catalog and finds the bundled HTTP client", () => {
    const text = fs.readFileSync(
      path.join(import.meta.dir, "../../packages/kilo-jetbrains/gradle/libs.versions.toml"),
      "utf8",
    )
    expect(JetBrains.catalog(text).libraries).toContainEqual({
      group: "com.squareup.okhttp3",
      name: "okhttp",
      version: "4.12.0",
    })
  })
})

describe("jetbrains plugin", () => {
  test("marks the six CLI builds as runtime-delivered for the Marketplace ZIP", async () => {
    const dir = await scratch()
    try {
      const file = path.join(dir, "kilo.jetbrains-1.2.3-signed.zip")
      await Bun.write(file, "lean")
      const result = await JetBrains.plugin({ file, variant: "lean", version: "1.2.3", cli: "9.9.9" })
      const bom = await Bun.file(result.sidecar).json()

      expect(validate(bom)).toEqual([])
      for (const platform of JetBrains.PLATFORMS) {
        expect(scope(bom, `kilo-cli-${platform}`)).toBe("optional")
      }
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true })
    }
  })

  test("marks the six CLI builds as contained for the bundled ZIP", async () => {
    const dir = await scratch()
    try {
      const file = path.join(dir, "kilo-code-1.2.3-bundled.zip")
      await Bun.write(file, "bundled")
      const result = await JetBrains.plugin({ file, variant: "bundled", version: "1.2.3", cli: "9.9.9" })
      const bom = await Bun.file(result.sidecar).json()

      expect(validate(bom)).toEqual([])
      for (const platform of JetBrains.PLATFORMS) {
        expect(scope(bom, `kilo-cli-${platform}`)).toBe("required")
      }
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true })
    }
  })

  test("ships declared libraries, excludes test fixtures, and does not claim the IDE", async () => {
    const dir = await scratch()
    try {
      const file = path.join(dir, "plugin.zip")
      await Bun.write(file, "zip")
      const result = await JetBrains.plugin({ file, variant: "lean", version: "1.2.3", cli: "9.9.9" })
      const bom = await Bun.file(result.sidecar).json()

      expect(scope(bom, "okhttp")).toBe("required")
      expect(names(bom)).not.toContain("mockwebserver")
      expect(names(bom)).not.toContain("junit")
      expect(scope(bom, "intellij-platform")).toBe("excluded")
      expect(scope(bom, "kotlinx-coroutines")).toBe("excluded")
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true })
    }
  })

  test("records the immutable tag and the reviewed metadata commit", async () => {
    const dir = await scratch()
    try {
      const file = path.join(dir, "plugin.zip")
      await Bun.write(file, "zip")
      const result = await JetBrains.plugin({
        file,
        variant: "lean",
        version: "1.2.3",
        cli: "9.9.9",
        tag: "jetbrains/v1.2.3",
        merge: "f".repeat(40),
      })
      const properties = (await Bun.file(result.sidecar).json()).metadata.properties
      expect(properties).toContainEqual({ name: "kilocode:build:tag", value: "jetbrains/v1.2.3" })
      expect(properties).toContainEqual({ name: "kilocode:build:metadata-commit", value: "f".repeat(40) })
      expect(properties).toContainEqual({ name: "kilocode:build:variant", value: "lean" })
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true })
    }
  })

  test("accumulates lean and bundled evidence into one release manifest", async () => {
    const dir = await scratch()
    try {
      const lean = path.join(dir, "kilo.jetbrains-1.2.3-signed.zip")
      const bundled = path.join(dir, "kilo-code-1.2.3-bundled.zip")
      await Bun.write(lean, "lean")
      await Bun.write(bundled, "bundled")

      await JetBrains.evidence({ file: lean, variant: "lean", version: "1.2.3", cli: "9.9.9" })
      const result = await JetBrains.evidence({ file: bundled, variant: "bundled", version: "1.2.3", cli: "9.9.9" })

      expect(result.manifest.expected).toBe(2)
      expect(result.manifest.entries.map((entry) => entry.target).sort()).toEqual(["bundled", "lean"])
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true })
    }
  })
})

describe("vscode vsix", () => {
  test("maps every published vsce target to a CLI build", () => {
    expect(Object.keys(VsCode.TARGETS)).toHaveLength(8)
    expect(VsCode.TARGETS["alpine-x64"]).toBe("linux-x64-musl")
    expect(VsCode.TARGETS["win32-arm64"]).toBe("windows-arm64")
  })

  test("describes the embedded CLI target and bundled FFmpeg helper", async () => {
    const dir = await scratch()
    try {
      const file = path.join(dir, "kilo-vscode-linux-x64.vsix")
      await Bun.write(file, "vsix")
      const result = await VsCode.vsix({ file, target: "linux-x64", release })
      const bom = await Bun.file(result.sidecar).json()

      expect(validate(bom)).toEqual([])
      expect(bom.metadata.properties).toContainEqual({ name: "kilocode:embedded:cli", value: "linux-x64" })
      expect(names(bom)).toContain("@ffmpeg-installer/linux-x64")
      expect(names(bom)).toContain("bubblewrap")
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true })
    }
  })

  test("does not claim a bundled FFmpeg helper on Windows ARM64", async () => {
    const dir = await scratch()
    try {
      const file = path.join(dir, "kilo-vscode-win32-arm64.vsix")
      await Bun.write(file, "vsix")
      const result = await VsCode.vsix({ file, target: "win32-arm64", release })
      const bom = await Bun.file(result.sidecar).json()

      expect(validate(bom)).toEqual([])
      expect(names(bom).filter((name: string) => name.startsWith("@ffmpeg-installer/"))).toEqual([])
      expect(names(bom)).not.toContain("bubblewrap")
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true })
    }
  })

  test("rejects an unknown target instead of guessing a CLI build", async () => {
    const dir = await scratch()
    try {
      const file = path.join(dir, "kilo-vscode-solaris-sparc.vsix")
      await Bun.write(file, "vsix")
      expect(VsCode.vsix({ file, target: "solaris-sparc", release })).rejects.toThrow(/Unknown VS Code target/)
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true })
    }
  })

  test("covers each packaged VSIX exactly once", async () => {
    const dir = await scratch()
    try {
      await Bun.write(path.join(dir, "kilo-vscode-darwin-arm64.vsix"), "a")
      await Bun.write(path.join(dir, "kilo-vscode-alpine-x64.vsix"), "b")
      const result = await VsCode.evidence({ dir, release, expected: 2 })

      expect(result.manifest.entries.map((entry) => entry.target).sort()).toEqual(["alpine-x64", "darwin-arm64"])
      expect(result.manifest.entries.every((entry) => entry.sbom && !entry.error)).toBe(true)
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true })
    }
  })
})
