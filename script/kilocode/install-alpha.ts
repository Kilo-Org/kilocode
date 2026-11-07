#!/usr/bin/env bun

/**
 * `bun run install:alpha`: installs the CLI binary that the newest successful `kilo-v2` run on the `v2`
 * branch built (.github/workflows/kilo-v2.yml, `build` job), for local dogfooding.
 *
 * macOS arm64 only for now. Requires an authenticated `gh`. The binary is installed as `kilo2`
 * (override with KILO_ALPHA_BIN_DIR / KILO_ALPHA_NAME) so it never replaces an installed `kilo`.
 */

import { $ } from "bun"
import { chmod, cp, mkdir, mkdtemp, rename, rm, symlink } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const repo = "Kilo-Org/kilocode"
const workflow = "kilo-v2.yml"
const branch = "v2"
const target = "darwin-arm64"
const artifact = `kilo-v2-cli-${target}.tar.gz`
const binDir = process.env.KILO_ALPHA_BIN_DIR ?? path.join(os.homedir(), ".local", "bin")
const name = process.env.KILO_ALPHA_NAME ?? "kilo2"

class InstallError extends Error {}

if (import.meta.main) {
  try {
    await main()
  } catch (error) {
    if (!(error instanceof InstallError)) throw error
    console.error(`install:alpha: ${error.message}`)
    process.exitCode = 1
  }
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

  const dest = await installFiles(path.join(tmp, `cli-${target}`, "bin"), binDir, name)
  const version = await $`${dest} --version`.quiet().nothrow()
  if (version.exitCode !== 0) fail(`Installed ${dest}, but it failed to start:\n${version.stderr.toString().trim()}`)
  console.error(`installed ${dest} (${version.stdout.toString().trim()})`)
  if (!process.env.PATH?.split(path.delimiter).includes(binDir)) console.error(`note: ${binDir} is not on your PATH`)
}

export async function installFiles(bin: string, binDir: string, name: string) {
  if (!(await Bun.file(path.join(bin, "kilo2")).exists())) fail(`No kilo2 executable found in ${bin}.`)
  const dest = path.resolve(binDir, name)
  const data = path.join(path.dirname(dest), `.${path.basename(dest)}-alpha`)
  await mkdir(data, { recursive: true })
  const release = await mkdtemp(path.join(data, "release-"))
  try {
    await cp(bin, release, { recursive: true })
    const executable = path.join(release, "kilo2")
    await chmod(executable, 0o755)
    await $`xattr -d com.apple.quarantine ${executable}`.quiet().nothrow()
    const link = path.join(release, "link")
    await symlink(executable, link)
    await rename(link, dest)
  } catch (error) {
    await rm(release, { recursive: true, force: true })
    throw error
  }
  return dest
}

function fail(message: string): never {
  throw new InstallError(message)
}
