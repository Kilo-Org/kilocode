#!/usr/bin/env bun
// kilocode_change - new file

/**
 * `bun run install:alpha`: installs the CLI binary that the newest successful `kilo-v2` run on the `v2`
 * branch built (.github/workflows/kilo-v2.yml, `build` job), for local dogfooding.
 *
 * macOS arm64 only for now. Requires an authenticated `gh`. The binary is installed as `kilo-alpha`
 * (override with KILO_ALPHA_BIN_DIR / KILO_ALPHA_NAME) so it never replaces an installed `kilo`.
 */

import { $ } from "bun"
import { chmod, copyFile, mkdir, mkdtemp, readdir, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const repo = "Kilo-Org/kilocode"
const workflow = "kilo-v2.yml"
const branch = "v2"
const target = "darwin-arm64"
const artifact = `kilo-v2-cli-${target}.tar.gz`
const binDir = process.env.KILO_ALPHA_BIN_DIR ?? path.join(os.homedir(), ".local", "bin")
const name = process.env.KILO_ALPHA_NAME ?? "kilo-alpha"

class InstallError extends Error {}

try {
  await main()
} catch (error) {
  if (!(error instanceof InstallError)) throw error
  console.error(`install:alpha: ${error.message}`)
  process.exitCode = 1
}

async function main() {
  if (process.platform !== "darwin" || process.arch !== "arm64")
    fail(`install:alpha only supports macOS arm64 for now (this is ${process.platform} ${process.arch}).`)

  if (!Bun.which("gh"))
    fail("The GitHub CLI (gh) is not installed. Install it from https://cli.github.com and run `gh auth login`.")
  if ((await $`gh auth status`.quiet().nothrow()).exitCode !== 0) fail("gh is not authenticated. Run `gh auth login`.")

  const runs =
    await $`gh run list -R ${repo} --workflow ${workflow} --branch ${branch} --event push --status success --limit 1 --json databaseId,headSha,createdAt`
      .quiet()
      .nothrow()
  if (runs.exitCode !== 0) fail(`Could not list workflow runs:\n${runs.stderr.toString().trim()}`)
  const run = (JSON.parse(runs.stdout.toString()) as { databaseId: number; headSha: string; createdAt: string }[])[0]
  if (!run) fail(`No successful ${workflow} run found on ${branch}.`)
  console.error(`run ${run.databaseId} (${run.headSha.slice(0, 9)}, ${run.createdAt})`)

  const tmp = await mkdtemp(path.join(os.tmpdir(), "kilo-alpha-"))
  try {
    await install(run.databaseId, tmp)
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
}

async function install(runID: number, tmp: string) {
  // The artifact is uploaded unarchived (`archive: false`), so `gh run download` cannot be used: it tries to
  // unzip the raw tarball. The zip endpoint serves the file as uploaded. `gh api` buffers the whole response
  // without progress, so the download goes through curl with the token from gh.
  const archive = path.join(tmp, artifact)
  const found =
    await $`gh api repos/${repo}/actions/runs/${runID}/artifacts --jq ${`.artifacts[] | select(.name == "${artifact}" and (.expired | not)) | .id`}`
      .quiet()
      .nothrow()
  const id = found.stdout.toString().trim()
  if (found.exitCode !== 0 || !id)
    fail(
      `Run ${runID} has no unexpired ${artifact} artifact (they expire after 7 days).\n${found.stderr.toString().trim()}`,
    )
  const token = (await $`gh auth token`.quiet().text()).trim()
  console.log(`Downloading ${artifact} (~60 MB). This may take several minutes...`)
  // Header on stdin keeps the token out of the process list. --retry-all-errors resumes a stalled connection.
  const download =
    await $`curl -fL --retry 5 --retry-all-errors --connect-timeout 20 --speed-time 30 --speed-limit 1000 --progress-bar -H @- -H "Accept: application/vnd.github+json" -o ${archive} https://api.github.com/repos/${repo}/actions/artifacts/${id}/zip < ${new Response(`Authorization: Bearer ${token}`)}`.nothrow()
  if (download.exitCode !== 0) fail(`Could not download ${artifact} (curl exit ${download.exitCode}).`)
  console.log(`Download complete (${((await Bun.file(archive).size) / 1e6).toFixed(1)} MB). Installing...`)

  const extract = await $`tar -xzf ${archive} -C ${tmp}`.quiet().nothrow()
  if (extract.exitCode !== 0) fail(`Could not extract ${artifact}:\n${extract.stderr.toString().trim()}`)

  const bin = path.join(tmp, `cli-${target}`, "bin")
  const [executable] = await readdir(bin)
  if (!executable) fail(`No executable found in ${bin}.`)

  await mkdir(binDir, { recursive: true })
  const dest = path.join(binDir, name)
  await rm(dest, { force: true })
  await copyFile(path.join(bin, executable), dest)
  await chmod(dest, 0o755)
  // Files from a download carry the quarantine attribute; clearing it avoids Gatekeeper blocking the binary.
  await $`xattr -d com.apple.quarantine ${dest}`.quiet().nothrow()

  const version = await $`${dest} --version`.quiet().nothrow()
  if (version.exitCode !== 0) fail(`Installed ${dest}, but it failed to start:\n${version.stderr.toString().trim()}`)
  console.error(`installed ${dest} (${version.stdout.toString().trim()})`)
  if (!process.env.PATH?.split(path.delimiter).includes(binDir)) console.error(`note: ${binDir} is not on your PATH`)
}

function fail(message: string): never {
  throw new InstallError(message)
}
