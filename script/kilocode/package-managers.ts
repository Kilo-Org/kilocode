// kilocode_change - new file
/**
 * Updates the AUR package `kilo-bin` and the Homebrew formula in Kilo-Org/homebrew-tap for a
 * stable release.
 *
 * Runs in the `package-managers` job of .github/workflows/publish.yml, which holds the AUR key and a
 * Kilo Maintainer app token for homebrew-tap. That job installs no packages, so this script imports
 * only Node built-ins and runs on Node 24 directly:
 *
 *   node script/kilocode/package-managers.ts aur <cli-sbom-evidence.json> <version>
 *   node script/kilocode/package-managers.ts homebrew <cli-sbom-evidence.json> <version>
 *
 * `aur` reads the SSH key path from AUR_KEY_FILE. `homebrew` clones over HTTPS and gets its token from
 * the git credential helper that setup-git-committer registers. Each target is left unchanged when it
 * already has the files of this version, so a re-run pushes nothing new.
 *
 * Both targets refuse to move a recipe backwards: when the clone already publishes a newer version
 * than the one this run publishes, the update is skipped with a warning, or fails when the run
 * publishes the latest GitHub release, because a recipe can only be ahead of an older re-run. The
 * latest release comes from KILO_LATEST_RELEASE, or from the GitHub API with the job's read-only
 * `GITHUB_TOKEN`.
 */

