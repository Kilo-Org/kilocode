#!/usr/bin/env node

import fs from "fs"
import path from "path"
import os from "os"
import childProcess from "child_process"
import { fileURLToPath } from "url"
import { createRequire } from "module"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

// kilocode_change start - variant detection matching bin/kilo logic
const platformMap = {
  darwin: "darwin",
  linux: "linux",
  win32: "windows",
}
const archMap = {
  x64: "x64",
  arm64: "arm64",
  arm: "arm",
}

function detectPlatformAndArch() {
  const platform = platformMap[os.platform()] || os.platform()
  const arch = archMap[os.arch()] || os.arch()
  return { platform, arch }
}

function supportsAvx2() {
  const { platform, arch } = detectPlatformAndArch()
  if (arch !== "x64") return false

  if (platform === "linux") {
    try {
      return /(^|\s)avx2(\s|$)/i.test(fs.readFileSync("/proc/cpuinfo", "utf8"))
    } catch {
      return false
    }
  }

  if (platform === "darwin") {
    try {
      const result = childProcess.spawnSync("sysctl", ["-n", "hw.optional.avx2_0"], {
        encoding: "utf8",
        timeout: 1500,
      })
      if (result.status !== 0) return false
      return (result.stdout || "").trim() === "1"
    } catch {
      return false
    }
  }

  return false
}

function isMusl() {
  try {
    if (fs.existsSync("/etc/alpine-release")) return true
  } catch {
    // ignore
  }

  try {
    const result = childProcess.spawnSync("ldd", ["--version"], { encoding: "utf8" })
    const text = ((result.stdout || "") + (result.stderr || "")).toLowerCase()
    if (text.includes("musl")) return true
  } catch {
    // ignore
  }

  return false
}

function getPackageNames() {
  const { platform, arch } = detectPlatformAndArch()
  const base = `@kilocode/cli-${platform}-${arch}`
  const avx2 = supportsAvx2()
  const baseline = arch === "x64" && !avx2

  if (platform === "linux") {
    const musl = isMusl()
    if (musl) {
      if (arch === "x64") {
        if (baseline) return [`${base}-baseline-musl`, `${base}-musl`, `${base}-baseline`, base]
        return [`${base}-musl`, `${base}-baseline-musl`, base, `${base}-baseline`]
      }
      return [`${base}-musl`, base]
    }
    if (arch === "x64") {
      if (baseline) return [`${base}-baseline`, base, `${base}-baseline-musl`, `${base}-musl`]
      return [base, `${base}-baseline`, `${base}-musl`, `${base}-baseline-musl`]
    }
    return [base, `${base}-musl`]
  }

  if (arch === "x64") {
    if (baseline) return [`${base}-baseline`, base]
    return [base, `${base}-baseline`]
  }
  return [base]
}

function findBinary() {
  const { platform } = detectPlatformAndArch()
  const binaryName = platform === "windows" ? "kilo.exe" : "kilo"
  const names = getPackageNames()

  for (const packageName of names) {
    try {
      const packageJsonPath = require.resolve(`${packageName}/package.json`)
      const packageDir = path.dirname(packageJsonPath)
      const binaryPath = path.join(packageDir, "bin", binaryName)

      if (fs.existsSync(binaryPath)) {
        return { binaryPath, binaryName }
      }
    } catch {
      // package not installed, try next variant
    }
  }

  throw new Error(`Could not find any binary package. Tried: ${names.map((n) => `"${n}"`).join(", ")}`)
}
// kilocode_change end

function main() {
  if (os.platform() === "win32") {
    // On Windows, the .exe is already included in the package and bin field points to it
    console.log("Windows detected: binary setup not needed (using packaged .exe)")
    return
  }

  const { binaryPath } = findBinary()
  const target = path.join(__dirname, "bin", ".kilo") // kilocode_change
  if (fs.existsSync(target)) fs.unlinkSync(target)
  try {
    fs.linkSync(binaryPath, target)
  } catch {
    fs.copyFileSync(binaryPath, target)
  }
  fs.chmodSync(target, 0o755)
}

try {
  main()
} catch (error) {
  console.error("Failed to setup kilo binary:", error.message)
  process.exit(1)
}
