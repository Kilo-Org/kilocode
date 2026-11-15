import { chmodSync, copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"

/** Exported so SBOM generation can model the exact helper each VSIX ships. */
export const packages: Record<string, string> = {
  "darwin-x64": "@ffmpeg-installer/darwin-x64@4.1.0",
  "darwin-arm64": "@ffmpeg-installer/darwin-arm64@4.1.5",
  "linux-x64": "@ffmpeg-installer/linux-x64@4.1.0",
  "linux-arm64": "@ffmpeg-installer/linux-arm64@4.1.4",
  "alpine-x64": "@ffmpeg-installer/linux-x64@4.1.0",
  "alpine-arm64": "@ffmpeg-installer/linux-arm64@4.1.4",
  "win32-x64": "@ffmpeg-installer/win32-x64@4.1.0",
}

export async function ensureFfmpegForTarget(target: string, bin: string): Promise<void> {
  if (target === "win32-arm64") {
    console.warn("No Windows ARM64 FFmpeg helper package is available; speech input will use system FFmpeg.")
    return
  }

  const spec = packages[target]
  if (!spec) throw new Error(`No FFmpeg helper package configured for target ${target}`)

  const exe = target.startsWith("win32") ? "ffmpeg.exe" : "ffmpeg"
  const dest = join(bin, exe)
  const marker = join(bin, "..", "node_modules", ".kilo-ffmpeg-target")
  if (existsSync(dest) && existsSync(marker) && (await Bun.file(marker).text()).trim() === target) return

  const tmp = join(bin, ".ffmpeg-tmp")
  rmSync(tmp, { recursive: true, force: true })
  mkdirSync(tmp, { recursive: true })

  try {
    // Bun shell builds an unquoted command line for `.cmd` shims on Windows, so
    // `npm` breaks when Node lives under a path with spaces (e.g. "C:\Program
    // Files\nodejs"). Spawn with an argument array to avoid the shell entirely.
    const packed = Bun.spawnSync(["npm", "pack", spec, "--pack-destination", tmp], { stderr: "pipe" })
    if (packed.exitCode !== 0) throw new Error(`npm pack failed for ${spec}: ${packed.stderr.toString().trim()}`)
    const name = packed.stdout.toString().trim().split(/\s+/).pop()
    if (!name) throw new Error(`npm pack did not return a tarball for ${spec}`)

    const tar = Bun.spawnSync(["tar", "-xzf", join(tmp, name), "-C", tmp], { stderr: "pipe" })
    if (tar.exitCode !== 0) throw new Error(`tar failed for ${spec}: ${tar.stderr.toString().trim()}`)

    copyFileSync(join(tmp, "package", exe), dest)
    if (!target.startsWith("win32")) chmodSync(dest, 0o755)
    await Bun.write(marker, `${target}\n`)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

export function currentFfmpegTarget(): string {
  const os = process.platform === "win32" ? "win32" : process.platform
  const arch = process.arch === "x64" ? "x64" : process.arch === "arm64" ? "arm64" : process.arch
  return `${os}-${arch}`
}
