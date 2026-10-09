#!/usr/bin/env bun

// Consumes the pending .changeset/*.md files into the package changelogs and
// titles the new section with the release version.
//
// `changeset version` computes its own next version from package.json, but the
// release version comes from the publish workflow (KILO_VERSION). The new
// changelog section is therefore retitled to the release version. Changelogs
// that `changeset version` did not touch (no changesets for that package) are
// left alone, so an old section is never renamed.
//
// Runs in two places of .github/workflows/publish.yml on the same commit:
// - build-vscode, so the packaged VSIX ships the current changelog
// - publish (via script/publish.ts), which commits the result

import { $ } from "bun"
import { fileURLToPath } from "url"

const root = fileURLToPath(new URL("../../", import.meta.url))
const files = ["packages/kilo-vscode/CHANGELOG.md", "packages/opencode/CHANGELOG.md"].map((p) => Bun.file(root + p))

export function retitle(content: string, version: string) {
  return content.replace(/^## .+$/m, `## ${version}`)
}

export async function apply(version: string) {
  const before = await Promise.all(files.map((file) => file.text()))
  await $`bunx changeset version`.cwd(root)
  for (const [i, file] of files.entries()) {
    const content = await file.text()
    if (content === before[i]) continue
    await Bun.write(file, retitle(content, version))
  }
}

if (import.meta.main) {
  const version = process.env.KILO_VERSION
  if (!version) throw new Error("KILO_VERSION is required")
  await apply(version)
}
