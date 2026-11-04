#!/usr/bin/env bun
// Builds one platform's VSIX. The extension starts the bundled `bin/kilo2`, so the matching
// executable from packages/kilo-cli/dist is copied next to the FFmpeg helper before packaging.
// Usage: bun run package [-- --target=<vscode-target>]
import { chmodSync, existsSync } from "node:fs"
import { copyFile, mkdir, rm } from "node:fs/promises"
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

/** The built CLI executable the package copies into `bin/`. */
export function binary(target: Target): string {
  const config = targets[target]
  return path.join(cli, config.dist, "bin", config.binary)
}

/** Builds the production extension and places the matching CLI binary in `bin/`. */
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

  const bundled = path.join(bin, config.binary)
  await copyFile(source, bundled)
  if (config.binary !== "kilo2.exe") chmodSync(bundled, 0o755)
}

/** Packages the prepared build for one VS Code target. */
export async function packageTarget(target: Target): Promise<string> {
  const name = process.platform === "win32" ? "vsce.cmd" : "vsce"
  const vsce = [
    path.join(root, "node_modules", ".bin", name),
    path.resolve(root, "..", "..", "node_modules", ".bin", name),
  ].find((file) => existsSync(file))
  if (!vsce) throw new Error("vsce is missing. Run bun install first.")

  await mkdir(out, { recursive: true })
  const output = path.join(out, `kilo-vscode-${target}.vsix`)
  console.log(`Packaging ${output}`)
  const pack = Bun.spawn(
    [vsce, "package", "--target", target, "--no-dependencies", "--skip-license", "--allow-missing-repository", "--out", output],
    { cwd: root, env: { ...process.env, npm_config_ignore_scripts: "true" }, stdout: "inherit", stderr: "inherit" },
  )
  if ((await pack.exited) !== 0) throw new Error("vsce package failed")
  return output
}

async function main() {
  const requested = Bun.argv.find((arg) => arg.startsWith("--target="))?.slice("--target=".length)
  const target = resolveTarget(requested)
  await prepare(target)
  await packageTarget(target)
}

if (import.meta.main) await main()
