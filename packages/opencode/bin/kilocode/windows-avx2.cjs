const childProcess = require("child_process")
const fs = require("fs")
const os = require("os")
const path = require("path")

const cacheInfo = (arch) => {
  try {
    const root = process.env.XDG_CACHE_HOME?.replace(/[\r\n]+/g, "")
    const dir = root && path.isAbsolute(root) ? root : path.join(os.homedir().replace(/[\r\n]+/g, ""), ".cache")
    return {
      file: path.join(dir, "kilo", "bin", "windows-avx2.json"),
      key: JSON.stringify([1, "windows", arch, os.hostname(), os.release(), os.cpus().at(0)?.model]),
      boot: Date.now() - os.uptime() * 1000,
    }
  } catch {
    return undefined
  }
}

const readCache = (cache) => {
  if (!cache) return undefined
  try {
    const entry = JSON.parse(fs.readFileSync(cache.file, "utf8"))
    if (entry?.key !== cache.key || !Number.isFinite(entry.boot) || Math.abs(entry.boot - cache.boot) >= 2000)
      return undefined
    if (typeof entry.avx2 === "boolean") return entry.avx2
    if (entry.avx2 === null && Number.isFinite(entry.expiry) && entry.expiry > Date.now()) return null
    return undefined
  } catch {
    return undefined
  }
}

const writeCache = (cache, avx2) => {
  if (!cache) return avx2 === true
  try {
    fs.mkdirSync(path.dirname(cache.file), { recursive: true })
    fs.writeFileSync(
      cache.file,
      JSON.stringify({
        key: cache.key,
        boot: cache.boot,
        avx2,
        expiry: avx2 === null ? Date.now() + 60_000 : undefined,
      }),
      { mode: 0o600 },
    )
  } catch {
    return avx2 === true
  }
  return avx2 === true
}

const probe = () => {
  const cmd =
    '(Add-Type -MemberDefinition "[DllImport(""kernel32.dll"")] public static extern bool IsProcessorFeaturePresent(int ProcessorFeature);" -Name Kernel32 -Namespace Win32 -PassThru)::IsProcessorFeaturePresent(40)'

  for (const exe of ["powershell.exe", "pwsh.exe", "pwsh", "powershell"]) {
    try {
      const result = childProcess.spawnSync(exe, ["-NoProfile", "-NonInteractive", "-Command", cmd], {
        encoding: "utf8",
        timeout: 3000,
        windowsHide: true,
      })
      if (result.status !== 0) continue
      const out = (result.stdout || "").trim().toLowerCase()
      if (out === "true" || out === "1") return true
      if (out === "false" || out === "0") return false
    } catch {
      continue
    }
  }

  return null
}

function supportsAvx2(arch) {
  if (arch !== "x64") return false
  const cache = cacheInfo(arch)
  const value = readCache(cache)
  if (value !== undefined) return value === true
  return writeCache(cache, probe())
}

module.exports = { supportsAvx2 }