import { execFileSync } from "node:child_process"
import { appendFile, lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { setTimeout as sleep } from "node:timers/promises"

/** The digests of the release archives the recipes download, by release asset name. */
export type Digests = {
  "kilo-linux-arm64.tar.gz": string
  "kilo-linux-x64.tar.gz": string
  "kilo-darwin-x64.zip": string
  "kilo-darwin-arm64.zip": string
}

const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const SHA256 = /^[a-f0-9]{64}$/

export const AUR_REMOTE = "ssh://aur@aur.archlinux.org/kilo-bin.git"
export const TAP_REMOTE = "https://github.com/Kilo-Org/homebrew-tap.git"

/**
 * aur.archlinux.org host keys. Their SHA256 fingerprints match the ones published on
 * https://aur.archlinux.org (Ed25519 RFzBCUItH9LZS0cKB5UE6ceAYhBD5C8GeOBip8Z11+4, ECDSA
 * uTa/0PndEgPZTf76e1DFqXKJEXKsn7m9ivhLQtzGOCI, RSA 5s5cIyReIfNNVGRFdDbe3hdYiI5OelHGpw2rOUud3Q8).
 */
export const AUR_KNOWN_HOSTS = [
  "aur.archlinux.org ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEuBKrPzbawxA/k2g6NcyV5jmqwJ2s+zpgZGZ7tpLIcN",
  "aur.archlinux.org ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBLMiLrP8pVi5BFX2i3vepSUnpedeiewE5XptnUnau+ZoeUOPkpoCgZZuYfpaIQfhhJJI5qgnjJmr4hyJbe/zxow=",
  "aur.archlinux.org ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQDKF9vAFWdgm9Bi8uc+tYRBmXASBb5cB5iZsB7LOWWFeBrLp3r14w0/9S2vozjgqY5sJLDPONWoTTaVTbhe3vwO8CBKZTEt1AcWxuXNlRnk9FliR1/eNB9uz/7y1R0+c1Md+P98AJJSJWKN12nqIDIhjl2S1vOUvm7FNY43fU2knIhEbHybhwWeg+0wxpKwcAd/JeL5i92Uv03MYftOToUijd1pqyVFdJvQFhqD4v3M157jxS5FTOBrccAEjT+zYmFyD8WvKUa9vUclRddNllmBJdy4NyLB8SvVZULUPrP3QOlmzemeKracTlVOUG1wsDbxknF1BwSCU7CmU6UFP90kpWIyz66bP0bl67QAvlIc52Yix7pKJPbw85+zykvnfl2mdROsaT8p8R9nwCdFsBc9IiD0NhPEHcyHRwB8fokXTajk2QnGhL+zP5KnkmXnyQYOCUYo3EKMXIlVOVbPDgRYYT/XqvBuzq5S9rrU70KoI/S5lDnFfx/+lPLdtcnnEPk=",
]

/** The archive digests of `version` from the CLI evidence manifest build-cli recorded. */
export function digests(text: string, version: string): Digests {
  const manifest: unknown = JSON.parse(text)
  const field = (value: unknown, key: string): unknown =>
    typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined
  const found = field(manifest, "version")
  if (found !== version) {
    throw new Error(`The CLI evidence manifest is for version ${JSON.stringify(found)}, not ${JSON.stringify(version)}`)
  }
  const list = field(manifest, "entries")
  const entries: unknown[] = Array.isArray(list) ? list : []
  const pick = (name: keyof Digests) => {
    const matches = entries.filter((entry) => field(entry, "artifact") === name)
    if (matches.length !== 1) throw new Error(`The CLI evidence manifest lists ${name} ${matches.length} times`)
    const sha256 = field(matches[0], "sha256")
    if (typeof sha256 !== "string" || !SHA256.test(sha256)) throw new Error(`Missing archive digest for ${name}`)
    return sha256
  }
  return {
    "kilo-linux-arm64.tar.gz": pick("kilo-linux-arm64.tar.gz"),
    "kilo-linux-x64.tar.gz": pick("kilo-linux-x64.tar.gz"),
    "kilo-darwin-x64.zip": pick("kilo-darwin-x64.zip"),
    "kilo-darwin-arm64.zip": pick("kilo-darwin-arm64.zip"),
  }
}

function split(version: string) {
  if (!VERSION.test(version)) throw new Error(`Invalid release version ${JSON.stringify(version)}`)
  const dash = version.indexOf("-")
  return dash < 0 ? { pkgver: version, subver: "" } : { pkgver: version.slice(0, dash), subver: version.slice(dash) }
}

/** Orders two release versions: the numbers field by field, then `1.2.3` after `1.2.3-rc.1`. */
export function compare(a: string, b: string) {
  const dashA = a.indexOf("-")
  const dashB = b.indexOf("-")
  const x = (dashA < 0 ? a : a.slice(0, dashA)).split(".").map(Number)
  const y = (dashB < 0 ? b : b.slice(0, dashB)).split(".").map(Number)
  for (let i = 0; i < 3; i++) {
    const mine = x[i] ?? 0
    const theirs = y[i] ?? 0
    if (mine !== theirs) return mine - theirs
  }
  const left = dashA < 0 ? "" : a.slice(dashA + 1)
  const right = dashB < 0 ? "" : b.slice(dashB + 1)
  if (left === right) return 0
  if (!left) return 1
  if (!right) return -1
  return left.localeCompare(right, "en", { numeric: true })
}

/** A version read back from a recipe, or undefined unless it is one this script publishes. */
function accepted(value: string | undefined) {
  return value !== undefined && VERSION.test(value) ? value : undefined
}

/** The version a PKGBUILD publishes: `pkgver` with `_subver` appended when it has one. */
export function pkgbuildVersion(text: string | undefined) {
  if (text === undefined) return undefined
  const pkgver = /^[ \t]*pkgver=([^\s]+)$/m.exec(text)?.[1]
  if (pkgver === undefined) return undefined
  const subver = /^[ \t]*_subver=(.*)$/m.exec(text)?.[1] ?? ""
  return accepted(`${pkgver}${subver}`)
}

/**
 * The version a Homebrew formula publishes, taken from its download URLs so a pre-release keeps its
 * suffix; the formula's own `version` line does not carry one.
 */
export function formulaVersion(text: string | undefined) {
  if (text === undefined) return undefined
  const url = /\/releases\/download\/v([^/\s]+)\//.exec(text)?.[1]
  const line = /^[ \t]*version[ \t]+"([^"\n]+)"/m.exec(text)?.[1]
  return accepted(url ?? line)
}

/** The text of a file in the clone, or undefined when the clone has no such file. */
async function cloneText(dir: string, name: string) {
  return await readFile(path.join(dir, name), "utf8").catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") return undefined
    throw err
  })
}

