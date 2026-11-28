#!/usr/bin/env bun
import { $ } from "bun"
import pkg from "../package.json"
import { Script } from "@opencode-ai/script"
import { fileURLToPath } from "url"
// kilocode_change start
import fs from "node:fs"
import path from "node:path"
import { NpmPublish } from "./kilocode/npm-publish"
import * as KiloSbom from "./kilocode/sbom"
import * as KiloDraft from "../../../script/kilocode/draft-assets"
import * as Artifact from "../../../script/kilocode/sbom/artifact"
import type { Manifest } from "../../../script/kilocode/sbom/index"
// kilocode_change end

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

// kilocode_change start
const evidence: Manifest.Entry[] = []
/**
 * npm publishes of the packed tarballs, run after the GitHub release is public: the CLI installer
 * and `kilo upgrade` take the version from npm and download the archives from the release.
 */
const pending: { name: string; run: () => Promise<unknown> }[] = []

/** Record SBOM evidence for one npm tarball, or an explicit failure entry that keeps its digest. */
async function describe(file: string | undefined, name: string, version: string) {
  const described = file
    ? await KiloSbom.npmPackage({
        file,
        name,
        release: { version, channel: Script.channel },
        out: path.resolve("dist"),
      }).catch((err) => {
        console.error(`sbom: could not describe ${name}@${version}`, err)
        return undefined
      })
    : undefined
  evidence.push(
    described?.entry ?? {
      artifact: file ? path.basename(file) : `${name}@${version}`,
      sha256: file ? await Artifact.digest(file) : "",
      distribution: "npm",
      error: `SBOM generation failed for ${name}@${version}`,
    },
  )
}

/** Fetch the tarball the registry actually serves for an already-published version. */
async function registry(name: string, version: string) {
  const dest = path.resolve("dist", ".sbom-registry")
  await fs.promises.mkdir(dest, { recursive: true })
  const out = await $`npm pack ${name}@${version} --pack-destination ${dest} --json`
    .quiet()
    .json()
    .catch((err) => {
      console.error(`sbom: could not fetch published ${name}@${version}`, err)
      return undefined
    })
  const filename = (out as { filename?: string }[] | undefined)?.at(0)?.filename
  return filename ? path.join(dest, filename) : undefined
}
// kilocode_change end

async function published(name: string, version: string) {
  return (await $`npm view ${name}@${version} version`.nothrow()).exitCode === 0
}

async function publish(dir: string, name: string, version: string) {
  // GitHub artifact downloads can drop the executable bit, and Docker uses the
  // unpacked dist binaries directly rather than the published tarball.
  if (process.platform !== "win32") await $`chmod -R 755 .`.cwd(dir)
  if (await published(name, version)) {
    console.log(`already published ${name}@${version}`)
    // kilocode_change start - a re-run must still describe what the registry
    // serves, otherwise the distribution manifest shrinks and its upload would
    // replace the complete evidence from the first run.
    await describe(await registry(name, version), name, version)
    // kilocode_change end
    return
  }
  // kilocode_change start - remove stale tarballs so the SBOM subject and the
  // published bytes are provably the file this pack just wrote.
  for (const stale of await Array.fromAsync(new Bun.Glob("*.tgz").scan({ cwd: dir }))) {
    await fs.promises.rm(path.join(dir, stale), { force: true })
  }
  // kilocode_change end
  await $`bun pm pack`.cwd(dir)
  // kilocode_change start - describe the exact tarball, and publish that resolved
  // path rather than a glob once the release is public (see `pending`).
  const packed = await Array.fromAsync(new Bun.Glob("*.tgz").scan({ cwd: dir }))
  if (packed.length !== 1) {
    throw new Error(`bun pm pack must produce exactly one tarball for ${name}, found ${packed.length}`)
  }
  const tarball = packed[0]
  await describe(path.join(dir, tarball), name, version)

  pending.push({
    name,
    run: () =>
      NpmPublish.retry({
        name,
        version,
        run: () => $`npm publish ${tarball} --access public --tag ${Script.channel} --provenance`.cwd(dir),
        exists: () => published(name, version),
      }),
  })
  // kilocode_change end
}

const binaries: Record<string, string> = {}
// kilocode_change start
for (const filepath of new Bun.Glob("*/*/package.json").scanSync({ cwd: "./dist" })) {
  // kilocode_change end
  const pkg = await Bun.file(`./dist/${filepath}`).json()
  binaries[pkg.name] = pkg.version
}
console.log("binaries", binaries)
const version = Object.values(binaries)[0]

await $`mkdir -p ./dist/${pkg.name}`
await $`cp -r ./bin ./dist/${pkg.name}/bin`
await $`cp ./script/postinstall.mjs ./dist/${pkg.name}/postinstall.mjs`
await Bun.file(`./dist/${pkg.name}/LICENSE`).write(await Bun.file("../../LICENSE").text())
await Bun.file(`./dist/${pkg.name}/README.md`).write(await Bun.file("./README.md").text()) // kilocode_change

await Bun.file(`./dist/${pkg.name}/package.json`).write(
  JSON.stringify(
    {
      name: pkg.name, // kilocode_change
      bin: {
        // kilocode_change start
        kilo: `./bin/kilo`,
        kilocode: `./bin/kilo`,
        // kilocode_change end
      },
      scripts: {
        postinstall: "node ./postinstall.mjs",
      },
      version: version,
      license: pkg.license,
      keywords: pkg.keywords, // kilocode_change
      private: pkg.private, // kilocode_change
      os: ["darwin", "linux", "win32"],
      cpu: ["arm64", "x64"],
      optionalDependencies: binaries,
      // kilocode_change start
      repository: {
        type: "git",
        url: "https://github.com/Kilo-Org/kilocode",
      },
      // kilocode_change end
    },
    null,
    2,
  ),
)

