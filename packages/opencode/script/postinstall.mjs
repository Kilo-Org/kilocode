#!/usr/bin/env node

import childProcess from "child_process"
import fs from "fs"
import os from "os"
import path from "path"
import { createRequire } from "module"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
// kilocode_change start - allow test suite to point to root package.json
const packageJsonPath = process.env.KILO_TEST_PACKAGE_JSON ?? path.join(__dirname, "package.json")
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"))
// kilocode_change end

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

// kilocode_change start - test hooks for CI environment simulation
const platform = process.env.KILO_TEST_PLATFORM ?? (platformMap[os.platform()] ?? os.platform())
const arch = process.env.KILO_TEST_ARCH ?? (archMap[os.arch()] ?? os.arch())
// kilocode_change end
const base = `@kilocode/cli-${platform}-${arch}`
const sourceBinary = platform === "windows" ? "kilo.exe" : "kilo"
const targetBinary = path.join(__dirname, "bin", ".kilo")

function supportsAvx2() {
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

  if (platform === "windows") {
    const command =
      '(Add-Type -MemberDefinition "[DllImport(""kernel32.dll"")] public static extern bool IsProcessorFeaturePresent(int ProcessorFeature);" -Name Kernel32 -Namespace Win32 -PassThru)::IsProcessorFeaturePresent(40)'

    for (const executable of ["powershell.exe", "pwsh.exe", "pwsh", "powershell"]) {
      try {
        const result = childProcess.spawnSync(executable, ["-NoProfile", "-NonInteractive", "-Command", command], {
          encoding: "utf8",
          timeout: 3000,
          windowsHide: true,
        })
        if (result.status !== 0) continue
        const output = (result.stdout || "").trim().toLowerCase()
        if (output === "true" || output === "1") return true
        if (output === "false" || output === "0") return false
      } catch {
        continue
      }
    }
  }

  return false
}

function isMusl() {
  if (platform !== "linux") return false
  if (process.env.KILO_TEST_IS_MUSL !== undefined) return process.env.KILO_TEST_IS_MUSL === "true" // kilocode_change

  try {
    if (fs.existsSync("/etc/alpine-release")) return true
  } catch {
    // Ignore filesystem probes that are blocked by the host.
  }

  try {
    const result = childProcess.spawnSync("ldd", ["--version"], { encoding: "utf8" })
    return `${result.stdout || ""}${result.stderr || ""}`.toLowerCase().includes("musl")
  } catch {
    return false
  }
}

function packageNames() {
  const baseline = arch === "x64" && !supportsAvx2()

  if (platform === "linux") {
    if (isMusl()) {
      if (arch === "x64")
        return baseline
          ? [`${base}-baseline-musl`, `${base}-musl`, `${base}-baseline`, base]
          : [`${base}-musl`, `${base}-baseline-musl`, base, `${base}-baseline`]
      return [`${base}-musl`, base]
    }

    if (arch === "x64")
      return baseline
        ? [`${base}-baseline`, base, `${base}-baseline-musl`, `${base}-musl`]
        : [base, `${base}-baseline`, `${base}-musl`, `${base}-baseline-musl`]
    return [base, `${base}-musl`]
  }

  if (arch === "x64") return baseline ? [`${base}-baseline`, base] : [base, `${base}-baseline`]
  return [base]
}

function resolveBinary(name) {
  const packageJsonPath = require.resolve(`${name}/package.json`)
  const binaryPath = path.join(path.dirname(packageJsonPath), "bin", sourceBinary)
  if (!fs.existsSync(binaryPath)) throw new Error(`Binary not found at ${binaryPath}`)
  return binaryPath
}
// kilocode_change end

