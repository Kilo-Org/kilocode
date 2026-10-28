#!/usr/bin/env bun

// Publishes the Kilo host that script/build.ts built to npm as `@kilocode/cli` with the `kilo-v2` dist-tag.
//
// Mirror of the npm part of packages/cli/script/publish.ts (upstream). It publishes one platform package per target
// (`@kilocode/cli-<os>-<arch>`, written by script/build.ts) and then the `@kilocode/cli` launcher package. The launcher
// has the platform packages as optional dependencies, and its postinstall script copies the matching binary into place.
// Upstream's update artifacts, Docker image, AUR and Homebrew steps are not part of this script.
//
// v1 publishes the same package names under the `latest` and `rc` dist-tags. This script uses only its own dist-tag,
// so a v2 build never replaces what v1 users install. Upstream uses the build channel as the dist-tag, but npm rejects
// `v2` because it is also a semver range, so the dist-tag is fixed here.
//
// Usage: OPENCODE_CHANNEL=v2 OPENCODE_VERSION=<version> bun script/publish.ts [--dry-run]
// --dry-run packs every package and runs `npm publish --dry-run`. It publishes nothing.
import { $ } from "bun"
import { mkdir, rm } from "node:fs/promises"
import path from "node:path"
import { Script } from "@opencode/script"

const dir = path.resolve(import.meta.dirname, "..")
const root = path.join(dir, "dist")
const name = "@kilocode/cli"
const tag = "kilo-v2"
const repository = { type: "git", url: "git+https://github.com/Kilo-Org/kilocode.git" }
const dryRun = process.argv.includes("--dry-run")

const binaries: Record<string, string> = Object.fromEntries(
  await Promise.all(
    Array.from(new Bun.Glob("cli-*/package.json").scanSync({ cwd: root })).map(async (file) => {
      const pkg = await Bun.file(path.join(root, file)).json()
      return [pkg.name, pkg.version]
    }),
  ),
)
console.log("binaries", binaries)
const versions = new Set(Object.values(binaries))
if (versions.size === 0) throw new Error(`No platform packages in ${root}. Run script/build.ts first.`)
if (versions.size > 1) throw new Error(`Platform package versions do not match: ${[...versions].join(", ")}`)
const version = [...versions][0]
if (version !== Script.version) throw new Error(`Expected version ${Script.version}, the build has ${version}`)

const launcher = path.join(root, "cli")
await rm(launcher, { recursive: true, force: true })
await mkdir(path.join(launcher, "bin"), { recursive: true })
// Upstream's postinstall script finds the platform package by the `-<os>-<arch>` suffix, so it works for Kilo names.
// Only its messages name OpenCode.
await Bun.write(
  path.join(launcher, "postinstall.mjs"),
  (await Bun.file(path.join(dir, "..", "cli", "script", "postinstall.mjs")).text())
    .replaceAll("OpenCode", "Kilo")
    .replaceAll("opencode-install-", "kilo-install-"),
)
// The postinstall script replaces this placeholder with the binary. It stays only when install scripts are disabled.
await Bun.write(
  path.join(launcher, "bin", "kilo2.exe"),
  [
    `echo "Error: ${name}'s postinstall script was not run." >&2`,
    'echo "" >&2',
    'echo "This occurs when installation scripts are disabled." >&2',
    'echo "Run the package postinstall script or reinstall with scripts enabled." >&2',
    "exit 1",
    "",
  ].join("\n"),
)
await Bun.write(
  path.join(launcher, "package.json"),
  JSON.stringify(
    {
      name,
      version,
      license: "MIT",
      repository,
      // The postinstall script uses the first command as the binary name in the platform packages. `kilo` keeps the
      // v1 command working, because a global install of this package replaces v1.
      bin: { kilo2: "./bin/kilo2.exe", kilo: "./bin/kilo2.exe" },
      scripts: { postinstall: "node ./postinstall.mjs" },
      os: ["darwin", "linux", "win32"],
      cpu: ["arm64", "x64"],
      optionalDependencies: binaries,
    },
    null,
    2,
  ),
)

// The launcher goes last: its postinstall script needs the platform packages on the registry.
await Promise.all(
  Object.entries(binaries).map(([pkg, version]) =>
    publish(path.join(root, pkg.slice("@kilocode/".length)), pkg, version),
  ),
)
await publish(launcher, name, version)
console.log(`${dryRun ? "dry run: " : ""}${name}@${version} published with dist-tag ${tag}`)

async function publish(directory: string, pkg: string, version: string) {
  // GitHub artifact downloads can drop the executable bit.
  if (process.platform !== "win32") await $`chmod -R 755 .`.cwd(directory)
  for (const file of new Bun.Glob("*.tgz").scanSync({ cwd: directory })) await rm(path.join(directory, file))
  await $`bun pm pack --quiet`.cwd(directory)
  const tarball = Array.from(new Bun.Glob("*.tgz").scanSync({ cwd: directory }))[0]
  if (!tarball) throw new Error(`bun pm pack did not write a tarball for ${pkg}`)
  if (dryRun) {
    await $`npm publish ${tarball} --dry-run --access public --tag ${tag}`.cwd(directory)
    return
  }
  // A rerun of the workflow publishes only the packages that are missing.
  if ((await $`npm view ${pkg}@${version} version`.quiet().nothrow()).exitCode === 0) {
    console.log(`already published ${pkg}@${version}`)
    return
  }
  await $`npm publish ${tarball} --access public --tag ${tag} --provenance`.cwd(directory)
}
