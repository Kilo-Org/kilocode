#!/usr/bin/env bun
// kilocode_change - new file
/**
 * Writes the release commit and tag in the release-commit job of .github/workflows/publish.yml and
 * packs them into a git bundle for the release-push job.
 *
 * The job holds no secret and no OIDC permission, because the version bump runs third-party code
 * (`bun install`, `changeset version`). It stages only the changes script/kilocode/release-check.ts
 * allows and runs the same check before it packs the bundle; the release-push job checks the
 * bundle again and pushes it.
 *
 *   bun script/kilocode/release-bundle.ts <output directory>
 *
 * Reads KILO_VERSION (and the other KILO_* inputs of @opencode-ai/script). Writes
 * `release.bundle` (the tag `v<version>` and its commit, on top of the checked-out commit) and
 * `release-manifest.json` (for people reading the artifact; the release-push job does not trust it)
 * to the output directory, and `bundle-sha256`, `commit` and `tag` to GITHUB_OUTPUT.
 */

import { $ } from "bun"
import { createHash } from "node:crypto"
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { apply } from "./changeset-version"
import { check, rule, shape } from "./release-check"

const root = fileURLToPath(new URL("../../", import.meta.url))

/** The git identity of release commits, the one setup-git-committer gives the Kilo Maintainer app. */
export const IDENTITY = { name: "kilo-maintainer[bot]", email: "kilo-maintainer[bot]@users.noreply.github.com" }

/**
 * Sets `version` everywhere a release records it and consumes the pending changesets into the
 * changelogs. Runs third-party code. The JetBrains CLI pin keeps its version (its own pull request
 * bumps it), and package.json files under the paths a release commit never touches keep theirs.
 */
export async function bump(version: string) {
  const pin = path.join(root, "packages/kilo-jetbrains/package.json")
  const pinned = await Bun.file(pin).text()
  await $`bun install`.cwd(root)
  await apply(version)
  const files = await Array.fromAsync(new Bun.Glob("**/package.json").scan({ cwd: root }))
  for (const file of files) {
    if (file.includes("node_modules") || file.includes("dist")) continue
    if ("refused" in rule(file, "M")) {
      console.log("kept:", file)
      continue
    }
    const full = path.join(root, file)
    const text = await Bun.file(full).text()
    await Bun.write(full, text.replaceAll(/"version": "[^"]+"/g, `"version": "${version}"`))
    console.log("updated:", file)
  }
  await Bun.write(pin, pinned)
  const toml = path.join(root, "packages/extensions/zed/extension.toml")
  const text = await Bun.file(toml).text()
  await Bun.write(
    toml,
    text
      .replace(/^version = "[^"]+"/m, `version = "${version}"`)
      .replaceAll(/releases\/download\/v[^/]+\//g, `releases/download/v${version}/`),
  )
  console.log("updated: packages/extensions/zed/extension.toml")
  await $`bun install`.cwd(root)
}

/**
 * Commits the allowed working-tree changes of the repository at `cwd` as `release: v<version>`,
 * tags the commit `v<version>`, checks it, and writes the bundle and manifest to `out`. Changes the
 * release commit may not carry (for example regenerated SDK sources) stay out of it, with a warning.
 */
export async function pack(input: { cwd: string; version: string; out: string }) {
  const { cwd, version, out } = input
  const tag = `v${version}`
  // A shell of its own, so the default working directory of other Bun shell users stays as it is.
  const git = new $.Shell().cwd(cwd)
  const base = (await git`git rev-parse HEAD`.text()).trim()
  const listed = (await git`git diff --name-status -z --no-renames HEAD`.text())
    .split("\0")
    .filter((item) => item !== "")
  const paths: { status: string; path: string }[] = []
  for (let i = 0; i + 1 < listed.length; i += 2) {
    const status = listed[i] ?? ""
    const file = listed[i + 1] ?? ""
    const allowed = rule(file, status)
    if ("refused" in allowed) {
      console.log(`::warning::The release commit leaves out ${file} (${status}): ${allowed.refused}`)
      continue
    }
    await git`git add -A -- ${file}`
    paths.push({ status, path: file })
  }
  const who = ["-c", `user.name=${IDENTITY.name}`, "-c", `user.email=${IDENTITY.email}`]
  await git`git ${who} commit --quiet --no-verify -m ${`release: ${tag}`}`
  await git`git tag ${tag}`
  const commit = (await git`git rev-parse HEAD`.text()).trim()
  const problems = [
    ...shape({ cwd, commit, parents: [base], subject: `release: ${tag}` }),
    ...check({ cwd, from: base, to: commit, version }),
  ]
  if (problems.length > 0)
    throw new Error(`The release commit is not one the release-push job accepts:\n${problems.join("\n")}`)
  await mkdir(out, { recursive: true })
  const bundle = path.join(out, "release.bundle")
  await git`git bundle create ${bundle} ${`refs/tags/${tag}`} ${`^${base}`}`.quiet()
  await writeFile(
    path.join(out, "release-manifest.json"),
    `${JSON.stringify({ version, tag, base, commit, paths }, null, 2)}\n`,
  )
  const sha256 = createHash("sha256")
    .update(await readFile(bundle))
    .digest("hex")
  return { commit, tag, sha256 }
}

if (import.meta.main) {
  const out = process.argv[2]
  if (!out) throw new Error("Usage: release-bundle.ts <output directory>")
  // Imported here: @opencode-ai/script reads the release inputs from the environment on import.
  const { Script } = await import("@opencode-ai/script")
  await bump(Script.version)
  const packed = await pack({ cwd: root, version: Script.version, out: path.resolve(out) })
  console.log(`release commit ${packed.commit}, tag ${packed.tag}, bundle sha256 ${packed.sha256}`)
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `bundle-sha256=${packed.sha256}\ncommit=${packed.commit}\ntag=${packed.tag}\n`,
    )
  }
}
