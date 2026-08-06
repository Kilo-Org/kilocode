#!/usr/bin/env bun

import { Script } from "@opencode-ai/script"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "..")

process.chdir(dir)

const generated = await import("./generate.ts")

await Bun.build({
  target: "node",
  // kilocode_change start
  entrypoints: [
    "./src/node.ts",
    "../kilo-sandbox/src/kilo-sandbox-mutation-worker.ts",
    "../kilo-sandbox/src/kilo-sandbox-network-relay.ts",
  ],
  // kilocode_change end
  outdir: "./dist/node",
  format: "esm",
  sourcemap: "linked",
  external: ["jsonc-parser", "@lydell/node-pty"],
  define: {
    KILO_MODELS_DEV: generated.modelsData,
    KILO_SANDBOX_MUTATION_WORKER_PATH: `'./kilo-sandbox-mutation-worker.js'`, // kilocode_change
    KILO_SANDBOX_NETWORK_RELAY_PATH: `'./kilo-sandbox-network-relay.js'`, // kilocode_change
    KILO_SANDBOX_SECCOMP_PATH: "undefined", // kilocode_change
    KILO_CHANNEL: `'${Script.channel}'`,
  },
  files: {
    "opencode-web-ui.gen.ts": "",
  },
})

console.log("Build complete")
