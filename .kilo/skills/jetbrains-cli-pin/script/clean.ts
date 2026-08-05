import { $ } from "bun"

// Single source of truth for every CLI/pin artifact that can leak across a mode
// flip in the current worktree. Everything here is gitignored (dist, backend/build,
// .gradle), so cleaning never touches tracked files.
//
// The build's conditional sourceSets/dependsOn wiring in backend/build.gradle.kts only
// produces a correct package from a clean build/ directory. Incremental builds are what
// let a stale kilo-cli.zip survive a pin<->unpin flip, and runtime prefers a bundled
// zip over downloading -- so a full gradle clean is the reliable reset.
export async function clean(jb = "packages/kilo-jetbrains") {
  // gradle clean wipes each project's build directory (including backend/build).
  await $`./gradlew clean --quiet`.cwd(jb).nothrow()

  // Stale per-platform CLI binaries. build.ts only rm -rf dist for the platforms it
  // builds, so old platform dirs can survive; wipe the whole tree.
  await $`rm -rf packages/opencode/dist`

  // Belt-and-suspenders in case gradle clean was skipped or ran offline.
  await $`rm -rf ${jb}/backend/build/generated`.nothrow()
  await $`rm -rf ${jb}/backend/build/resources`.nothrow()
  await $`rm -rf ${jb}/backend/build/cli-cache`.nothrow()
}
