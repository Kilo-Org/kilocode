#!/usr/bin/env bun
// kilocode_change - new file
// Sync every Kilo version string across the monorepo to a single target.
//
// Why this exists: upstream opencode stamps its own version into shared files
// during each release (notably `packages/extensions/zed/extension.toml`). When
// we merge upstream, that churn either produces conflicts or silently leaves
// our packages pointing at upstream's version — and upstream's version tag
// doesn't exist on our release pipeline, so the resulting download URLs 404.
//
// Run this in a dedicated commit after resolving an upstream merge (see
// `.kilo/command/upstream-manual-merge.md`). It's also handy mid-merge to
// rebase our version bumps onto any new Kilo main releases.
//
// Usage:
//   bun run script/sync-versions.ts            # use root package.json version
//   bun run script/sync-versions.ts 7.2.41     # explicit target
//   bun run script/sync-versions.ts v7.2.41    # leading `v` is stripped
//
// What gets updated:
//   - every `package.json` top-level `"version": "..."` field in the repo
//     (excluding node_modules and hidden directories)
//   - `packages/extensions/zed/extension.toml` top-level `version = "..."`
//   - the five Kilo-Org download URLs inside that toml
//
// Intentionally NOT touched:
//   - `packages/kilo-jetbrains/**` — the JetBrains plugin has its own release
//     cadence and version number.
//   - dependency version strings inside `package.json` — internal deps use
//     `workspace:*` so they don't need bumping.

import { Glob } from "bun"
import { join, relative } from "node:path"

const root = join(import.meta.dir, "..")

const arg = process.argv[2]
const target = await (async () => {
  if (arg) return arg.replace(/^v/, "")
  const pkg = await Bun.file(join(root, "package.json")).json()
  return pkg.version as string
})()

if (!/^\d+\.\d+\.\d+([-+].+)?$/.test(target)) {
  console.error(`error: invalid version "${target}"`)
  process.exit(1)
}

console.log(`syncing versions → ${target}\n`)

let updated = 0

const glob = new Glob("**/package.json")
for await (const rel of glob.scan({ cwd: root, onlyFiles: true })) {
  if (rel.includes("node_modules/")) continue
  if (rel.startsWith(".")) continue
  if (rel.includes("/.")) continue
  // JetBrains plugin tracks its own version.
  if (rel.startsWith("packages/kilo-jetbrains/")) continue

  const path = join(root, rel)
  const text = await Bun.file(path).text()

  // Only rewrite the top-level version field — avoid touching nested
  // dependency version fields or versions inside sub-strings. The first
  // `"version"` key at 2-space indentation is always the package version in
  // this repo's style.
  const next = text.replace(/^(\s*)"version":\s*"[^"]+"(,?)/m, (_m, indent, comma) => {
    return `${indent}"version": "${target}"${comma}`
  })

  if (next === text) continue
  // Defensive: the replace above runs unconditionally on any match — skip if
  // the file had no `"version"` key at all.
  if (!/"version"\s*:/.test(text)) continue

  await Bun.write(path, next)
  console.log(`  ${rel}`)
  updated++
}

const zed = join(root, "packages/extensions/zed/extension.toml")
if (await Bun.file(zed).exists()) {
  const text = await Bun.file(zed).text()
  const next = text
    .replace(/^version\s*=\s*"[^"]+"/m, `version = "${target}"`)
    .replace(
      /https:\/\/github\.com\/Kilo-Org\/kilocode\/releases\/download\/v[^/]+\//g,
      `https://github.com/Kilo-Org/kilocode/releases/download/v${target}/`,
    )
  if (next !== text) {
    await Bun.write(zed, next)
    console.log(`  ${relative(root, zed)}`)
    updated++
  }
}

console.log(`\nupdated ${updated} file(s)`)
