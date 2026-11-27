#!/usr/bin/env bun

// kilo_mirror: packages/cli/script/pack.ts
// Packs the platform packages and generates the @kilocode/cli launcher for the read-only release producer.
//
// Mirror of the npm part of upstream's publish script (packages/cli/script/publish.ts, replaced by pack.ts in v2.2).
// It packs one platform package per target (`@kilocode/cli-<os>-<arch>`, written by script/build.ts) and the
// `@kilocode/cli` launcher package. The launcher has the platform packages as optional dependencies, and its
// postinstall script copies the matching binary into place.
// Upstream's update artifacts, Docker image, AUR and Homebrew steps are not part of this script.
//
// script/kilocode/publish-npm.ts publishes only these tested files, with the separate preview dist-tag.
//
// Usage: KILO_VERSION=<version> bun script/publish.ts <output directory> (or --dry-run for a local build).
// KILO_VERSION must be the version that script/build.ts built. release-env copies it to OPENCODE_VERSION, which
// `@opencode/script` reads, so it is imported first.
import "../../../script/kilocode/release-env"
import { $ } from "bun"
import { mkdir, rm } from "node:fs/promises"
import path from "node:path"
import { Script } from "@opencode/script"
import { platforms, launcher } from "../../../script/kilocode/npm-tarballs"
import { packNpm } from "../../../script/kilocode/pack-npm"
import { launcherPostinstall } from "./postinstall"

const dir = path.resolve(import.meta.dirname, "..")
const root = path.join(dir, "dist")
const repository = { type: "git", url: "git+https://github.com/Kilo-Org/kilocode.git" }
const output = process.argv[2]
if (!output) throw new Error("Pass a tarball output directory or --dry-run")
const dryRun = output === "--dry-run"
const license = Bun.file(path.resolve(dir, "../../LICENSE"))

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
const built = Object.keys(binaries)
const missing = platforms.filter((pkg) => !built.includes(pkg))
const unexpected = built.filter((pkg) => !platforms.includes(pkg))
// A local dry run of a --single build is fine. A publish and every CI run need exactly the targets above.
if ((missing.length > 0 && (!dryRun || process.env.CI)) || unexpected.length > 0)
  throw new Error(
    [
      missing.length > 0 &&
        `Missing platform packages for ${missing.join(", ")}. Run script/build.ts without --single.`,
      unexpected.length > 0 &&
        `Unexpected platform packages for ${unexpected.join(", ")}. Update targets in this script.`,
    ]
      .filter(Boolean)
      .join(" "),
  )

const directory = path.join(root, "cli")
await rm(directory, { recursive: true, force: true })
await mkdir(path.join(directory, "bin"), { recursive: true })
await Bun.write(path.join(directory, "LICENSE"), license)
// Kilo: copy the platform's runtime sidecars along with the binary.
await Bun.write(path.join(directory, "postinstall.mjs"), await launcherPostinstall())
// The postinstall script replaces this placeholder with the binary. It stays only when install scripts are disabled.
await Bun.write(
  path.join(directory, "bin", "kilo2.exe"),
  [
    `echo "Error: ${launcher}'s postinstall script was not run." >&2`,
    'echo "" >&2',
    'echo "This occurs when installation scripts are disabled." >&2',
    'echo "Run the package postinstall script or reinstall with scripts enabled." >&2',
    "exit 1",
    "",
  ].join("\n"),
)
await Bun.write(
  path.join(directory, "package.json"),
  JSON.stringify(
    {
      name: launcher,
      version,
      license: "MIT",
      repository,
      // The postinstall script uses the first command as the binary name in the platform packages. Only `kilo2`: a
      // `kilo` alias would make a v1 user's `kilo` start v2, which keeps its logins and config apart from v1 (D-4).
      bin: { kilo2: "./bin/kilo2.exe" },
      scripts: { postinstall: "node ./postinstall.mjs" },
      os: ["darwin", "linux", "win32"],
      cpu: ["arm64", "x64"],
      optionalDependencies: binaries,
    },
    null,
    2,
  ),
)

await Promise.all(
  [...built, launcher].map(async (pkg) => {
    const directory = path.join(root, pkg.slice("@kilocode/".length))
    if (process.platform !== "win32") await $`chmod -R 755 .`.cwd(directory)
    for (const file of new Bun.Glob("*.tgz").scanSync({ cwd: directory })) await rm(path.join(directory, file))
    await packNpm(directory, dryRun ? directory : path.resolve(output), pkg, version)
  }),
)
