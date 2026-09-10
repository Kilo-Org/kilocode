import { cp, lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { parseArgs } from "node:util"

export interface PackageOptions {
  readonly out?: string
  readonly cwd?: string
  readonly vsceBin?: string
}

export interface PackageResult {
  readonly vsixPath: string
  readonly sizeBytes: number
  readonly fileCount: number
  readonly version: string
}

export interface VsixValidationResult {
  readonly valid: boolean
  readonly fileCount: number
  readonly entries: string[]
  readonly packageJson: Record<string, unknown>
}

export function findVsceBinary(customPath?: string): string {
  if (customPath && existsSync(customPath)) {
    return path.resolve(customPath)
  }
  if (process.env.VSCE_BIN && existsSync(process.env.VSCE_BIN)) {
    return path.resolve(process.env.VSCE_BIN)
  }

  const scriptDir = path.dirname(fileURLToPath(import.meta.url))
  const vscodeRoot = path.resolve(scriptDir, "..")
  const repoRoot = path.resolve(vscodeRoot, "../..")

  const candidates = [
    path.join(vscodeRoot, "node_modules/.bin/vsce"),
    path.resolve(repoRoot, "../kilocode/packages/kilo-vscode/node_modules/.bin/vsce"),
    path.resolve(repoRoot, "../kilocode/node_modules/.bin/vsce"),
  ]

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return path.resolve(candidate)
    }
  }

  const onPath = Bun.which("vsce")
  if (onPath) return onPath

  throw new Error("Unable to locate @vscode/vsce binary. Specify VSCE_BIN env or ensure vsce is installed.")
}

export function sanitizePackageJson(rawJson: Record<string, unknown>): Record<string, unknown> {
  const sanitized = { ...rawJson }

  delete sanitized.private
  delete sanitized.devDependencies
  delete sanitized.scripts
  delete sanitized.dependencies

  if (!sanitized.repository) {
    sanitized.repository = {
      type: "git",
      url: "https://github.com/Kilo-Org/kilocode.git",
      directory: "packages/kilo-vscode",
    }
  }

  return sanitized
}

export async function listVsixEntries(vsixPath: string): Promise<string[]> {
  const child = Bun.spawn(["zipinfo", "-1", vsixPath], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })

  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])

  if (exitCode !== 0) {
    throw new Error(`Failed to list VSIX entries: ${stderr.trim() || `exit code ${exitCode}`}`)
  }

  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
}

export async function readVsixPackageJson(vsixPath: string): Promise<Record<string, unknown>> {
  const child = Bun.spawn(["unzip", "-p", vsixPath, "extension/package.json"], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })

  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])

  if (exitCode !== 0) {
    throw new Error(`Failed to read extension/package.json from VSIX: ${stderr.trim() || `exit code ${exitCode}`}`)
  }

  return JSON.parse(stdout) as Record<string, unknown>
}

export async function validateVsix(vsixPath: string): Promise<VsixValidationResult> {
  const stat = await lstat(vsixPath).catch(() => undefined)
  if (!stat || !stat.isFile() || stat.size === 0) {
    throw new Error(`VSIX file not found or empty: ${vsixPath}`)
  }

  const entries = await listVsixEntries(vsixPath)

  const requiredEntries = [
    "extension/package.json",
    "extension/dist/extension.cjs",
    "extension/dist/webview.js",
    "extension/dist/webview.css",
    "extension/dist/agent-manager.js",
    "extension/dist/tree-sitter.wasm",
    "extension/assets/kilo.svg",
    "extension.vsixmanifest",
  ]

  for (const req of requiredEntries) {
    if (!entries.includes(req)) {
      throw new Error(`VSIX package is missing required entry: ${req}`)
    }
  }

  const forbiddenPrefixes = [
    "extension/src/",
    "extension/web/",
    "extension/dist/web/",
    "extension/webview-ui/",
    "extension/test/",
    "extension/script/",
  ]

  for (const entry of entries) {
    if (forbiddenPrefixes.some((p) => entry.startsWith(p))) {
      throw new Error(`VSIX package contains forbidden development entry: ${entry}`)
    }
    if (entry.startsWith("extension/tsconfig") || entry.startsWith("extension/vite.config")) {
      throw new Error(`VSIX package contains forbidden tooling entry: ${entry}`)
    }
  }

  const pkg = await readVsixPackageJson(vsixPath)
  const deps = (pkg.dependencies ?? {}) as Record<string, string>
  for (const [dep, ver] of Object.entries(deps)) {
    if (typeof ver === "string" && (ver.startsWith("workspace:") || ver.startsWith("catalog:"))) {
      throw new Error(`VSIX package manifest leaks unresolvable dependency: ${dep}: ${ver}`)
    }
  }

  return {
    valid: true,
    fileCount: entries.length,
    entries,
    packageJson: pkg,
  }
}

