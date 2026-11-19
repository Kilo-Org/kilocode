import { createHash } from "node:crypto"
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import os from "node:os"
import path from "node:path"
import { root, target, version } from "../src/nono-binary"

// A standalone run has no host to provide the app directory, and the host always resolves `kilo2`, so staging
// must target the same directory even when the shell carries another value.
process.env.OPENCODE_APP_DIR_NAME = "kilo2"

// `bun dev` isolates XDG_STATE_HOME under its dev profile (script/dev-isolated.ts), and that launcher is the only
// source host that can select the nono backend, so staging defaults to the same root. KILO_NONO_STATE wins.
const dev = path.resolve(import.meta.dir, "../../kilo-cli/.kilo-v2-dev")
process.env.KILO_NONO_STATE ??= path.join(process.env.KILO_V2_PROFILE ?? dev, "state", "kilo2", "sandbox")

interface Entry {
  readonly tag: string
  readonly asset: string
  readonly url: string
  /** Digest of the downloaded archive, checked before unpacking. */
  readonly sha256: string
  /** Digest of the extracted executable, checked at runtime and before staging. */
  readonly binary_sha256: string
  /** The archive does not carry a license file, so the tag's LICENSE is pinned separately. */
  readonly license_url: string
  readonly license_sha256: string
}

interface Manifest {
  readonly targets: Record<string, Entry>
}

const file = path.join(import.meta.dir, "nono-manifest.json")

function manifest(): Manifest {
  if (!existsSync(file)) return { targets: {} }
  return JSON.parse(readFileSync(file, "utf8")) as Manifest
}

function platform() {
  const name = target()
  if (!name) throw new Error(`No nono release target for ${process.platform} ${process.arch}`)
  return name
}

async function release(tag: string) {
  const response = await fetch(`https://api.github.com/repos/nolabs-ai/nono/releases/tags/${tag}`, {
    headers: { accept: "application/vnd.github+json" },
  })
  if (!response.ok) throw new Error(`Could not read release ${tag}: ${response.status} ${response.statusText}`)
  return (await response.json()) as {
    tag_name: string
    assets: Array<{ name: string; browser_download_url: string }>
  }
}

async function download(url: string, into: string) {
  const response = await fetch(url, { redirect: "follow" })
  if (!response.ok) throw new Error(`Could not download ${url}: ${response.status} ${response.statusText}`)
  const body = new Uint8Array(await response.arrayBuffer())
  writeFileSync(into, body)
  return createHash("sha256").update(body).digest("hex")
}

function extract(archive: string, into: string) {
  const result = Bun.spawnSync({ cmd: ["tar", "-xzf", archive, "-C", into], stdout: "pipe", stderr: "pipe" })
  if (result.exitCode !== 0) throw new Error(`Could not unpack ${archive}: ${result.stderr.toString()}`)
  const found = readdirSync(into, { recursive: true, encoding: "utf8" })
    .map((entry) => path.join(into, entry))
    .find((entry) => path.basename(entry) === "nono")
  if (!found) throw new Error(`${archive} did not contain a nono binary`)
  return found
}

async function record(tag: string, name: string) {
  const info = await release(tag)
  // The filter accepts only the archive this script can unpack, and the pick is stable if a release ever
  // publishes a second asset containing the same target.
  const assets = info.assets
    .filter((candidate) => candidate.name.includes(name) && candidate.name.endsWith(".tar.gz"))
    .sort((left, right) => left.name.localeCompare(right.name))
  const asset = assets.find((candidate) => candidate.name === `nono-${name}.tar.gz`) ?? assets[0]
  if (!asset) throw new Error(`Release ${tag} has no asset for ${name}`)
  const dir = mkdtempSync(path.join(os.tmpdir(), "kilo-nono-pin-"))
  try {
    const archive = path.join(dir, asset.name)
    const sha256 = await download(asset.browser_download_url, archive)
    const unpacked = path.join(dir, "unpacked")
    mkdirSync(unpacked)
    const binary = extract(archive, unpacked)
    const binary_sha256 = createHash("sha256").update(readFileSync(binary)).digest("hex")
    const license_url = `https://raw.githubusercontent.com/nolabs-ai/nono/${tag}/LICENSE`
    const license_sha256 = await download(license_url, path.join(dir, "LICENSE"))
    const next = {
      ...manifest(),
      targets: {
        ...manifest().targets,
        [name]: {
          tag,
          asset: asset.name,
          url: asset.browser_download_url,
          sha256,
          binary_sha256,
          license_url,
          license_sha256,
        },
      },
    }
    writeFileSync(file, JSON.stringify(next, null, 2) + "\n")
    console.log(`${name}: ${asset.name} archive=${sha256} binary=${binary_sha256}`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

async function stage(name: string) {
  const entry = manifest().targets[name]
  if (!entry) {
    throw new Error(
      `No pin recorded for ${name}. Run \`bun run nono:pin --record --tag v${version} --target ${name}\` once and commit ${path.basename(file)}.`,
    )
  }
  if (entry.tag !== `v${version}`) throw new Error(`Recorded pin is ${entry.tag}, but this build expects v${version}`)
  if (!entry.binary_sha256) throw new Error(`Pin for ${name} has no binary digest; re-record it`)
  if (!entry.license_sha256) throw new Error(`Pin for ${name} has no license digest; re-record it`)
  const dir = mkdtempSync(path.join(os.tmpdir(), "kilo-nono-pin-"))
  try {
    const archive = path.join(dir, entry.asset)
    const sha256 = await download(entry.url, archive)
    if (sha256 !== entry.sha256)
      throw new Error(`Checksum mismatch for ${entry.asset}: expected ${entry.sha256}, got ${sha256}`)
    const unpacked = path.join(dir, "unpacked")
    mkdirSync(unpacked)
    const binary = extract(archive, unpacked)
    const binary_sha256 = createHash("sha256").update(readFileSync(binary)).digest("hex")
    if (binary_sha256 !== entry.binary_sha256) {
      throw new Error(`Binary mismatch for ${entry.asset}: expected ${entry.binary_sha256}, got ${binary_sha256}`)
    }
    const destination = path.join(root(), "bin", "nono", version)
    mkdirSync(destination, { recursive: true, mode: 0o700 })
    copyFileSync(binary, path.join(destination, "nono"))
    chmodSync(path.join(destination, "nono"), 0o755)
    console.log(`Staged ${path.join(destination, "nono")} from ${entry.tag}`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const args = process.argv.slice(2)
let tag = `v${version}`
// Resolved after the flags: `--target` must work on a host whose own platform has no nono target.
let name = ""
let record_ = false

while (args.length > 0) {
  const arg = args.shift()!
  if (arg === "--record") record_ = true
  else if (arg === "--stage") record_ = false
  else if (arg === "--tag") tag = args.shift() ?? tag
  else if (arg === "--target") name = args.shift() ?? name
  else throw new Error(`Unknown argument ${arg}`)
}

try {
  const selected = name || platform()
  if (record_) await record(tag, selected)
  else await stage(selected)
} catch (cause) {
  console.error(cause instanceof Error ? cause.message : cause)
  process.exit(1)
}
