import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { rmSync } from "node:fs"
import { appendFile, chmod, link, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import manifest from "./bun.json" with { type: "json" }

export const pin = manifest

type Target = { os: string; arch: string; abi?: string; avx2?: false }

const run = promisify(execFile)
const dirs = new Set<string>()

process.once("exit", () => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

export function target(input: Target) {
  const slug = [
    input.os === "win32" ? "windows" : input.os,
    input.arch,
    ...(input.avx2 === false ? ["baseline"] : []),
    ...(input.abi ? [input.abi] : []),
  ].join("-")
  for (const [key, item] of Object.entries(pin.artifacts)) {
    if (key === slug) return item
  }
  throw new Error(`Unsupported Bun target: ${slug}`)
}

export async function stage(input: Target): Promise<string> {
  const item = target(input)
  const root = resolve(tmpdir())
  const cache = join(root, "kilo-bun", pin.version)
  await mkdir(cache, { recursive: true, mode: 0o700 })
  const file = join(cache, `${item.name}.tgz`)
  const cached = await readFile(file).catch((err: NodeJS.ErrnoException) => {
    if (err.code !== "ENOENT") throw err
  })
  const bytes =
    cached ??
    (await (async () => {
      const response = await fetch(item.tarball, { redirect: "error", signal: AbortSignal.timeout(120_000) })
      if (!response.ok) throw new Error(`Bun download failed: ${response.status} ${item.tarball}`)
      return Buffer.from(await response.arrayBuffer())
    })())
  if (`sha512-${createHash("sha512").update(bytes).digest("base64")}` !== item.integrity) {
    throw new Error(`Bun checksum mismatch: ${item.name}@${pin.version}`)
  }
  if (!cached) {
    await writeFile(file, bytes, { flag: "wx", mode: 0o600 }).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== "EEXIST") throw err
    })
  }

  // Extract verified bytes, never an executable from a shared compiler cache.
  const dir = await mkdtemp(join(root, "kilo-bun-"))
  dirs.add(dir)
  const archive = join(dir, "package.tgz")
  await writeFile(archive, bytes, { flag: "wx", mode: 0o600 })
  const name = item.os === "win32" ? "bun.exe" : "bun"
  // Git Bash's GNU tar treats Windows drive letters as remote archive hosts.
  const tar =
    process.platform === "win32" ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar"
  await run(tar, ["-xzf", archive, "-C", dir, "--strip-components=2", `package/bin/${name}`], {
    windowsHide: true,
  })
  const executable = join(dir, name)
  if (!(await lstat(executable)).isFile()) throw new Error(`Bun executable is not a regular file: ${executable}`)
  if (process.platform !== "win32") await chmod(executable, 0o755)
  await rm(archive)
  return executable
}

// Bun compilation rewrites import.meta.url; only Node runs the bootstrap.
if (!process.versions.bun && process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || process.argv[2] !== "--install") {
    throw new Error("Usage: node script/kilocode/bun.ts --install")
  }
  const output = process.env.GITHUB_PATH
  if (!output) throw new Error("GITHUB_PATH is required for --install")
  const report = process.platform === "linux" ? process.report.getReport() : undefined
  const header = report && typeof report === "object" && "header" in report ? report.header : undefined
  const abi = header && typeof header === "object" && !("glibcVersionRuntime" in header) ? "musl" : undefined
  const file = await stage({
    os: process.platform,
    arch: process.arch,
    abi,
    ...(process.arch === "x64" ? { avx2: false } : {}),
  })
  const check = await run(file, ["--print", "Bun.version + '/' + Bun.revision"], { windowsHide: true })
  if (check.stdout.trim() !== `${pin.runtime}/${pin.revision}`) throw new Error("Bun runtime or revision mismatch")
  await link(file, join(dirname(file), process.platform === "win32" ? "bunx.exe" : "bunx"))
  console.log((await run(file, ["--revision"], { windowsHide: true })).stdout.trim())
  const bin = (await run(file, ["pm", "bin", "-g"], { windowsHide: true })).stdout.trim()
  // Actions prepends the last entry first, keeping the pinned runtime ahead of global tools.
  await appendFile(output, `${bin}\n${dirname(file)}\n`)
  // Later GitHub Actions steps need this executable after the installer exits.
  dirs.delete(dirname(file))
  console.log(file)
}
