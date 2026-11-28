#!/usr/bin/env bun
/**
 * publish.yml sbom-cli-windows: replace the build's Windows evidence with evidence for the
 * zips sign-cli-windows signed. Rewrites the manifest, the checksum file and the Windows
 * sidecars in the evidence directory.
 *
 *   SIGNED_ZIPS=<zips-sha256 output> bun packages/opencode/script/kilocode/signed-evidence.ts <evidence dir> <zip dir>
 */

import { $ } from "bun"
import path from "node:path"
import { Script } from "@opencode-ai/script"
import pkg from "../../package.json"
import { signed as recorded } from "../../../../script/kilocode/cli-assets"
import { CROSS_PLATFORM, signed } from "./sbom"

const [dir, zips] = process.argv.slice(2)
if (!dir || !zips) throw new Error("Usage: signed-evidence.ts <evidence dir> <zip dir>")
const digests = recorded(process.env.SIGNED_ZIPS ?? "")

const dependencies: Record<string, string> = pkg.dependencies
for (const name of CROSS_PLATFORM) {
  await $`bun install --os="*" --cpu="*" ${name}@${dependencies[name]}`.cwd(path.resolve(import.meta.dir, "../.."))
}

await signed({ dir, zips, digests, release: { version: Script.version, channel: Script.channel } })
