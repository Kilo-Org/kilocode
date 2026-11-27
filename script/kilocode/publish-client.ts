#!/usr/bin/env bun

// Packs Kilo's v2 client packages for npm, next to the CLI from
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
// to `dist/`, pack with `bun pm pack` (it resolves `workspace:` and `catalog:`). The package.json files are
// restored afterwards.
//
// Usage: KILO_VERSION=<version> bun script/kilocode/publish-client.ts <output directory> (or --dry-run).
// release-env copies KILO_VERSION to OPENCODE_VERSION, which `@opencode/script` reads, so it is imported first.
import "./release-env"
import { $ } from "bun"
import { constants } from "node:fs"
import { copyFile, mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Script } from "@opencode/script"
import { ClientManifest } from "./client-manifest"
import { packNpm } from "./pack-npm"

const root = path.resolve(import.meta.dirname, "..", "..")
const output = process.argv[2]
if (!output) throw new Error("Pass a tarball output directory or --dry-run")
const dryRun = output === "--dry-run"
const out = dryRun ? await mkdtemp(path.join(os.tmpdir(), "kilo-client-")) : path.resolve(output)
try {
  for (const name of ClientManifest.packages) await pack(name)
} finally {
  if (dryRun) await rm(out, { recursive: true, force: true })
}

async function pack(name: string) {
  const dir = path.join(root, "packages", name)
  const file = path.join(dir, "package.json")
  const original = await Bun.file(file).text()
  const pkg: ClientManifest.Manifest = JSON.parse(original)
  await $`bun run build`.cwd(dir)
  const license = path.join(dir, "LICENSE")
  await copyFile(path.join(root, "LICENSE"), license, constants.COPYFILE_EXCL)
  try {
    const manifest = ClientManifest.manifest(pkg, name, Script.version)
    await Bun.write(file, JSON.stringify(manifest, null, 2) + "\n")
    const archive = await packNpm(dir, out, `@kilocode/${name}`, Script.version)
    const files = (await $`tar -tzf ${path.basename(archive)}`.cwd(out).text()).split("\n")
    for (const entry of Object.values(manifest.exports).flatMap(Object.values)) {
      const pattern = new Bun.Glob(entry.replace(/^\.\//, "package/"))
      if (!files.some((file) => pattern.match(file))) throw new Error(`${archive} has no export matching ${entry}`)
    }
  } finally {
    await Promise.all([Bun.write(file, original), rm(license)])
  }
}
