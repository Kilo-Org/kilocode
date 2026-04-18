#!/usr/bin/env bun
import { fileURLToPath } from "url"
import { tmpdir } from "os"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

import { $ } from "bun"
import path from "path"

import { createClient } from "@hey-api/openapi-ts"

const file = path.join(tmpdir(), `devil-sdk-openapi-${process.pid}.json`)

await $`bun dev generate > ${file}`.cwd(path.resolve(dir, "../../opencode"))

await createClient({
  input: file,
  output: {
    path: "./src/v2/gen",
    tsConfigPath: path.join(dir, "tsconfig.json"),
    clean: true,
  },
  plugins: [
    {
      name: "@hey-api/typescript",
      exportFromIndex: false,
    },
    {
      name: "@hey-api/sdk",
      instance: "DevilClient",
      exportFromIndex: false,
      auth: false,
      paramsStructure: "flat",
    },
    {
      name: "@hey-api/client-fetch",
      exportFromIndex: false,
      baseUrl: "http://localhost:4096",
    },
  ],
})

await $`bun prettier --write src/gen`
await $`bun prettier --write src/v2`
await $`rm -rf dist tsconfig.tsbuildinfo`
await $`bun tsc`
await $`rm -f ${file}`