// pkgbuild() and srcinfo() describe the same package: change both together (the .SRCINFO must be
// what `makepkg --printsrcinfo` prints for the PKGBUILD).
export function pkgbuild(version: string, digest: Digests) {
  const { pkgver, subver } = split(version)
  return [
    "# Maintainer: kilo",
    "",
    "pkgname='kilo-bin'",
    `pkgver=${pkgver}`,
    `_subver=${subver}`,
    "options=('!debug' '!strip')",
    "pkgrel=1",
    "pkgdesc='The AI coding agent built for the terminal.'",
    "url='https://github.com/Kilo-Org/kilocode'",
    "arch=('aarch64' 'x86_64')",
    "license=('MIT' 'LGPL-2.0-or-later')",
    "provides=('kilo')",
    "conflicts=('kilo')",
    "depends=('ripgrep')",
    "",
    `source_aarch64=("\${pkgname}_\${pkgver}_aarch64.tar.gz::https://github.com/Kilo-Org/kilocode/releases/download/v\${pkgver}\${_subver}/kilo-linux-arm64.tar.gz")`,
    `sha256sums_aarch64=('${digest["kilo-linux-arm64.tar.gz"]}')`,
    `source_x86_64=("\${pkgname}_\${pkgver}_x86_64.tar.gz::https://github.com/Kilo-Org/kilocode/releases/download/v\${pkgver}\${_subver}/kilo-linux-x64.tar.gz")`,
    `sha256sums_x86_64=('${digest["kilo-linux-x64.tar.gz"]}')`,
    "",
    "package() {",
    '  install -Dm755 ./kilo "${pkgdir}/usr/lib/kilo/kilo"',
    '  install -Dm755 ./bwrap "${pkgdir}/usr/lib/kilo/bwrap"',
    '  install -Dm644 ./kilo-sandbox-mutation-worker.js "${pkgdir}/usr/lib/kilo/kilo-sandbox-mutation-worker.js"',
    '  install -dm755 "${pkgdir}/usr/bin" "${pkgdir}/usr/lib/kilo/tree-sitter" "${pkgdir}/usr/share/licenses/kilo"',
    '  cp -r ./tree-sitter/. "${pkgdir}/usr/lib/kilo/tree-sitter/"',
    '  cp -r ./licenses/. "${pkgdir}/usr/share/licenses/kilo/"',
    "  printf '%s\\n' '#!/bin/sh' 'export KILO_TREE_SITTER_WASM_DIR=/usr/lib/kilo/tree-sitter' 'exec /usr/lib/kilo/kilo \"$@\"' > \"${pkgdir}/usr/bin/kilo\"",
    '  chmod 755 "${pkgdir}/usr/bin/kilo"',
    "}",
    "",
  ].join("\n")
}

/** What `makepkg --printsrcinfo` prints for pkgbuild(version, digest), without running the PKGBUILD. */
export function srcinfo(version: string, digest: Digests) {
  const { pkgver, subver } = split(version)
  const url = `https://github.com/Kilo-Org/kilocode/releases/download/v${pkgver}${subver}`
  return [
    "pkgbase = kilo-bin",
    "\tpkgdesc = The AI coding agent built for the terminal.",
    `\tpkgver = ${pkgver}`,
    "\tpkgrel = 1",
    "\turl = https://github.com/Kilo-Org/kilocode",
    "\tarch = aarch64",
    "\tarch = x86_64",
    "\tlicense = MIT",
    "\tlicense = LGPL-2.0-or-later",
    "\tdepends = ripgrep",
    "\tprovides = kilo",
    "\tconflicts = kilo",
    "\toptions = !debug",
    "\toptions = !strip",
    `\tsource_aarch64 = kilo-bin_${pkgver}_aarch64.tar.gz::${url}/kilo-linux-arm64.tar.gz`,
    `\tsha256sums_aarch64 = ${digest["kilo-linux-arm64.tar.gz"]}`,
    `\tsource_x86_64 = kilo-bin_${pkgver}_x86_64.tar.gz::${url}/kilo-linux-x64.tar.gz`,
    `\tsha256sums_x86_64 = ${digest["kilo-linux-x64.tar.gz"]}`,
    "",
    "pkgname = kilo-bin",
    "",
  ].join("\n")
}

