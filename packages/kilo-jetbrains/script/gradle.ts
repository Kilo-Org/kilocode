#!/usr/bin/env bun

import { $ } from "bun"
import { join } from "node:path"

const root = join(import.meta.dir, "..")
const gradlew = process.platform === "win32" ? "gradlew.bat" : "./gradlew"
const args = process.argv.slice(2)

if (args.length === 0) {
  console.error("[jetbrains-gradle] ERROR: expected at least one Gradle task")
  process.exit(1)
}

await $`${gradlew} ${args}`.cwd(root)
