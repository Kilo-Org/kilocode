#!/usr/bin/env node

import childProcess from "child_process"
import fs from "fs"
import os from "os"
import path from "path"
import { createRequire } from "module"
import { fileURLToPath, pathToFileURL } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

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

const platform = platformMap[os.platform()] ?? os.platform()
const arch = archMap[os.arch()] ?? os.arch()
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

// kilocode_change start - three-state libc detection ("unknown" never blocks an install)
export function detectLibc() {
  if (platform !== "linux") return "unknown"

  try {
    const header = process.report?.getReport?.().header
    if (header?.glibcVersionRuntime) return "glibc"
  } catch {
    // process.report can be unavailable or blocked; fall through to other probes.
  }

  try {
    if (fs.existsSync("/etc/alpine-release")) return "musl"
  } catch {
    // Ignore filesystem probes that are blocked by the host.
  }

  for (const dir of ["/lib", "/usr/lib"]) {
    try {
      if (fs.readdirSync(dir).some((file) => file.startsWith("ld-musl-"))) return "musl"
    } catch {
      // Directory may not exist on this host.
    }
  }

  try {
    const result = childProcess.spawnSync("ldd", ["--version"], { encoding: "utf8" })
    const text = `${result.stdout || ""}${result.stderr || ""}`.toLowerCase()
    if (text.includes("musl")) return "musl"
    if (text.includes("glibc") || text.includes("gnu libc")) return "glibc"
  } catch {
    // ldd missing: libc stays unknown.
  }

  return "unknown"
}

function isMusl(libc = detectLibc()) {
  return libc === "musl"
}
// kilocode_change end
function packageNames(libc = detectLibc()) {
  const baseline = arch === "x64" && !supportsAvx2()

  if (platform === "linux") {
    if (isMusl(libc)) {
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

// kilocode_change start - capture output so verification failures are diagnosable
function verifyBinary(spawn = childProcess.spawnSync) {
  const result = spawn(targetBinary, ["--version"], {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  })
  if (result.status === 0) return true
  console.error(`[kilo] binary verification failed: status=${result.status} signal=${result.signal}`)
  const out = (result.stdout || "").toString().trim()
  const err = (result.stderr || "").toString().trim()
  if (out) console.error(`[kilo] binary verification stdout: ${out}`)
  if (err) console.error(`[kilo] binary verification stderr: ${err}`)
  if (result.error) console.error(`[kilo] binary verification error: ${result.error.message}`)
  return false
}
// kilocode_change end

// kilocode_change start - only skip a package when its libc is confirmed to mismatch the host
export function isLibcCompatible(name, libc = detectLibc()) {
  if (libc === "unknown") return true
  if (!name.startsWith("@kilocode/cli-linux-")) return true
  const nameIsMusl = name.endsWith("-musl") || name.includes("-musl-")
  return nameIsMusl === (libc === "musl")
}
// kilocode_change end

export function main(deps = {}) {
  if ((deps.platform ?? platform) === "windows") {
    console.log("Windows detected: binary setup not needed (using packaged wrapper)")
    return
  }

  const libc = deps.libc ?? detectLibc()
  const spawn = deps.spawn ?? childProcess.spawnSync
  const resolve = deps.resolve ?? resolveBinary
  const copy = deps.copy ?? copyBinary
  const names = deps.names ?? packageNames(libc)

  for (const name of names) {
    try {
      copy(resolve(name))
      if (verifyBinary(spawn)) return
    } catch {
      // kilocode_change start - never npm-install a package built for the other libc (EBADPLATFORM)
      if (!isLibcCompatible(name, libc)) {
        console.log(`[kilo] skipping ${name}: incompatible libc (${libc})`)
        continue
      }
      // kilocode_change end
      const temp = fs.mkdtempSync(path.join(os.tmpdir(), "kilo-install-"))
      try {
        const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf8"))
        const version = packageJson.optionalDependencies?.[name]
        if (!version) continue
        const result = spawn(
          "npm",
          ["install", "--ignore-scripts", "--no-save", "--loglevel=error", "--prefix", temp, `${name}@${version}`],
          { stdio: "inherit", windowsHide: true },
        )
        if (result.status !== 0) continue
        copy(path.join(temp, "node_modules", name, "bin", sourceBinary))
        if (verifyBinary(spawn)) return
      } finally {
        fs.rmSync(temp, { recursive: true, force: true })
      }
    }
  }

  // kilocode_change start
  throw new Error(
    `It seems your package manager failed to install the right Kilo CLI package. Try manually installing ${names
      .map((name) => JSON.stringify(name))
      .join(" or ")}. Or download the pre-built binary from the GitHub Releases page.`,
  )
// kilocode_change end
}
// kilocode_change start - only run main if executed directly (allows importing in tests)
function checkMain() {
  if (!process.argv[1]) return false
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))
  } catch (err) {
    console.error(`[kilo] script path resolution failed: ${err.message}`)
    return import.meta.url === pathToFileURL(process.argv[1]).href
  }
}

if (checkMain()) {
  try {
    main()
  } catch (error) {
    console.error("Failed to setup kilo binary:", error.message)
    process.exit(1)
  }
}
// kilocode_change end
