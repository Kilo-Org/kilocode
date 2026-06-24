#!/usr/bin/env bun

import { $ } from "bun"
import path from "path"
import { fileURLToPath } from "url"

const rootDir = fileURLToPath(new URL("../../..", import.meta.url))
process.chdir(rootDir)

const reg = process.env.REGISTRY ?? "ghcr.io/kilo-org" // kilocode_change
const tag = process.env.TAG ?? "24.04"
const push = process.argv.includes("--push") || process.env.PUSH === "1"

const root = path.join(rootDir, "package.json")
const pkg = await Bun.file(root).json()
// kilocode_change start - install the same immutable Rust Bun revision as CI and Nix.
const revision = pkg.config?.bunRevision ?? ""
if (!revision) throw new Error("config.bunRevision must be set")
// kilocode_change end

const images = ["base", "bun-node", "jetbrains", "rust", "tauri-linux", "publish"] // kilocode_change

const setup = async () => {
  if (!push) return
  const list = await $`docker buildx ls`.text()
  // kilocode_change start
  if (list.includes("kilo")) {
    await $`docker buildx use kilo`
    return
  }
  await $`docker buildx create --name kilo --use`
  // kilocode_change end
}

await setup()

const platform = "linux/amd64,linux/arm64"

for (const name of images) {
  const image = `${reg}/build/${name}:${tag}`
  const file = `packages/containers/${name}/Dockerfile`
  if (name === "base") {
    if (push) {
      console.log(`docker buildx build --platform ${platform} -f ${file} -t ${image} --push .`)
      await $`docker buildx build --platform ${platform} -f ${file} -t ${image} --push .`
    }
    if (!push) {
      console.log(`docker build -f ${file} -t ${image} .`)
      await $`docker build -f ${file} -t ${image} .`
    }
  }
  if (name === "bun-node") {
    if (push) {
      console.log(
        `docker buildx build --platform ${platform} -f ${file} -t ${image} --build-arg REGISTRY=${reg} --build-arg BUN_REVISION=${revision} --push .`, // kilocode_change
      )
      await $`docker buildx build --platform ${platform} -f ${file} -t ${image} --build-arg REGISTRY=${reg} --build-arg BUN_REVISION=${revision} --push .` // kilocode_change
    }
    if (!push) {
      console.log(
        `docker build -f ${file} -t ${image} --build-arg REGISTRY=${reg} --build-arg BUN_REVISION=${revision} .`,
      ) // kilocode_change
      await $`docker build -f ${file} -t ${image} --build-arg REGISTRY=${reg} --build-arg BUN_REVISION=${revision} .` // kilocode_change
    }
  }
  if (name !== "base" && name !== "bun-node") {
    if (push) {
      console.log(
        `docker buildx build --platform ${platform} -f ${file} -t ${image} --build-arg REGISTRY=${reg} --push .`,
      )
      await $`docker buildx build --platform ${platform} -f ${file} -t ${image} --build-arg REGISTRY=${reg} --push .`
    }
    if (!push) {
      console.log(`docker build -f ${file} -t ${image} --build-arg REGISTRY=${reg} .`)
      await $`docker build -f ${file} -t ${image} --build-arg REGISTRY=${reg} .`
    }
  }

  if (push) {
    console.log(`pushed ${image}`)
  }
}
