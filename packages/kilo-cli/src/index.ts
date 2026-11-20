#!/usr/bin/env bun

import "./env"
import { KiloBinary } from "./binary"
import { ensurePluginRuntime } from "@opencode/plugin/runtime"

export { ensurePluginRuntime }

// Version checks and consent must finish before normal boot initializes the profile.
if (process.argv.length === 3 && process.argv[2] === "--version") {
  const { OPENCODE_VERSION } = await import("@opencode/cli/version")
  console.log(`${KiloBinary} v${OPENCODE_VERSION}`)
} else if (process.argv[2] === "migrate") {
  const { migrationCommand } = await import("./migration/preflight")
  await migrationCommand(process.argv.slice(3))
} else {
  const { beforeBoot } = await import("./migration/cutover")
  if (!(await beforeBoot())) process.exit(0)
  await import("./global-boot")
  await import("./preload")

  // The session database file, before a server reads it. After ./preload, so the upstream modules it loads go through
  // the same loader as the rest of the CLI.
  const { KiloDatabase } = await import("./database")
  await KiloDatabase.select(process.env)

  await import("./main")
}
