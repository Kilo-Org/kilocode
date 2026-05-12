#!/usr/bin/env bun
// kilocode_change - new file

/**
 * Guards generated Kilo config dependency artifacts.
 *
 * Kilo loads project config from .kilo/ and .kilocode/ and installs
 * @kilocode/plugin there at runtime. npm writes package.json, lockfiles,
 * .gitignore, and node_modules as generated local state. These paths must stay
 * untracked so background installs do not create recurring branch diffs.
 */

import { spawnSync } from "node:child_process"

const paths = [
  ".kilo/.gitignore",
  ".kilo/package.json",
  ".kilo/package-lock.json",
  ".kilo/pnpm-lock.yaml",
  ".kilo/bun.lock",
  ".kilo/yarn.lock",
  ".kilo/node_modules",
  ".kilocode/.gitignore",
  ".kilocode/package.json",
  ".kilocode/package-lock.json",
  ".kilocode/pnpm-lock.yaml",
  ".kilocode/bun.lock",
  ".kilocode/yarn.lock",
  ".kilocode/node_modules",
]

const git = spawnSync("git", ["ls-files", "-z", "--", ...paths], { encoding: "utf8" })

if (git.status !== 0) {
  console.error(git.stderr.trim() || "git ls-files failed")
  process.exit(1)
}

const bad = git.stdout.split("\0").filter(Boolean).sort()

if (bad.length === 0) {
  console.log("check-kilo-generated-artifacts: ok")
  process.exit(0)
}

console.error("Generated Kilo config dependency artifacts are tracked:")
for (const file of bad) console.error(`  ${file}`)
console.error("")
console.error("These files are created by runtime dependency installs in .kilo/ and .kilocode/.")
console.error("Remove them from git and keep them ignored.")
process.exit(1)
