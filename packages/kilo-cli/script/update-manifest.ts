#!/usr/bin/env bun
import { createHash } from "node:crypto"
import { lstat, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { parseArgs } from "node:util"
import { digestDirectoryTree } from "../src/updater"

const options = parseArgs({
  args: process.argv.slice(2),
  options: {
    artifact: { type: "string" },
    channel: { type: "string", default: "kilo2-internal" },
    version: { type: "string" },
    "build-id": { type: "string" },
    platform: { type: "string", default: `${process.platform}-${process.arch}` },
    url: { type: "string" },
    out: { type: "string" },
    help: { type: "boolean", short: "h" },
  },
  allowPositionals: true,
})

if (options.values.help) {
  console.log(`Usage: update-manifest --artifact <file-or-dir> [options]

Options:
  --artifact <path>     Portable build's app/ directory (archive updates are unsupported)
  --channel <name>      Target channel (default: kilo2-internal)
  --version <version>   Semantic build version (e.g. 0.1.0-internal+sha)
  --build-id <id>       Unique build identifier
  --platform <name>     Target platform (default: current host platform-arch)
  --url <download-url>  Download URL or file:// URI where artifact is hosted
  --out <path>          Output path for manifest.json (defaults to stdout)
`)
  process.exit(0)
}

const artifactPath = options.values.artifact ?? options.positionals[0]
if (!artifactPath) {
  console.error("Error: --artifact is required")
  process.exit(1)
}

const resolvedPath = path.resolve(artifactPath)
const stat = await lstat(resolvedPath).catch(() => undefined)
if (!stat) {
  console.error(`Error: artifact path not found: ${resolvedPath}`)
  process.exit(1)
}

let sha256: string
let sizeBytes: number
let format: "directory" | "tar.gz"

if (stat.isDirectory()) {
  const tree = await digestDirectoryTree(resolvedPath)
  sha256 = tree.sha256
  sizeBytes = tree.totalBytes
  format = "directory"
} else if (stat.isFile()) {
  const buffer = await readFile(resolvedPath)
  sha256 = createHash("sha256").update(buffer).digest("hex")
  sizeBytes = buffer.length
  format = resolvedPath.endsWith(".tar.gz") || resolvedPath.endsWith(".tgz") ? "tar.gz" : "directory"
} else {
  console.error(`Error: artifact must be a directory or file: ${resolvedPath}`)
  process.exit(1)
}

let gitSha = "dev"
try {
  const gitChild = Bun.spawn(["git", "rev-parse", "--short", "HEAD"], {
    stdout: "pipe",
    stderr: "ignore",
  })
  const text = (await new Response(gitChild.stdout).text()).trim()
  if (text) gitSha = text
} catch {
  // Git unavailable
}

const version = options.values.version ?? `0.1.0-internal+${gitSha}`
const buildId = options.values["build-id"] ?? `build-${Date.now()}-${gitSha}`
const channel = options.values.channel ?? "kilo2-internal"
const platform = options.values.platform ?? `${process.platform}-${process.arch}`
const url = options.values.url ?? (format === "directory" ? `file://${resolvedPath}` : `http://localhost:3000/kilo2-${version}-${platform}.tar.gz`)

const manifest = {
  channel,
  version,
  buildId,
  platform,
  sha256,
  sizeBytes,
  url,
  releaseDate: new Date().toISOString(),
  format,
}

const json = JSON.stringify(manifest, null, 2) + "\n"
if (options.values.out) {
  await writeFile(path.resolve(options.values.out), json, "utf8")
  console.log(`Wrote update manifest to ${options.values.out}`)
} else {
  process.stdout.write(json)
}
