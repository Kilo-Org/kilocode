import { createHash } from "node:crypto"
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import os from "node:os"
import path from "node:path"

interface Entry {
  readonly tag: string
  readonly asset: string
  readonly url: string
  readonly sha256: string
  readonly binary_sha256: string
  readonly license_url: string
  readonly license_sha256: string
}

interface Manifest {
  readonly targets: Record<string, Entry>
}

const manifest = path.resolve(import.meta.dirname, "../../../kilo-sandbox/script/nono-manifest.json")
const cache = process.env.KILO_NONO_CACHE ?? path.join(os.tmpdir(), "kilo-nono")

function target(osName: string, arch: "arm64" | "x64") {
  if (osName !== "darwin") return undefined
  return `${arch === "arm64" ? "aarch64" : "x86_64"}-apple-darwin`
}

function sha256(file: string) {
  return createHash("sha256").update(readFileSync(file)).digest("hex")
}

function listing(dir: string) {
  return readdirSync(dir, { recursive: true, encoding: "utf8" }).map((entry) => path.join(dir, entry))
}

/** A status GitHub answers for a transient condition, not for a missing asset. */
function retryable(status: number) {
  return status === 408 || status === 429 || status >= 500
}

/** One attempt, bounded so a stalled connection reaches the retry path instead of hanging the build. */
const request = (url: string) => fetch(url, { redirect: "follow", signal: AbortSignal.timeout(60_000) })

/** A cold build downloads straight from GitHub, so a transient failure must not fail it. */
export async function fetchRetry(url: string, fetcher: (url: string) => Promise<Response> = request) {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetcher(url)
      if (!retryable(response.status) || attempt === 3) return response
    } catch (cause) {
      if (attempt === 3) throw cause
    }
    await Bun.sleep(500 * attempt)
  }
}

async function download(url: string, file: string) {
  const response = await fetchRetry(url)
  if (!response.ok) throw new Error(`Could not download ${url}: ${response.status} ${response.statusText}`)
  writeFileSync(file, new Uint8Array(await response.arrayBuffer()))
}

export interface StagedNono {
  readonly version: string
  readonly digest: string
}

/** Stages the pinned nono executable and its license next to the packaged binary. */
export async function stageNono(osName: string, arch: "arm64" | "x64", dir: string): Promise<StagedNono | undefined> {
  const name = target(osName, arch)
  if (!name) return undefined
  const entry = (JSON.parse(readFileSync(manifest, "utf8")) as Manifest).targets[name]
  if (!entry) {
    throw new Error(
      `No nono pin for ${name}; record it with bun run --cwd packages/kilo-sandbox nono:pin --record --target ${name}`,
    )
  }
  const work = path.join(cache, entry.tag, name)
  mkdirSync(work, { recursive: true })
  const archive = path.join(work, entry.asset)
  if (!existsSync(archive) || sha256(archive) !== entry.sha256) {
    await download(entry.url, archive)
    if (sha256(archive) !== entry.sha256) throw new Error(`Checksum mismatch for ${entry.asset}`)
  }
  const unpacked = path.join(work, "unpacked")
  rmSync(unpacked, { recursive: true, force: true })
  mkdirSync(unpacked, { recursive: true })
  const tar = Bun.spawnSync({ cmd: ["tar", "-xzf", archive, "-C", unpacked], stdout: "pipe", stderr: "pipe" })
  if (tar.exitCode !== 0) throw new Error(`Could not unpack ${entry.asset}: ${tar.stderr.toString()}`)
  const files = listing(unpacked)
  const binary = files.find((file) => path.basename(file) === "nono")
  if (!binary) throw new Error(`${entry.asset} did not contain a nono binary`)
  if (sha256(binary) !== entry.binary_sha256) throw new Error(`Binary mismatch for ${entry.asset}`)
  const license = path.join(work, "LICENSE")
  if (!existsSync(license) || sha256(license) !== entry.license_sha256) {
    await download(entry.license_url, license)
    if (sha256(license) !== entry.license_sha256) throw new Error(`License mismatch for ${entry.tag}`)
  }
  mkdirSync(dir, { recursive: true })
  copyFileSync(binary, path.join(dir, "nono"))
  chmodSync(path.join(dir, "nono"), 0o755)
  const licenses = path.join(dir, "licenses", "nono")
  mkdirSync(licenses, { recursive: true })
  copyFileSync(license, path.join(licenses, "LICENSE"))
  writeFileSync(
    path.join(licenses, "NOTICE"),
    [
      `nono ${entry.tag}`,
      "",
      "SPDX-License-Identifier: Apache-2.0",
      `Source: https://github.com/nolabs-ai/nono/tree/${entry.tag}`,
      "",
      "Kilo distributes nono as a separate executable. The complete license text is in LICENSE.",
      "",
    ].join("\n"),
  )
  return { version: entry.tag.replace(/^v/, ""), digest: entry.binary_sha256 }
}
