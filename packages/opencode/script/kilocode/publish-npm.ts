// kilocode_change - new file
// Publishes the npm tarballs publish-build packed, in the publish job of
// .github/workflows/publish.yml, after release-undraft published the GitHub release: the CLI
// installer and `kilo upgrade` take the version from npm and download the archives from the
// release. Each tarball must have the sha256 publish-build recorded (script/kilocode/publish-stage.ts).

import { $ } from "bun"
import { Script } from "@opencode-ai/script"
import pkg from "../../package.json"
import { NpmPublish } from "./npm-publish"
import * as Stage from "../../../../script/kilocode/publish-stage"

const dir = process.env.KILO_PUBLISH_DIR
const tarballs = process.env.KILO_PUBLISH_TARBALLS
const digest = process.env.KILO_PUBLISH_SHA256
if (!dir || !tarballs || !digest) {
  throw new Error("KILO_PUBLISH_DIR, KILO_PUBLISH_TARBALLS and KILO_PUBLISH_SHA256 are required")
}
const stage = await Stage.read({ stage: dir, tarballs, digest, version: Script.version, need: "tarballs" })

const published = async (name: string, version: string) =>
  (await $`npm view ${name}@${version} version`.nothrow()).exitCode === 0

const run = (item: Stage.Tarball) =>
  NpmPublish.retry({
    name: item.name,
    version: item.version,
    run: () => $`npm publish ${item.file} --access public --tag ${Script.channel} --provenance`,
    exists: () => published(item.name, item.version),
  })

// The platform packages, then the launcher that depends on them.
await Promise.all(stage.tarballs.filter((item) => item.name !== pkg.name).map(run))
await Promise.all(stage.tarballs.filter((item) => item.name === pkg.name).map(run))
console.log(`published ${stage.tarballs.length} npm tarball(s)`)
