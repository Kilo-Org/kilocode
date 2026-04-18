#!/usr/bin/env bun

import { Script } from "@opencode-ai/script"
import { $ } from "bun"
import { fileURLToPath } from "url"

const highlightsTemplate = `
<!--
Add highlights before publishing. Delete this section if no highlights.

- For multiple highlights, use multiple <highlight> tags
- Highlights with the same source attribute get grouped together
-->

<!--
<highlight source="SourceName (TUI/Desktop/Web/Core)">
  <h2>Feature title goes here</h2>
  <p short="Short description used for Desktop Recap">
    Full description of the feature or change
  </p>

  https://github.com/user-attachments/assets/uuid-for-video (you will want to drag & drop the video or picture)

  <img
    width="1912"
    height="1164"
    alt="image"
    src="https://github.com/user-attachments/assets/uuid-for-image"
  />
</highlight>
-->

`

console.log("=== publishing ===\n")

// kilocode_change start - consume changesets on the publish runner so changelog
// changes are included in the release commit. Previously this ran in the
// version job on a separate runner whose workspace was discarded.
{
  await $`bun install`
  const paths = ["packages/kilo-vscode/CHANGELOG.md", "packages/opencode/CHANGELOG.md"]
  const before = new Map<string, string>()
  for (const p of paths) {
    before.set(
      p,
      await Bun.file(p)
        .text()
        .catch(() => ""),
    )
  }
  const res = await $`bunx changeset version`.nothrow()
  if (res.exitCode !== 0) {
    console.warn("changeset version failed (exit " + res.exitCode + ")")
  }
  // Changeset computes its own version from package.json, but we use
  // Script.version. Fix the heading in any changelog that was modified.
  for (const p of paths) {
    const content = await Bun.file(p)
      .text()
      .catch(() => "")
    if (content !== before.get(p)) {
      await Bun.write(p, content.replace(/^## .+$/m, `## ${Script.version}`))
    }
  }
}
// kilocode_change end

const pkgjsons = await Array.fromAsync(
  new Bun.Glob("**/package.json").scan({
    absolute: true,
  }),
).then((arr) => arr.filter((x) => !x.includes("node_modules") && !x.includes("dist")))

for (const file of pkgjsons) {
  let pkg = await Bun.file(file).text()
  pkg = pkg.replaceAll(/"version": "[^"]+"/g, `"version": "${Script.version}"`)
  console.log("updated:", file)
  await Bun.file(file).write(pkg)
}

const extensionToml = fileURLToPath(new URL("../packages/extensions/zed/extension.toml", import.meta.url))
let toml = await Bun.file(extensionToml).text()
toml = toml.replace(/^version = "[^"]+"/m, `version = "${Script.version}"`)
toml = toml.replaceAll(/releases\/download\/v[^/]+\//g, `releases/download/v${Script.version}/`)
console.log("updated:", extensionToml)
await Bun.file(extensionToml).write(toml)

await $`bun install`
await import(`../packages/sdk/js/script/build.ts`)

if (Script.release) {
  // kilocode_change start - commit and tag both release and rc version bumps
  await $`git commit -am "release: v${Script.version}"`
  await $`git tag v${Script.version}`
  await $`git fetch origin`
  await $`git cherry-pick HEAD..origin/main`.nothrow()
  await $`git push origin HEAD --tags --no-verify --force-with-lease`
  await new Promise((resolve) => setTimeout(resolve, 5_000))
  // kilocode_change end

  // kilocode_change start
  // await import(`../packages/desktop/scripts/finalize-latest-json.ts`)
  // await import(`../packages/desktop-electron/scripts/finalize-latest-yml.ts`)
  // kilocode_change end

  // kilocode_change start - mark prerelease GitHub releases accordingly
  // and populate release notes from the changelog updated by changeset above.
  // Use an absolute path for the CHANGELOG because the imported SDK build
  // script chdirs into packages/sdk/js, so a relative path would miss the file
  // and fall through to the "No notable changes" default.
  const flags = Script.preview ? ["--draft=false", "--prerelease"] : ["--draft=false"]
  const changelogPath = fileURLToPath(new URL("../packages/kilo-vscode/CHANGELOG.md", import.meta.url))
  const changelog = await Bun.file(changelogPath)
    .text()
    .catch(() => "")
  const body = extractLatestSection(changelog) || "No notable changes"
  const tmp = process.env.RUNNER_TEMP ?? "/tmp"
  const notes = `${tmp}/release-notes.txt`
  await Bun.write(notes, body)
  flags.push("--notes-file", notes)
  await $`gh release edit v${Script.version} ${flags} --repo ${process.env.GH_REPO}`
  // kilocode_change end
}

console.log("\n=== cli ===\n")
await import(`../packages/opencode/script/publish.ts`)

console.log("\n=== sdk ===\n")
await import(`../packages/sdk/js/script/publish.ts`)

console.log("\n=== plugin ===\n")
await import(`../packages/plugin/script/publish.ts`)

// kilocode_change start
console.log("\n=== vscode ===\n")
await import(`../packages/kilo-vscode/script/publish.ts`)
// kilocode_change end

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

// kilocode_change start - extract latest changelog section for release notes
function extractLatestSection(changelog: string): string {
  if (!changelog) return ""
  const lines = changelog.split("\n")
  const start = lines.findIndex((line) => /^## /.test(line))
  if (start < 0) return ""
  const end = lines.findIndex((line, i) => i > start && /^## /.test(line))
  return lines
    .slice(start + 1, end < 0 ? undefined : end)
    .join("\n")
    .trim()
}
// kilocode_change end