export async function packageExtension(options: PackageOptions = {}): Promise<PackageResult> {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url))
  const vscodeRoot = options.cwd ? path.resolve(options.cwd) : path.resolve(scriptDir, "..")
  const repoRoot = path.resolve(vscodeRoot, "../..")

  const extensionCjs = path.join(vscodeRoot, "dist/extension.cjs")
  const webIndexHtml = path.join(vscodeRoot, "dist/webview.js")
  const readmeMd = path.join(vscodeRoot, "README.md")
  const rawPackageJsonPath = path.join(vscodeRoot, "package.json")

  if (!existsSync(extensionCjs)) {
    throw new Error(`Built extension binary not found: ${extensionCjs}`)
  }
  if (!existsSync(webIndexHtml)) {
    throw new Error(`Built webview assets not found: ${webIndexHtml}`)
  }
  if (!existsSync(rawPackageJsonPath)) {
    throw new Error(`package.json not found: ${rawPackageJsonPath}`)
  }

  const vsceBin = findVsceBinary(options.vsceBin)

  const rawPkgContent = await readFile(rawPackageJsonPath, "utf8")
  const rawPkg = JSON.parse(rawPkgContent) as Record<string, unknown>
  const version = String(rawPkg.version ?? "0.0.1")
  const pkgName = String(rawPkg.name ?? "kilo-code-v2-preview")
  const sanitizedPkg = sanitizePackageJson(rawPkg)

  const defaultOutDir = path.join(vscodeRoot, "dist")
  await mkdir(defaultOutDir, { recursive: true })
  const defaultOutPath = path.join(defaultOutDir, `${pkgName}-${version}.vsix`)
  const targetVsixPath = options.out ? path.resolve(options.out) : defaultOutPath
  await mkdir(path.dirname(targetVsixPath), { recursive: true })

  const stageDir = path.join(vscodeRoot, `.vsix-stage-${randomUUID()}`)
  await mkdir(stageDir, { recursive: true })

  try {
    await writeFile(path.join(stageDir, "package.json"), JSON.stringify(sanitizedPkg, null, 2) + "\n", "utf8")

    if (existsSync(readmeMd)) {
      await cp(readmeMd, path.join(stageDir, "README.md"))
    }

    const candidateLicenses = [path.join(vscodeRoot, "LICENSE"), path.join(repoRoot, "LICENSE")]
    let licensePath: string | undefined
    for (const lic of candidateLicenses) {
      if (existsSync(lic)) {
        licensePath = lic
        break
      }
    }
    if (!licensePath) {
      throw new Error("LICENSE file not found in package root or repository root")
    }
    await cp(licensePath, path.join(stageDir, "LICENSE"))

    const assetsDir = path.join(vscodeRoot, "assets")
    if (existsSync(assetsDir)) {
      await cp(assetsDir, path.join(stageDir, "assets"), { recursive: true })
    }

    const stageDist = path.join(stageDir, "dist")
    await mkdir(stageDist, { recursive: true })
    await cp(path.join(vscodeRoot, "dist"), stageDist, {
      recursive: true,
      filter: (source) => {
        const name = path.basename(source)
        return name !== "web" && !name.endsWith(".map") && !name.endsWith(".vsix") && !name.endsWith("-host.cjs")
      },
    })
    if (existsSync(path.join(vscodeRoot, "audio-wav"))) {
      await cp(path.join(vscodeRoot, "audio-wav"), path.join(stageDir, "audio-wav"), { recursive: true })
    }

    const vscodeIgnorePath = path.join(vscodeRoot, ".vscodeignore")
    if (existsSync(vscodeIgnorePath)) {
      await cp(vscodeIgnorePath, path.join(stageDir, ".vscodeignore"))
    } else {
      await writeFile(path.join(stageDir, ".vscodeignore"), `.vscodeignore\n**/*.map\n`, "utf8")
    }

    const vsceChild = Bun.spawn(
      [vsceBin, "package", "--no-dependencies", "--allow-missing-repository", "-o", targetVsixPath],
      {
        cwd: stageDir,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      },
    )

    const [exitCode, stdout, stderr] = await Promise.all([
      vsceChild.exited,
      new Response(vsceChild.stdout).text(),
      new Response(vsceChild.stderr).text(),
    ])

    if (exitCode !== 0) {
      throw new Error(`vsce package failed with exit code ${exitCode}:\n${stderr || stdout}`)
    }

    const validation = await validateVsix(targetVsixPath)
    const vsixStat = await lstat(targetVsixPath)

    return {
      vsixPath: targetVsixPath,
      sizeBytes: vsixStat.size,
      fileCount: validation.fileCount,
      version,
    }
  } finally {
    await rm(stageDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

if (import.meta.main) {
  const parsed = parseArgs({
    args: process.argv.slice(2),
    options: {
      out: { type: "string", short: "o" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  })

  if (parsed.values.help) {
    console.log(`Usage: bun script/package.ts [options]

Options:
  -o, --out <path>    Output path for the generated .vsix package
  -h, --help          Show this help message
`)
    process.exit(0)
  }

  const out = parsed.values.out ?? parsed.positionals[0]

  try {
    const result = await packageExtension({ out })
    console.log(`\nSuccessfully packaged VSIX:`)
    console.log(`  Path:       ${result.vsixPath}`)
    console.log(`  Version:    ${result.version}`)
    console.log(`  Size:       ${(result.sizeBytes / (1024 * 1024)).toFixed(2)} MB (${result.sizeBytes} bytes)`)
    console.log(`  Files:      ${result.fileCount}`)
  } catch (err) {
    console.error(`Packaging failed: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }
}
