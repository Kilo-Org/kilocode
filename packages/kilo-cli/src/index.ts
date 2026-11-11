#!/usr/bin/env bun

import "./env"
import "./global-boot"
import "./preload"
import { ensurePluginRuntime } from "@opencode/plugin/runtime"

export { ensurePluginRuntime }

// The session database file, before a server reads it. After ./preload, so the upstream modules it loads go through
// the same loader as the rest of the CLI.
const { KiloDatabase } = await import("./database")
await KiloDatabase.select(process.env)

await import("./main")
