#!/usr/bin/env bun

import "./env"
import { pilotEnabled } from "./migration/pilot"
import { ensurePluginRuntime } from "@opencode/plugin/runtime"

export { ensurePluginRuntime }

// Normal boot creates profile directories and may adopt an earlier DB. Even a declined
// migration must return before either happens.
if (process.argv[2] === "migrate") {
  const { migrationCommand } = await import("./migration/preflight")
  await migrationCommand(process.argv.slice(3))
} else {
  if (pilotEnabled()) {
    const { beforeBoot } = await import("./migration/cutover")
    if (!(await beforeBoot())) process.exit(0)
  }
  await import("./global-boot")
  await import("./preload")

  // The session database file, before a server reads it. After ./preload, so the upstream modules it loads go through
  // the same loader as the rest of the CLI.
  const { KiloDatabase } = await import("./database")
  await KiloDatabase.select(process.env)

  await import("./main")
}