export function formula(version: string, digest: Digests) {
  split(version)
  const url = `https://github.com/Kilo-Org/kilocode/releases/download/v${version}`
  return [
    "# typed: false",
    "# frozen_string_literal: true",
    "",
    "# This file was generated by GoReleaser. DO NOT EDIT.",
    "class Kilo < Formula",
    `  desc "The AI coding agent built for the terminal."`,
    `  homepage "https://kilo.ai"`,
    `  version "${version.split("-")[0]}"`,
    "",
    `  depends_on "ripgrep"`,
    "",
    "  on_macos do",
    "    if Hardware::CPU.intel?",
    `      url "${url}/kilo-darwin-x64.zip"`,
    `      sha256 "${digest["kilo-darwin-x64.zip"]}"`,
    "",
    "      def install",
    '        libexec.install "kilo", "kilo-sandbox-mutation-worker.js", "tree-sitter"',
    '        (bin/"kilo").write_env_script libexec/"kilo", KILO_TREE_SITTER_WASM_DIR: libexec/"tree-sitter"',
    "      end",
    "    end",
    "    if Hardware::CPU.arm?",
    `      url "${url}/kilo-darwin-arm64.zip"`,
    `      sha256 "${digest["kilo-darwin-arm64.zip"]}"`,
    "",
    "      def install",
    '        libexec.install "kilo", "kilo-sandbox-mutation-worker.js", "tree-sitter"',
    '        (bin/"kilo").write_env_script libexec/"kilo", KILO_TREE_SITTER_WASM_DIR: libexec/"tree-sitter"',
    "      end",
    "    end",
    "  end",
    "",
    "  on_linux do",
    "    if Hardware::CPU.intel? and Hardware::CPU.is_64_bit?",
    `      url "${url}/kilo-linux-x64.tar.gz"`,
    `      sha256 "${digest["kilo-linux-x64.tar.gz"]}"`,
    "      def install",
    '        libexec.install "kilo", "bwrap", "kilo-sandbox-mutation-worker.js", "tree-sitter", "licenses"',
    '        (bin/"kilo").write_env_script libexec/"kilo", KILO_TREE_SITTER_WASM_DIR: libexec/"tree-sitter"',
    "      end",
    "    end",
    "    if Hardware::CPU.arm? and Hardware::CPU.is_64_bit?",
    `      url "${url}/kilo-linux-arm64.tar.gz"`,
    `      sha256 "${digest["kilo-linux-arm64.tar.gz"]}"`,
    "      def install",
    '        libexec.install "kilo", "bwrap", "kilo-sandbox-mutation-worker.js", "tree-sitter", "licenses"',
    '        (bin/"kilo").write_env_script libexec/"kilo", KILO_TREE_SITTER_WASM_DIR: libexec/"tree-sitter"',
    "      end",
    "    end",
    "  end",
    "end",
    "",
    "",
  ].join("\n")
}

export type Update = {
  /** Clone source and push target. */
  remote: string
  /** Branch to commit on; the remote's default branch when omitted. */
  branch?: string
  /** File name in the repository root, and its full contents. */
  files: Record<string, string>
  /** The version `files` publish. */
  version?: string
  /** Reads the version the clone publishes, or undefined when it has none. */
  published?: (dir: string) => Promise<string | undefined>
  message: string
  /** Extra environment for git, for example GIT_SSH_COMMAND. */
  env?: Record<string, string>
  attempts?: number
  /** Milliseconds between attempts. */
  wait?: number
}

/**
 * The latest published release version, or undefined when it cannot be read. KILO_LATEST_RELEASE
 * overrides the lookup; otherwise the GitHub API answers with the job's read-only token.
 */
export async function latestRelease() {
  const override = process.env.KILO_LATEST_RELEASE
  if (override !== undefined) return accepted(override.replace(/^v/, ""))
  const token = process.env.GITHUB_TOKEN
  try {
    const response = await fetch("https://api.github.com/repos/Kilo-Org/kilocode/releases/latest", {
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "kilocode-package-managers",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) return undefined
    const body: unknown = await response.json()
    const tag = typeof body === "object" && body !== null ? Reflect.get(body, "tag_name") : undefined
    return typeof tag === "string" ? accepted(tag.replace(/^v/, "")) : undefined
  } catch {
    return undefined
  }
}

/** A recipe ahead of the latest release: a retry cannot fix it, so the update fails at once. */
export class RecipeAheadError extends Error {}

/**
 * Clones `remote`, writes `files`, and commits and pushes them unless the clone already has them.
 * With `version` and `published`, a clone that already publishes a newer version is left as it is
 * with a warning, unless this run publishes the latest release, which no recipe may be ahead of.
 * A failed clone, commit or push (for example a push that lost a race) starts again from a new
 * clone, up to `attempts` times; the last error fails the update.
 */
export async function update(input: Update): Promise<"pushed" | "unchanged" | "skipped"> {
  const attempts = input.attempts ?? 3
  const env = {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    // Abort an HTTPS transfer that stays below 1000 bytes/s for 60 s instead of hanging.
    GIT_HTTP_LOW_SPEED_LIMIT: "1000",
    GIT_HTTP_LOW_SPEED_TIME: "60",
    ...input.env,
  }
  const git = (args: string[], cwd?: string) => execFileSync("git", args, { cwd, env, stdio: "inherit" })
  for (let attempt = 1; ; attempt++) {
    const root = await mkdtemp(path.join(process.env.RUNNER_TEMP || os.tmpdir(), "package-manager-"))
    const dir = path.join(root, "repo")
    try {
      git(["clone", "--quiet", input.remote, dir])
      if (input.branch) git(["checkout", "--quiet", input.branch], dir)
      if (input.version !== undefined && input.published) {
        const current = await input.published(dir)
        if (current !== undefined && compare(current, input.version) > 0) {
          const ahead = `${input.remote} publishes v${current}, newer than the v${input.version} this run publishes`
          const latest = await latestRelease()
          if (latest === input.version) {
            throw new RecipeAheadError(
              `${ahead}, and v${latest} is the latest release. Nothing was pushed; check the recipe by hand.`,
            )
          }
          const freshness = latest === undefined ? "the latest release is unknown" : `the latest release is v${latest}`
          console.log(`::warning::${ahead}; leaving it unchanged (${freshness}).`)
          return "skipped"
        }
      }
      for (const [name, text] of Object.entries(input.files)) await regular(path.join(dir, name), text)
      git(["add", "--", ...Object.keys(input.files)], dir)
      const diff = execFileSync("git", ["diff", "--cached", "--name-only"], { cwd: dir, env, encoding: "utf8" })
      if (diff.trim() === "") return "unchanged"
      git(["commit", "--quiet", "-m", input.message], dir)
      git(["push", "--quiet", "origin", "HEAD"], dir)
      return "pushed"
    } catch (err) {
      if (err instanceof RecipeAheadError || attempt >= attempts) throw err
      console.warn(`attempt ${attempt}/${attempts} for ${input.remote} failed; starting again from a new clone`)
      await sleep(input.wait ?? 5_000)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }
}

/** Writes `file` only if it is a regular file or absent, so a symlink in a clone cannot redirect the write. */
export async function regular(file: string, text: string) {
  const stat = await lstat(file).catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") return undefined
    throw err
  })
  if (stat && !stat.isFile()) throw new Error(`Refusing to write ${file}: it is not a regular file`)
  await writeFile(file, text)
}