const tasks = Object.entries(binaries).map(async ([name]) => {
  await publish(`./dist/${name}`, name, binaries[name])
})
await Promise.all(tasks)
await publish(`./dist/${pkg.name}`, pkg.name, version) // kilocode_change

const image = "ghcr.io/kilo-org/kilocode" // kilocode_change
const platforms = "linux/amd64,linux/arm64"
const tags = [`${image}:${version}`, `${image}:${Script.channel}`]
const tagFlags = tags.flatMap((t) => ["-t", t])

// kilocode_change start - a re-run after the release was published only finishes what the first
// run left: the images were pushed and described before the release was published.
const live = Script.release && !(await KiloDraft.open(Script.version)).draft
// kilocode_change end
// registries
if (!Script.preview && !live) {
  // kilocode_change - images are pushed only before the release is published
  // kilocode_change start - BuildKit attestations are requested explicitly rather
  // than relying on defaults, and the pushed digests are captured so the image
  // SBOM describes an immutable manifest instead of a moving channel tag.
  const metadata = path.resolve("dist", "oci-metadata.json")
  await $`docker buildx build --platform ${platforms} ${tagFlags} --provenance=mode=max --sbom=true --metadata-file ${metadata} --push .`
  evidence.push(...(await describeImages(metadata)))
  // The OpenShell variant is the Dockerfile's openshell stage, built, pushed and described like the main image.
  const variantMetadata = path.resolve("dist", "oci-metadata-openshell.json")
  const variantTagFlags = tags.flatMap((t) => ["-t", `${t}-openshell`])
  await $`docker buildx build --platform ${platforms} ${variantTagFlags} --target openshell --provenance=mode=max --sbom=true --metadata-file ${variantMetadata} --push .`
  evidence.push(...(await describeImages(variantMetadata)))
  // kilocode_change end
  // kilocode_change start - every asset reaches the draft and the draft is checked and published
  // here, after the image digests are known; the npm packages follow. The package-managers job of
  // publish.yml updates AUR and Homebrew after this job (script/kilocode/package-managers.ts).
}
await release()
await publishNpm()
// kilocode_change end

// kilocode_change start - record which npm tarballs and container manifests this
// release produced, put that evidence on the draft, check the complete draft and
// publish the release. AUR and Homebrew redistribute the archives described by the
// archive manifest, so they need no separate evidence. A failure leaves the
// release a draft: published assets cannot be added or replaced later. On a re-run
// after the release was published, nothing is uploaded: the published assets are
// checked, and every npm tarball must be the one the published evidence names.
async function release() {
  if (!Script.release) return
  if (live) return KiloDraft.recheck({ version: Script.version, entries: evidence })
  // Expected coverage is derived from what this release had to produce, not from
  // what happened to be recorded, so a missing package or image is a shortfall.
  const packages = Object.keys(binaries).length + 1
  const images = Script.preview ? 0 : 2 * (platforms.split(",").length + 1) // main image and OpenShell variant
  const described = await KiloSbom.distribution({
    dir: path.resolve("dist"),
    release: { version, channel: Script.channel },
    entries: evidence,
    expected: packages + images,
  })
  await KiloDraft.publish({
    version: Script.version,
    prerelease: Script.preview,
    files: described.files,
    entries: described.manifest.entries,
  })
}

/** Publish the packed npm tarballs: the platform packages, then the launcher that depends on them. */
async function publishNpm() {
  await Promise.all(pending.filter((item) => item.name !== pkg.name).map((item) => item.run()))
  await Promise.all(pending.filter((item) => item.name === pkg.name).map((item) => item.run()))
}

/**
 * Describe each pushed image manifest.
 *
 * BuildKit writes attestation manifests into the same index with an `unknown`
 * platform; those are not images and must not be described as one.
 */
async function describeImages(metadata: string) {
  const digest = await Bun.file(metadata)
    .json()
    .then((data) => data["containerimage.digest"] as string | undefined)
    .catch((err) => {
      console.error("sbom: could not read the container build metadata", err)
      return undefined
    })
  if (!digest) return []

  const index = await $`docker buildx imagetools inspect ${image}@${digest} --raw`
    .nothrow()
    .json()
    .catch((err) => {
      console.error(`sbom: could not inspect ${image}@${digest}`, err)
      return undefined
    })

  const manifests: { digest: string; platform?: string }[] = (index?.manifests ?? [])
    .filter((item: any) => item?.platform?.architecture && item.platform.architecture !== "unknown")
    .map((item: any) => ({ digest: item.digest, platform: `${item.platform.os}/${item.platform.architecture}` }))

  const entries: Manifest.Entry[] = []
  for (const item of [...manifests, { digest, platform: undefined }]) {
    const described = await KiloSbom.ociImage({
      reference: `${image}@${item.digest}`,
      digest: item.digest,
      platform: item.platform,
      release: { version, channel: Script.channel },
      out: path.resolve("dist"),
    }).catch((err) => {
      console.error(`sbom: could not describe ${image}@${item.digest}`, err)
      return undefined
    })
    entries.push(
      described?.entry ?? {
        artifact: KiloSbom.ociName(item.digest, item.platform),
        sha256: item.digest.replace(/^sha256:/, ""),
        distribution: "oci",
        ...(item.platform ? { target: item.platform } : {}),
        error: `SBOM generation failed for ${image}@${item.digest}`,
      },
    )
  }
  return entries
}
// kilocode_change end
