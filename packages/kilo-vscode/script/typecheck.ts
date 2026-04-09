#!/usr/bin/env bun
/**
 * Cross-platform typecheck script that runs tsc and filters errors.
 *
 * Replaces the previous bash/grep pipeline so `bun run typecheck` works
 * on Windows without POSIX tools.
 *
 * Usage:
 *   bun script/typecheck.ts                          # check extension
 *   bun script/typecheck.ts --project webview-ui/tsconfig.json  # check webview
 *
 * Filtering rules:
 *   - Only lines matching "error TS" are reported
 *   - Lines starting with ".." (parent node_modules) are excluded
 *   - For the webview project, "@pierre/diffs" errors are also excluded
 */

import { $ } from "bun"

const args = process.argv.slice(2)
const projectIdx = args.indexOf("--project")
const project = projectIdx !== -1 ? args[projectIdx + 1] : undefined
const webview = project?.includes("webview-ui")

const tscArgs = project ? ["--noEmit", "--project", project] : ["--noEmit"]
const result = await $`tsc ${tscArgs}`.nothrow().quiet()
const output = result.stdout.toString() + result.stderr.toString()

const errors = output
  .split("\n")
  .filter((line) => line.includes("error TS"))
  .filter((line) => !line.startsWith(".."))
  .filter((line) => !webview || !line.includes("@pierre/diffs"))

if (errors.length > 0) {
  console.error(errors.join("\n"))
  process.exit(1)
}
