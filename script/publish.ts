#!/usr/bin/env bun

// kilocode_change - the version bump, the release commit and its tag moved to the release-commit and
// release-push jobs (script/kilocode/release-bundle.ts, script/kilocode/release-push.ts)
import { fileURLToPath } from "url"

console.log("=== publishing ===\n")

// kilocode_change start - the publish job runs on the pushed release tag, which already carries the
// version bump and the changelogs
await import(`../packages/sdk/js/script/build.ts`)
// kilocode_change end

console.log("\n=== cli ===\n")
await import(`../packages/opencode/script/publish.ts`)

// kilocode_change - Kilo does not ship the upstream preview CLI package

console.log("\n=== sdk ===\n")
await import(`../packages/sdk/js/script/publish.ts`)

console.log("\n=== plugin ===\n")
await import(`../packages/plugin/script/publish.ts`)

// kilocode_change - Kilo does not publish the upstream-owned @opencode-ai/ui package

// kilocode_change start
console.log("\n=== vscode ===\n")
await import(`../packages/kilo-vscode/script/publish.ts`)
// kilocode_change end

// kilocode_change start - Kilo does not ship the opencode desktop app
// if (Script.release) {
//   await $`bun ./packages/desktop/scripts/finalize-latest-json.ts`
//   await $`bun ./packages/desktop/scripts/finalize-latest-yml.ts`
// }
// kilocode_change end

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)