// kilocode_change start - copy runtime resources next to cached binary
function copyResources(source) {
  for (const [name, entry] of [
    ["tree-sitter", "tree-sitter.wasm"],
    ["console", "index.html"],
  ]) {
    const dir = path.join(path.dirname(source), name)
    if (!fs.existsSync(path.join(dir, entry))) continue
    const target = path.join(__dirname, "bin", name)
    fs.rmSync(target, { recursive: true, force: true })
    fs.cpSync(dir, target, { recursive: true })
  }

  const bwrap = path.join(path.dirname(source), "bwrap")
  if (fs.existsSync(bwrap)) {
    const target = path.join(__dirname, "bin", "bwrap")
    fs.copyFileSync(bwrap, target)
    fs.chmodSync(target, 0o755)
  }

  const licenses = path.join(path.dirname(source), "licenses")
  if (fs.existsSync(licenses)) {
    const target = path.join(__dirname, "bin", "licenses")
    fs.rmSync(target, { recursive: true, force: true })
    fs.cpSync(licenses, target, { recursive: true })
  }

  const worker = path.join(path.dirname(source), "kilo-sandbox-mutation-worker.js")
  if (fs.existsSync(worker)) fs.copyFileSync(worker, path.join(__dirname, "bin", "kilo-sandbox-mutation-worker.js"))
}

function copyBinary(source) {
  if (!fs.existsSync(source)) throw new Error(`Binary not found at ${source}`)
  fs.mkdirSync(path.dirname(targetBinary), { recursive: true })
  if (fs.existsSync(targetBinary)) fs.unlinkSync(targetBinary)
  try {
    fs.linkSync(source, targetBinary)
  } catch {
    fs.copyFileSync(source, targetBinary)
  }
  copyResources(source)
  fs.chmodSync(targetBinary, 0o755)
}
// kilocode_change end

function verifyBinary() {
  if (process.env.KILO_TEST_BINARY_WORKS !== undefined) return process.env.KILO_TEST_BINARY_WORKS === "true" // kilocode_change
  
  const result = childProcess.spawnSync(targetBinary, ["--version"], {
    stdio: ["ignore", "pipe", "pipe"], // kilocode_change - capture output to surface errors
    windowsHide: true,
  })
  // kilocode_change start - log failure reason so the root cause is visible
  if (result.status !== 0) {
    const out = (result.stdout || "").toString().trim()
    const err = (result.stderr || "").toString().trim()
    if (out) console.error(`[kilo] binary verification stdout: ${out}`)
    if (err) console.error(`[kilo] binary verification stderr: ${err}`)
    if (result.error) console.error(`[kilo] binary verification error: ${result.error.message}`)
  }
  // kilocode_change end
  return result.status === 0
}

// kilocode_change start - check if a package name is compatible with the current libc
function isLibcCompatible(name) {
  const musl = isMusl()
  const nameIsMusl = name.endsWith("-musl") || name.includes("-musl-")
  // prevent installing a musl package on a glibc system and vice versa
  if (nameIsMusl && !musl) return false
  if (!nameIsMusl && musl && name.startsWith("@kilocode/cli-linux-")) return false
  return true
}
// kilocode_change end

function main() {
  if (platform === "windows") {
    console.log("Windows detected: binary setup not needed (using packaged wrapper)")
    return
  }

  for (const name of packageNames()) {
    // kilocode_change start - skip packages incompatible with the current libc
    if (!isLibcCompatible(name)) {
      console.log(`[kilo] skipping ${name}: incompatible libc`)
      continue
    }
    // kilocode_change end
    try {
      copyBinary(resolveBinary(name))
      if (verifyBinary()) return
    } catch {
      const temp = fs.mkdtempSync(path.join(os.tmpdir(), "kilo-install-"))
      try {
        const version = packageJson.optionalDependencies?.[name]
        if (!version) continue
        let result;
        if (process.env.KILO_TEST_NPM === "skip") {
          result = { status: 1 } // kilocode_change - mock failed install for tests
        } else {
          result = childProcess.spawnSync(
            "npm",
            ["install", "--ignore-scripts", "--no-save", "--loglevel=error", "--prefix", temp, `${name}@${version}`],
            { stdio: "inherit", windowsHide: true },
          )
        }
        if (result.status !== 0) continue
        copyBinary(path.join(temp, "node_modules", name, "bin", sourceBinary))
        if (verifyBinary()) return
      } finally {
        fs.rmSync(temp, { recursive: true, force: true })
      }
    }
  }

  throw new Error(
    `It seems your package manager failed to install the right Kilo CLI package. Try manually installing ${packageNames()
      .map((name) => JSON.stringify(name))
      .join(" or ")}.`,
  )
}

try {
  main()
} catch (error) {
  console.error("Failed to setup kilo binary:", error.message)
  process.exit(1)
}
