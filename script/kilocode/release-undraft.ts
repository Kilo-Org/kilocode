#!/usr/bin/env bun
// kilocode_change - new file
/**
 * Publishes the GitHub release in the release-undraft job of .github/workflows/publish.yml, after
 * publish-build pushed the images and wrote the distribution evidence and before publish puts the
 * packages on npm: the installer and `kilo upgrade` take the version from npm and download the
 * archives from the release, so the release is public first.
 *
 *   bun script/kilocode/release-undraft.ts <publish-build artifact directory>
 *
 * Environment: VERSION, PRE_RELEASE, KILO_PUBLISH_SHA256 (publish-build's output), KILO_RELEASE,
 * GH_REPO, GH_TOKEN, CLI_MANIFEST_SHA256 and VSIX_SHA256 (see draft-assets.ts).
 *
 * A draft gets the evidence, is checked complete and is published with its notes (draft-assets.ts
 * publish()). A release that is already published (a re-run) is only checked, together with the npm
 * tarballs the stage names (recheck()). The job installs nothing: this script imports only Bun and
 * Node built-ins and this repository's code.
 */

import * as KiloDraft from "./draft-assets.ts"
import * as Stage from "./publish-stage.ts"

if (import.meta.main) {
  const dir = process.argv[2]
  const { VERSION, PRE_RELEASE, KILO_PUBLISH_SHA256 } = process.env
  if (!dir || !VERSION || !KILO_PUBLISH_SHA256) {
    throw new Error("Usage: VERSION=… KILO_PUBLISH_SHA256=… release-undraft.ts <publish-build directory>")
  }
  const stage = await Stage.read(dir, KILO_PUBLISH_SHA256, VERSION)
  const { id, draft } = await KiloDraft.open(VERSION)
  if (draft) {
    // Distribution evidence that an earlier attempt left on the draft is removed before the upload.
    await KiloDraft.verify({ tag: `v${VERSION}`, release: id, prune: true })
    await KiloDraft.publish({
      version: VERSION,
      prerelease: PRE_RELEASE === "true",
      files: stage.files,
      entries: stage.entries,
    })
  } else {
    await KiloDraft.recheck({ version: VERSION, entries: stage.entries })
  }
}
