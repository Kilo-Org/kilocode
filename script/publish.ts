#!/usr/bin/env bun

// kilocode_change - the version bump, the release commit and its tag moved to the release-commit and
// release-push jobs (script/kilocode/release-bundle.ts, script/kilocode/release-push.ts)
import { fileURLToPath } from "url"

console.log("=== publishing ===\n")

// kilocode_change start - two stages, both on the pushed release tag, which already carries the
// version bump and the changelogs. "build" (publish-build job): pack and describe the CLI npm
// tarballs, push and describe the images, and hand them over with the distribution evidence.
// release-undraft then publishes the GitHub release. "npm" (publish job): publish the CLI tarballs,
// the SDK, the plugin and the VS Code packages, in today's order.
const stage = process.env.KILO_PUBLISH_STAGE
if (stage === "build") {
  console.log("\n=== cli ===\n")
  await import(`../packages/opencode/script/publish.ts`)
} else if (stage === "npm") {
  await import(`../packages/sdk/js/script/build.ts`)

  console.log("\n=== cli ===\n")
  await import(`../packages/opencode/script/kilocode/publish-npm.ts`)

  // Kilo does not ship the upstream preview CLI package

  console.log("\n=== sdk ===\n")
  await import(`../packages/sdk/js/script/publish.ts`)

  console.log("\n=== plugin ===\n")
  await import(`../packages/plugin/script/publish.ts`)

  // Kilo does not publish the upstream-owned @opencode-ai/ui package

  console.log("\n=== vscode ===\n")
  await import(`../packages/kilo-vscode/script/publish.ts`)
} else {
  throw new Error(`KILO_PUBLISH_STAGE must be "build" or "npm", not ${JSON.stringify(stage)}`)
}
// kilocode_change end

// kilocode_change start - Kilo does not ship the opencode desktop app
// if (Script.release) {
//   await $`bun ./packages/desktop/scripts/finalize-latest-json.ts`
//   await $`bun ./packages/desktop/scripts/finalize-latest-yml.ts`
// }
// kilocode_change end

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)
