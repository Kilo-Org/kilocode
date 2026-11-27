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
  // here, after the image digests are known; the npm packages and AUR and Homebrew follow
}
await release()
await publishNpm()
if (!Script.preview) {
  // kilocode_change end
  // kilocode_change start - use verified archive digests without duplicating archives in the signed dist
  const digest = await KiloSbom.digests("dist")
  const arm64Sha = digest("kilo-linux-arm64.tar.gz")
  const x64Sha = digest("kilo-linux-x64.tar.gz")
  const macX64Sha = digest("kilo-darwin-x64.zip")
  const macArm64Sha = digest("kilo-darwin-arm64.zip")
  // kilocode_change end

  const [pkgver, _subver = ""] = Script.version.split(/(-.*)/, 2)

  // arch
  const binaryPkgbuild = [
    "# Maintainer: kilo", // kilocode_change
    "",
    "pkgname='kilo-bin'",
    `pkgver=${pkgver}`,
    `_subver=${_subver}`,
    "options=('!debug' '!strip')",
    "pkgrel=1",
    "pkgdesc='The AI coding agent built for the terminal.'",
    "url='https://github.com/Kilo-Org/kilocode'",
    "arch=('aarch64' 'x86_64')",
    "license=('MIT' 'LGPL-2.0-or-later')", // kilocode_change
    "provides=('kilo')",
    "conflicts=('kilo')",
    "depends=('ripgrep')",
    "",
    `source_aarch64=("\${pkgname}_\${pkgver}_aarch64.tar.gz::https://github.com/Kilo-Org/kilocode/releases/download/v\${pkgver}\${_subver}/kilo-linux-arm64.tar.gz")`,
    `sha256sums_aarch64=('${arm64Sha}')`,

    `source_x86_64=("\${pkgname}_\${pkgver}_x86_64.tar.gz::https://github.com/Kilo-Org/kilocode/releases/download/v\${pkgver}\${_subver}/kilo-linux-x64.tar.gz")`,
    `sha256sums_x86_64=('${x64Sha}')`,
    "",
    "package() {",
    '  install -Dm755 ./kilo "${pkgdir}/usr/lib/kilo/kilo"', // kilocode_change
    '  install -Dm755 ./bwrap "${pkgdir}/usr/lib/kilo/bwrap"', // kilocode_change
    '  install -Dm644 ./kilo-sandbox-mutation-worker.js "${pkgdir}/usr/lib/kilo/kilo-sandbox-mutation-worker.js"', // kilocode_change
    '  install -dm755 "${pkgdir}/usr/bin" "${pkgdir}/usr/lib/kilo/tree-sitter" "${pkgdir}/usr/share/licenses/kilo"', // kilocode_change
    '  cp -r ./tree-sitter/. "${pkgdir}/usr/lib/kilo/tree-sitter/"', // kilocode_change
    '  cp -r ./licenses/. "${pkgdir}/usr/share/licenses/kilo/"', // kilocode_change
    "  printf '%s\\n' '#!/bin/sh' 'export KILO_TREE_SITTER_WASM_DIR=/usr/lib/kilo/tree-sitter' 'exec /usr/lib/kilo/kilo \"$@\"' > \"${pkgdir}/usr/bin/kilo\"", // kilocode_change
    '  chmod 755 "${pkgdir}/usr/bin/kilo"', // kilocode_change
    "}",
    "",
  ].join("\n")

  for (const [pkg, pkgbuild] of [["kilo-bin", binaryPkgbuild]]) {
    for (let i = 0; i < 30; i++) {
      try {
        await $`rm -rf ./dist/aur-${pkg}`
        await $`git clone ssh://aur@aur.archlinux.org/${pkg}.git ./dist/aur-${pkg}`
        await $`cd ./dist/aur-${pkg} && git checkout master`
        await Bun.file(`./dist/aur-${pkg}/PKGBUILD`).write(pkgbuild)
        await $`cd ./dist/aur-${pkg} && makepkg --printsrcinfo > .SRCINFO`
        await $`cd ./dist/aur-${pkg} && git add PKGBUILD .SRCINFO`
        if ((await $`cd ./dist/aur-${pkg} && git diff --cached --quiet`.nothrow()).exitCode === 0) break
        await $`cd ./dist/aur-${pkg} && git commit -m "Update to v${Script.version}"`
        await $`cd ./dist/aur-${pkg} && git push`
        break
      } catch {
        continue
      }
    }
  }

  // Homebrew formula
  const homebrewFormula = [
    "# typed: false",
    "# frozen_string_literal: true",
    "",
    "# This file was generated by GoReleaser. DO NOT EDIT.",
    "class Kilo < Formula", // kilocode_change
    `  desc "The AI coding agent built for the terminal."`,
    `  homepage "https://kilo.ai"`, // kilocode_change
    `  version "${Script.version.split("-")[0]}"`,
    "",
    `  depends_on "ripgrep"`,
    "",
    "  on_macos do",
    "    if Hardware::CPU.intel?",
    `      url "https://github.com/Kilo-Org/kilocode/releases/download/v${Script.version}/kilo-darwin-x64.zip"`,
    `      sha256 "${macX64Sha}"`,
    "",
    "      def install",
    '        libexec.install "kilo", "kilo-sandbox-mutation-worker.js", "tree-sitter"', // kilocode_change
    '        (bin/"kilo").write_env_script libexec/"kilo", KILO_TREE_SITTER_WASM_DIR: libexec/"tree-sitter"', // kilocode_change
    "      end",
    "    end",
    "    if Hardware::CPU.arm?",
    `      url "https://github.com/Kilo-Org/kilocode/releases/download/v${Script.version}/kilo-darwin-arm64.zip"`,
    `      sha256 "${macArm64Sha}"`,
    "",
    "      def install",
    '        libexec.install "kilo", "kilo-sandbox-mutation-worker.js", "tree-sitter"', // kilocode_change
    '        (bin/"kilo").write_env_script libexec/"kilo", KILO_TREE_SITTER_WASM_DIR: libexec/"tree-sitter"', // kilocode_change
    "      end",
    "    end",
    "  end",
    "",
    "  on_linux do",
    "    if Hardware::CPU.intel? and Hardware::CPU.is_64_bit?",
    `      url "https://github.com/Kilo-Org/kilocode/releases/download/v${Script.version}/kilo-linux-x64.tar.gz"`,
    `      sha256 "${x64Sha}"`,
    "      def install",
    '        libexec.install "kilo", "bwrap", "kilo-sandbox-mutation-worker.js", "tree-sitter", "licenses"', // kilocode_change
    '        (bin/"kilo").write_env_script libexec/"kilo", KILO_TREE_SITTER_WASM_DIR: libexec/"tree-sitter"', // kilocode_change
    "      end",
    "    end",
    "    if Hardware::CPU.arm? and Hardware::CPU.is_64_bit?",
    `      url "https://github.com/Kilo-Org/kilocode/releases/download/v${Script.version}/kilo-linux-arm64.tar.gz"`,
    `      sha256 "${arm64Sha}"`,
    "      def install",
    '        libexec.install "kilo", "bwrap", "kilo-sandbox-mutation-worker.js", "tree-sitter", "licenses"', // kilocode_change
    '        (bin/"kilo").write_env_script libexec/"kilo", KILO_TREE_SITTER_WASM_DIR: libexec/"tree-sitter"', // kilocode_change
    "      end",
    "    end",
    "  end",
    "end",
    "",
    "",
  ].join("\n")

  // kilocode_change start - the clone authenticates through the setup-git-committer credential helper
  if (!process.env.GITHUB_TOKEN) {
    console.error("GITHUB_TOKEN is required to update homebrew tap")
    process.exit(1)
  }
  const tap = "https://github.com/Kilo-Org/homebrew-tap.git"
  // kilocode_change end
  await $`rm -rf ./dist/homebrew-tap`
  await $`git clone ${tap} ./dist/homebrew-tap`
  await Bun.file("./dist/homebrew-tap/kilo.rb").write(homebrewFormula) // kilocode_change
  await $`cd ./dist/homebrew-tap && git add kilo.rb` // kilocode_change
  if ((await $`cd ./dist/homebrew-tap && git diff --cached --quiet`.nothrow()).exitCode !== 0) {
    await $`cd ./dist/homebrew-tap && git commit -m "Update to v${Script.version}"`
    await $`cd ./dist/homebrew-tap && git push`
  }
}

// kilocode_change start - record which npm tarballs and container manifests this
// release produced, put that evidence on the draft, check the complete draft and
// publish the release. Homebrew and AUR redistribute the archives described by the
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
