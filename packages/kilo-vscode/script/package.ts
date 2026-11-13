#!/usr/bin/env bun
// Builds one platform's VSIX. The extension starts the bundled `bin/kilo2`, so the matching
// executable and its sandbox helpers from packages/kilo-cli/dist are copied next to the FFmpeg
// helper before packaging.
// Usage: bun run package [-- --target=<vscode-target>]
// KILO_VSCODE_VERSION stamps the VSIX version. KILO_VSCODE_PRE_RELEASE=true marks it as a pre-release.
import { chmodSync, existsSync } from "node:fs"
import { cp, mkdir, readdir, rm } from "node:fs/promises"
import path from "node:path"

export const root = path.resolve(import.meta.dir, "..")
const cli = path.resolve(root, "..", "kilo-cli", "dist")
const out = path.join(root, "out")
const bin = path.join(root, "bin")

const targets = {
  "linux-x64": { dist: "cli-linux-x64", binary: "kilo2" },
  "linux-arm64": { dist: "cli-linux-arm64", binary: "kilo2" },
  "alpine-x64": { dist: "cli-linux-x64-musl", binary: "kilo2" },
  "alpine-arm64": { dist: "cli-linux-arm64-musl", binary: "kilo2" },
  "darwin-x64": { dist: "cli-darwin-x64", binary: "kilo2" },
  "darwin-arm64": { dist: "cli-darwin-arm64", binary: "kilo2" },
  "win32-x64": { dist: "cli-windows-x64", binary: "kilo2.exe" },
  "win32-arm64": { dist: "cli-windows-arm64", binary: "kilo2.exe" },
}

export type Target = keyof typeof targets

export function resolveTarget(requested?: string): Target {
  const target = (requested ?? `${process.platform}-${process.arch}`) as Target
  if (!targets[target]) throw new Error(`Unknown target ${target}. Use one of: ${Object.keys(targets).join(", ")}`)
  return target
}

/** The built CLI bin directory the package copies into `bin/`. */
export function cliBin(target: Target): string {
  return path.join(cli, targets[target].dist, "bin")
}

/** The built CLI executable the package copies into `bin/`. */
export function binary(target: Target): string {
  return path.join(cliBin(target), targets[target].binary)
}

/** Builds the production extension and places the matching CLI binary and helpers in `bin/`. */
export async function prepare(target: Target): Promise<void> {
  const config = targets[target]
  const source = binary(target)
  if (!existsSync(source))
    throw new Error(
      `The ${target} CLI binary is missing at ${source}. Build it first: bun run --cwd packages/kilo-cli script/build.ts --target=${config.dist.replace(/^cli-/, "opencode-")}`,
    )

  await rm(bin, { recursive: true, force: true })
  await mkdir(bin, { recursive: true })

  console.log(`Building the ${target} extension`)
  const build = Bun.spawn([process.execPath, path.join(root, "script", "build.ts"), "--production"], {
    cwd: root,
    env: { ...process.env, KILO_VSCODE_TARGET: target },
    stdout: "inherit",
    stderr: "inherit",
  })
  if ((await build.exited) !== 0) throw new Error("Extension build failed")

  // The CLI bin also carries the sandbox worker, relay, seccomp helper and bundled Bubblewrap. Copy
  // the whole directory, not only the executable, and keep the FFmpeg helper the build placed there.
  const sourceBin = cliBin(target)
  for (const entry of await readdir(sourceBin)) {
    await cp(path.join(sourceBin, entry), path.join(bin, entry), { recursive: true, force: true })
  }
  if (!target.startsWith("win32")) {
    for (const name of ["kilo2", "bwrap", "kilo-sandbox-seccomp"]) {
      const file = path.join(bin, name)
      if (existsSync(file)) chmodSync(file, 0o755)
    }
  }
}

/** Packages the prepared build for one VS Code target. */
export async function packageTarget(
  target: Target,
  options: { version?: string; preRelease?: boolean } = {},
): Promise<string> {
  const pkg = (await Bun.file(path.join(root, "package.json")).json()) as { version: string }
  const version = options.version ?? process.env.KILO_VSCODE_VERSION ?? pkg.version
  const preRelease = options.preRelease ?? process.env.KILO_VSCODE_PRE_RELEASE === "true"

  await mkdir(out, { recursive: true })
  const output = path.join(out, `kilo-vscode-${target}.vsix`)
  console.log(`Packaging ${output} as ${version}${preRelease ? " (pre-release)" : ""}`)

  const { createVSIX } = await import("@vscode/vsce")
  await createVSIX({
    cwd: root,
    packagePath: output,
    version,
    target,
    preRelease,
    updatePackageJson: false,
    dependencies: false,
    skipLicense: true,
  })
  return output
}

async function main() {
  const requested = Bun.argv.find((arg) => arg.startsWith("--target="))?.slice("--target=".length)
  const target = resolveTarget(requested)
  await prepare(target)
  await packageTarget(target)
}

if (import.meta.main) await main()
