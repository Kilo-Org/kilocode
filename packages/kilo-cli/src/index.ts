#!/usr/bin/env bun

import "./env"
import "./global-boot"
import "./preload"
import { ensurePluginRuntime } from "@opencode/plugin/runtime"

export { ensurePluginRuntime }

// The session database file, before a server reads it. After ./preload, so the upstream modules it loads go through
// the same loader as the rest of the CLI. The `import` command chooses its own source, so it does not let the automatic
// first-start import run first.
const { KiloDatabase } = await import("./database")
const command = process.argv.slice(2).filter((arg) => !arg.startsWith("-"))
await KiloDatabase.select(process.env, {
  v1: command[0] !== "import",
  status: process.argv.includes("--status"),
})

await import("./main")
