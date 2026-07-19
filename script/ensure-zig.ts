#!/usr/bin/env bun
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { chmodSync, copyFileSync, existsSync, mkdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const version = "0.14.0"
const base = `https://ziglang.org/download/${version}`

type Platform = {
  key: string
  filename: string
  sha256: string
  kind: "tar.xz" | "zip"
  exe: string
  archiveArch: string
}

const platforms: Record<string, Platform> = {
  "linux-x64": {
    key: "linux-x64",
    filename: `zig-linux-x86_64-${version}.tar.xz`,
    sha256: "473ec26806133cf4d1918caf1a410f8403a13d979726a9045b421b685031a982",
    kind: "tar.xz",
    exe: "zig",
    archiveArch: "linux-x86_64",
  },
  "linux-arm64": {
    key: "linux-arm64",
    filename: `zig-linux-aarch64-${version}.tar.xz`,
    sha256: "ab64e3ea277f6fc5f3d723dcd95d9ce1ab282c8ed0f431b4de880d30df891e4f",
    kind: "tar.xz",
    exe: "zig",
    archiveArch: "linux-aarch64",
  },
  "darwin-x64": {
    key: "darwin-x64",
    filename: `zig-macos-x86_64-${version}.tar.xz`,
    sha256: "685816166f21f0b8d6fc7aa6a36e91396dcd82ca6556dfbe3e329deffc01fec3",
    kind: "tar.xz",
    exe: "zig",
    archiveArch: "macos-x86_64",
  },
  "darwin-arm64": {
    key: "darwin-arm64",
    filename: `zig-macos-aarch64-${version}.tar.xz`,
    sha256: "b71e4b7c4b4be9953657877f7f9e6f7ee89114c716da7c070f4a238220e95d7e",
    kind: "tar.xz",
    exe: "zig",
    archiveArch: "macos-aarch64",
  },
  "windows-x64": {
    key: "windows-x64",
    filename: `zig-windows-x86_64-${version}.zip`,
    sha256: "f53e5f9011ba20bbc3e0e6d0a9441b31eb227a97bac0e7d24172f1b8b27b4371",
    kind: "zip",
    exe: "zig.exe",
    archiveArch: "windows-x86_64",
  },
}

function platformKey(): string | undefined {
  const arch = process.arch === "x64" ? "x64" : process.arch === "arm64" ? "arm64" : undefined
  const os = process.platform === "linux" ? "linux" : process.platform === "darwin" ? "darwin" : process.platform === "win32" ? "windows" : undefined
  if (!arch || !os) return undefined
  return `${os}-${arch}`
}

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex")
}

function findOnPath(): string | undefined {
  const probe = process.platform === "win32" ? "zig.exe" : "zig"
  const result = spawnSync(process.platform === "win32" ? "where" : "which", [probe], { encoding: "utf8" })
  if (result.status !== 0) return undefined
  const line = result.stdout.split(/\r?\n/).find((l) => l.trim().length > 0)
  return line?.trim()
}

function zigVersionOk(bin: string): boolean {
  const result = spawnSync(bin, ["version"], { encoding: "utf8" })
  return result.status === 0 && result.stdout.trim() === version
}

function linkBin(binDir: string, target: string, exe: string) {
  mkdirSync(binDir, { recursive: true })
  const link = path.join(binDir, exe)
  rmSync(link, { force: true })
  try {
    symlinkSync(target, link)
    return
  } catch {}
  copyFileSync(target, link)
  if (process.platform !== "win32") chmodSync(link, 0o755)
}

function extractPythonScript(archive: string, dest: string, zip = false): string {
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")
  const fn = zip ? "zipfile" : "tarfile"
  const mode = zip ? "r" : "r:xz"
  return `import ${fn}; ${fn}.open('${esc(archive)}','${mode}').extractall('${esc(dest)}')`
}

