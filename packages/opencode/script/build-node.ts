#!/usr/bin/env bun

import { Script } from "@opencode-ai/script"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "..")

process.chdir(dir)

const generated = await import("./generate.ts")

// Load migrations from migration directories
const migrationDirs = (
  await fs.promises.readdir(path.join(dir, "migration"), {
    withFileTypes: true,
  })
)
  .filter((entry) => entry.isDirectory() && /^\d{4}\d{2}\d{2}\d{2}\d{2}\d{2}/.test(entry.name))
  .map((entry) => entry.name)
  .sort()

const migrations = await Promise.all(
  migrationDirs.map(async (name) => {
    const file = path.join(dir, "migration", name, "migration.sql")
    const sql = await Bun.file(file).text()
    const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(name)
    const timestamp = match
      ? Date.UTC(
          Number(match[1]),
          Number(match[2]) - 1,
          Number(match[3]),
          Number(match[4]),
          Number(match[5]),
          Number(match[6]),
        )
      : 0
    return { sql, timestamp, name }
  }),
)
console.log(`Loaded ${migrations.length} migrations`)

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
    KILO_MIGRATIONS: JSON.stringify(migrations),
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