/** The ssh command for the AUR: only this key, only the pinned host keys, no config, agent or prompt. */
export function sshCommand(key: string, known: string) {
  for (const file of [key, known]) {
    if (!path.isAbsolute(file) || /['"\\\s]/.test(file)) throw new Error(`Unsupported path for ssh: ${file}`)
  }
  return [
    "ssh",
    "-F /dev/null",
    `-i '${key}'`,
    "-o IdentitiesOnly=yes",
    "-o IdentityAgent=none",
    `-o UserKnownHostsFile='${known}'`,
    "-o GlobalKnownHostsFile=/dev/null",
    "-o StrictHostKeyChecking=yes",
    "-o BatchMode=yes",
    "-o ConnectTimeout=20",
    "-o ServerAliveInterval=15",
    "-o ServerAliveCountMax=4",
  ].join(" ")
}

export async function aur(version: string, digest: Digests, key: string, remote = AUR_REMOTE) {
  // ssh rejects a private key without its final newline; the secret store may have dropped it.
  if (!(await readFile(key, "utf8")).endsWith("\n")) await appendFile(key, "\n")
  const root = await mkdtemp(path.join(process.env.RUNNER_TEMP || os.tmpdir(), "aur-hosts-"))
  try {
    const known = path.join(root, "known_hosts")
    await regular(known, `${AUR_KNOWN_HOSTS.join("\n")}\n`)
    return await update({
      remote,
      branch: "master",
      version,
      published: async (dir) => pkgbuildVersion(await cloneText(dir, "PKGBUILD")),
      files: { PKGBUILD: pkgbuild(version, digest), ".SRCINFO": srcinfo(version, digest) },
      message: `Update to v${version}`,
      env: { GIT_SSH_COMMAND: sshCommand(key, known) },
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

export async function homebrew(version: string, digest: Digests, remote = TAP_REMOTE) {
  return update({
    remote,
    version,
    published: async (dir) => formulaVersion(await cloneText(dir, "kilo.rb")),
    files: { "kilo.rb": formula(version, digest) },
    message: `Update to v${version}`,
  })
}

if (import.meta.main) {
  const [target, manifest, version] = process.argv.slice(2)
  if ((target !== "aur" && target !== "homebrew") || !manifest || !version) {
    throw new Error("Usage: package-managers.ts aur|homebrew <cli-sbom-evidence.json> <version>")
  }
  if (!VERSION.test(version)) throw new Error(`Invalid release version ${JSON.stringify(version)}`)
  const digest = digests(await readFile(manifest, "utf8"), version)
  if (target === "aur") {
    const key = process.env.AUR_KEY_FILE
    if (!key) throw new Error("AUR_KEY_FILE is required")
    console.log(`AUR kilo-bin v${version}: ${await aur(version, digest, key)}`)
  } else {
    console.log(`Homebrew kilo v${version}: ${await homebrew(version, digest)}`)
  }
}
