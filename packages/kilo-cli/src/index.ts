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

if (process.argv[2] === "serve" && !process.env.OPENCODE_SSH_ASKPASS_PORT) {
  const { parseStdioServeArgs, runStdioServe } = await import("./stdio-serve")
  const parsed = parseStdioServeArgs(process.argv.slice(2))
  if (parsed) {
    await runStdioServe(parsed)
  } else {
    void import("./serve")
    void import("@opencode/server/process")
    await import("./main")
  }
} else {
  await import("./main")
}