async function main() {
  const key = platformKey()
  if (!key) {
    console.warn(`ensure-zig: unsupported platform ${process.platform}/${process.arch}; skipping`)
    return
  }
  if (process.env.KILO_SKIP_BUNDLED_BWRAP === "1") return
  const platform = platforms[key]
  if (!platform) return

  const repoRoot = path.resolve(import.meta.dir, "..")
  const binDir = path.join(repoRoot, "node_modules", ".bin")
  // Preserve the original extracted layout so zig can locate its sibling `lib/`, etc.
  const stagedRoot = path.join(repoRoot, "node_modules", ".zig", version, key, `zig-${platform.archiveArch}-${version}`)
  const stagedBin = path.join(stagedRoot, platform.exe)

  if (existsSync(stagedBin) && zigVersionOk(stagedBin)) {
    linkBin(binDir, stagedBin, platform.exe)
    return
  }

  const existing = findOnPath()
  if (existing && zigVersionOk(existing)) {
    console.log(`ensure-zig: found zig ${version} on PATH at ${existing}; skipping download`)
    linkBin(binDir, existing, platform.exe)
    return
  }

  console.log(`ensure-zig: downloading zig ${version} for ${key}`)
  const url = `${base}/${platform.filename}`
  const response = await fetch(url)
  if (!response.ok) throw new Error(`ensure-zig: failed to download ${url} (HTTP ${response.status})`)
  const data = Buffer.from(await response.arrayBuffer())
  const got = sha256(data)
  if (got !== platform.sha256) {
    throw new Error(`ensure-zig: sha256 mismatch for ${platform.filename}\n  expected ${platform.sha256}\n  got      ${got}`)
  }

  const extractRoot = path.join(repoRoot, "node_modules", ".zig", version, key, "_extract")
  rmSync(extractRoot, { recursive: true, force: true })
  mkdirSync(extractRoot, { recursive: true })

  const archivePath = path.join(tmpdir(), `kilo-zig-${version}-${key}.${platform.kind === "zip" ? "zip" : "tar.xz"}`)
  writeFileSync(archivePath, data)

  if (platform.kind === "tar.xz") {
    const tar = spawnSync("tar", ["-xJf", archivePath, "-C", extractRoot], { stdio: "inherit" })
    if (tar.status !== 0) {
      const py = spawnSync("python3", ["-c", extractPythonScript(archivePath, extractRoot)], { stdio: "inherit" })
      if (py.status !== 0) {
        throw new Error(
          `ensure-zig: failed to extract tar.xz with both \`tar -xJf\` and \`python3\`.\n` +
            `Install xz (e.g. \`apt install xz-utils\`, \`brew install xz\`) or python3 with lzma, then re-run \`bun install\`.`,
        )
      }
    }
  } else {
    const result = spawnSync("unzip", ["-q", archivePath, "-d", extractRoot], { stdio: "inherit" })
    if (result.status !== 0) {
      const py = spawnSync("python3", ["-c", extractPythonScript(archivePath, extractRoot, true)], { stdio: "inherit" })
      if (py.status !== 0) {
        throw new Error(
          `ensure-zig: failed to extract zip with both \`unzip\` and \`python3\`.\n` +
            `Install unzip or python3, then re-run \`bun install\`.`,
        )
      }
    }
  }

  const extracted = path.join(extractRoot, `zig-${platform.archiveArch}-${version}`)
  if (!existsSync(path.join(extracted, platform.exe))) {
    throw new Error(`ensure-zig: extracted binary missing at ${path.join(extracted, platform.exe)}`)
  }
  rmSync(stagedRoot, { recursive: true, force: true })
  renameSync(extracted, stagedRoot)
  rmSync(extractRoot, { recursive: true, force: true })
  rmSync(archivePath, { force: true })
  if (platform.kind === "tar.xz") chmodSync(stagedBin, 0o755)

  linkBin(binDir, stagedBin, platform.exe)
  console.log(`ensure-zig: installed zig ${version} at ${stagedBin}`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})