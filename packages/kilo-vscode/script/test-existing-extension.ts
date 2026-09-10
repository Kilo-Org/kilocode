import { mkdir, symlink, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import path from "node:path"
import { fixture } from "../../kilo-cli/test/fixture"
import { buildExtension } from "./build"

if (process.env.KILO_TEST_ALLOW_DESKTOP !== "1")
  throw new Error("Desktop acceptance is opt-in: set KILO_TEST_ALLOW_DESKTOP=1 only when VS Code launches are wanted")

if (process.platform !== "darwin") throw new Error("This local native acceptance runner requires macOS")
const executable = process.env.KILO_TEST_VSCODE_EXECUTABLE
if (!executable) {
  throw new Error("Set KILO_TEST_VSCODE_EXECUTABLE to an existing VS Code executable; this runner never downloads it")
}

const root = path.resolve(import.meta.dir, "..")
const rootDir = path.resolve(root, "../..")

await buildExtension()

// 1. Build the native test host entry point
const buildResult = await Bun.build({
  entrypoints: [path.join(root, "test/existing-extension-host.ts")],
  target: "node",
  format: "cjs",
  external: ["vscode"],
  outdir: path.join(root, "dist"),
  naming: "existing-extension-host.cjs",
})
if (!buildResult.success) {
  throw new AggregateError(buildResult.logs, "Unable to build existing extension native acceptance fixture")
}

// 2. Setup isolated fixture environment
await using input = await fixture()
const artifacts = process.env.KILO_TEST_ARTIFACT_DIR ?? input.directory
await mkdir(artifacts, { recursive: true })
const stages = path.join(artifacts, "existing-native-stages.log")
await writeFile(stages, "")

// Stage the same manifest and entrypoint used by bun run extension and packaging.
const stagedDir = path.join(input.directory, "staged-extension")
await mkdir(stagedDir, { recursive: true })
await writeFile(path.join(stagedDir, "package.json"), await Bun.file(path.join(root, "package.json")).text())

// Symlink dist, assets, audio-wav into staging directory (stage only, no live install)
await symlink(path.join(root, "dist"), path.join(stagedDir, "dist"))
if (existsSync(path.join(root, "assets"))) {
  await symlink(path.join(root, "assets"), path.join(stagedDir, "assets"))
}
if (existsSync(path.join(root, "audio-wav"))) {
  await symlink(path.join(root, "audio-wav"), path.join(stagedDir, "audio-wav"))
}

// Symlink parent kilo-cli into input.directory so local CLI discovery resolves directly to current checkout
const parentKiloCli = path.join(rootDir, "packages/kilo-cli")
const stagedKiloCli = path.join(input.directory, "kilo-cli")
if (existsSync(parentKiloCli) && !existsSync(stagedKiloCli)) {
  await symlink(parentKiloCli, stagedKiloCli)
}

// 4. External-network denial policy
const policy = path.join(input.directory, "network.sb")
await writeFile(
  policy,
  '(version 1) (allow default) (deny network-outbound) (allow network-outbound (remote ip "localhost:*"))',
)

// 5. Spawn real VS Code executable under sandbox-exec opening fixture workspace
const child = Bun.spawn(
  [
    "/usr/bin/sandbox-exec",
    "-f",
    policy,
    executable,
    "--no-sandbox",
    "--use-mock-keychain",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    `--user-data-dir=${path.join(input.directory, "user")}`,
    `--extensions-dir=${path.join(input.directory, "extensions")}`,
    `--extensionDevelopmentPath=${stagedDir}`,
    `--extensionTestsPath=${path.join(root, "dist/existing-extension-host.cjs")}`,
    "--skip-welcome",
    "--skip-release-notes",
    "--disable-workspace-trust",
    "--disable-updates",
    "--disable-telemetry",
    "--disable-extensions",
    "--disable-gpu",
    "--new-window",
    input.directory, // Open fixture.cwd as workspace
  ],
  {
    env: {
      ...input.env,
      KILO_TEST_EXTENSION_LOG: stages,
      KILO_CLI: path.join(rootDir, "packages/kilo-cli/dist/interactive/bun"),
    },
    stdout: "pipe",
    stderr: "pipe",
  },
)

const stdout = new Response(child.stdout).text()
const stderr = new Response(child.stderr).text()
const deadline = Date.now() + 45_000
let passed = false
let forcedCleanup = false

try {
  while (Date.now() < deadline && child.exitCode === null) {
    if ((await Bun.file(stages).text()).includes("KILO_EXISTING_EXTENSION_ACTIVATION_PASS")) {
      passed = true
      break
    }
    await Bun.sleep(100)
  }
  passed ||= (await Bun.file(stages).text()).includes("KILO_EXISTING_EXTENSION_ACTIVATION_PASS")
  if (passed) await Promise.race([child.exited, Bun.sleep(3_000)])
} finally {
  if (child.exitCode === null) {
    forcedCleanup = true
    child.kill("SIGTERM")
    await Promise.race([child.exited, Bun.sleep(2_000)])
    if (child.exitCode === null) child.kill("SIGKILL")
  }
  await child.exited
  await writeFile(path.join(artifacts, "existing-native-runtime.log"), (await stdout) + (await stderr))
}

console.log(JSON.stringify({ passed, forcedCleanup, exitCode: child.exitCode }))
if (!passed) {
  throw new Error(`Native assertions did not complete: ${await Bun.file(stages).text()}`)
}
