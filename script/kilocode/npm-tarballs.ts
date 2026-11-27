import { createReadStream } from "node:fs"
import { readdir } from "node:fs/promises"
import { createHash } from "node:crypto"
import path from "node:path"
import { isPreview } from "../../packages/kilo-cli/src/update-version"
import { ClientManifest } from "./client-manifest"

// The full build must supply exactly these optional dependencies, even when a target isn't runnable on the producer.
const targets = [
  "darwin-arm64",
  "darwin-x64",
  "darwin-x64-baseline",
  "linux-arm64",
  "linux-arm64-musl",
  "linux-x64",
  "linux-x64-baseline",
  "linux-x64-musl",
  "linux-x64-baseline-musl",
  "windows-arm64",
  "windows-x64",
  "windows-x64-baseline",
]
export const platforms = targets.map((target) => `@kilocode/cli-${target}`)
export const launcher = "@kilocode/cli"
export const clients = ClientManifest.packages.map((name) => `@kilocode/${name}`)
export const tag = "kilo-v2"

export const filename = (name: string, version: string) => `${name.slice(1).replace("/", "-")}-${version}.tgz`

async function inventory(dir: string, version: string) {
  if (!isPreview(version)) throw new Error(`Expected a v2 preview version, got ${version}`)
  const names = [...platforms, launcher, ...clients]
  const files = await readdir(dir, { withFileTypes: true })
  const expected = new Set(names.map((name) => filename(name, version)))
  for (const file of files) {
    if (!file.isFile() || !expected.delete(file.name)) throw new Error(`Unexpected npm artifact: ${file.name}`)
  }
  if (expected.size) throw new Error(`Missing npm artifact: ${[...expected].join(", ")}`)
  return Promise.all(
    names.map(async (name) => {
      const file = filename(name, version)
      const hash = createHash("sha512")
      for await (const chunk of createReadStream(path.join(dir, file))) hash.update(chunk)
      return { name, version, file, integrity: `sha512-${hash.digest("base64")}` }
    }),
  )
}

// Only the producer interprets tarball contents. Consumers compare all compressed bytes to this job output.
export async function record(dir: string, version: string) {
  const entries = await inventory(dir, version)
  for (const entry of entries) {
    const files = await new Bun.Archive(await Bun.file(path.join(dir, entry.file)).bytes()).files([
      "package/package.json",
      "./package/package.json",
    ])
    const pkg = files.get("package/package.json") ?? files.get("./package/package.json")
    if (!pkg) throw new Error(`Missing package/package.json inside ${entry.file}`)
    const manifest = JSON.parse(await pkg.text())
    if (manifest.name !== entry.name || manifest.version !== version)
      throw new Error(`Expected ${entry.name}@${version} inside ${entry.file}`)
  }
  return entries
}

export async function verify(dir: string, version: string, expected: string | undefined) {
  const entries = await inventory(dir, version)
  if (JSON.stringify(entries) !== expected) throw new Error("npm tarballs do not match the build job's inventory")
  return entries
}

if (import.meta.main) console.log(JSON.stringify(await record(Bun.argv[2], Bun.argv[3])))
