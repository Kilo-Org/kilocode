#!/usr/bin/env bun

// Publishes Kilo's v2 client packages to npm with the `kilo-v2` dist-tag, next to the CLI from
// packages/kilo-cli/script/publish.ts:
//
//   packages/schema   -> @kilocode/schema
//   packages/protocol -> @kilocode/protocol
//   packages/client   -> @kilocode/client
//
// The `@opencode/*` scope on npm belongs to upstream, so the packages get Kilo names. Their code imports
// `@opencode/schema` and `@opencode/protocol`, so the internal dependencies are npm aliases
// (`"@opencode/schema": "npm:@kilocode/schema@<version>"`) and the built files stay unchanged. A consumer installs
// `@kilocode/client`, or keeps upstream's import name with `"@opencode/client": "npm:@kilocode/client@kilo-v2"`.
//
// The version is the CLI's version from the same build, so client N matches server N.
//
// Mirror of packages/{schema,protocol,client}/script/publish.ts (upstream): build, rewrite `exports` from `src/*.ts`
// to `dist/`, pack with `bun pm pack` (it resolves `workspace:` and `catalog:`), publish. The package.json files are
// restored afterwards.
//
// Usage: KILO_VERSION=<version> bun script/kilocode/publish-client.ts [--dry-run]
// --dry-run packs every package and runs `npm publish --dry-run`. It publishes nothing.
// Provenance comes from NPM_CONFIG_PROVENANCE, which the publish workflow sets. Without it the script also works
// with a local npm login, for example for the first publish of a new package name.
// release-env copies KILO_VERSION to OPENCODE_VERSION, which `@opencode/script` reads, so it is imported first.
import "./release-env"
import { $ } from "bun"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Script } from "@opencode/script"
import { ClientManifest } from "./client-manifest"

const root = path.resolve(import.meta.dirname, "..", "..")
const tag = "kilo-v2"
const dryRun = process.argv.includes("--dry-run")
const packages = ClientManifest.packages

const out = await mkdtemp(path.join(os.tmpdir(), "kilo-client-"))
try {
  for (const name of packages) await publish(name)
} finally {
  await rm(out, { recursive: true, force: true })
}
console.log(
  `${dryRun ? "dry run: " : ""}${packages.map((name) => `@kilocode/${name}`).join(", ")}@${Script.version} published with dist-tag ${tag}`,
)

async function publish(name: string) {
  const dir = path.join(root, "packages", name)
  const file = path.join(dir, "package.json")
  const original = await Bun.file(file).text()
  const pkg: ClientManifest.Manifest = JSON.parse(original)
  const target = ClientManifest.kilo(pkg.name)
  await $`bun run build`.cwd(dir)
  try {
    await Bun.write(file, JSON.stringify(ClientManifest.manifest(pkg, name, Script.version), null, 2) + "\n")
    const destination = path.join(out, name)
    await $`bun pm pack --quiet --destination ${destination}`.cwd(dir)
    const tarball = Array.from(new Bun.Glob("*.tgz").scanSync({ cwd: destination, absolute: true }))[0]
    if (!tarball) throw new Error(`bun pm pack did not write a tarball for ${target}`)
    if (dryRun) {
      await $`npm publish ${tarball} --dry-run --access public --tag ${tag}`
      return
    }
    // A rerun of the workflow publishes only the packages that are missing.
    if ((await $`npm view ${target}@${Script.version} version`.quiet().nothrow()).exitCode === 0) {
      console.log(`already published ${target}@${Script.version}`)
      return
    }
    await $`npm publish ${tarball} --access public --tag ${tag}`
  } finally {
    await Bun.write(file, original)
  }
}
