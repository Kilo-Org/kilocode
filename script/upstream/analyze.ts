#!/usr/bin/env bun
/**
 * Analyze upstream changes without merging
 *
 * Generates a detailed conflict report for a target upstream version.
 *
 * Usage:
 *   bun run script/upstream/analyze.ts --version v1.1.49
 *   bun run script/upstream/analyze.ts --commit abc123
 *   bun run script/upstream/analyze.ts --version v1.1.49 --base-branch catrielmuller/kilo-opencode-v1.1.44
 */

import { $ } from "bun"
import * as git from "./utils/git"
import * as version from "./utils/version"
import * as report from "./utils/report"
import { defaultConfig, loadConfig } from "./utils/config"
import { header, info, success, warn, error, divider, list } from "./utils/logger"

interface AnalyzeOptions {
  version?: string
  commit?: string
  output?: string
  baseBranch?: string
}

function parseArgs(): AnalyzeOptions {
  const args = process.argv.slice(2)
  const options: AnalyzeOptions = {}

  const versionIdx = args.indexOf("--version")
  if (versionIdx !== -1 && args[versionIdx + 1]) {
    options.version = args[versionIdx + 1]
  }

  const commitIdx = args.indexOf("--commit")
  if (commitIdx !== -1 && args[commitIdx + 1]) {
    options.commit = args[commitIdx + 1]
  }

  const outputIdx = args.indexOf("--output")
  if (outputIdx !== -1 && args[outputIdx + 1]) {
    options.output = args[outputIdx + 1]
  }

  const baseBranchIdx = args.indexOf("--base-branch")
  if (baseBranchIdx !== -1 && args[baseBranchIdx + 1]) {
    options.baseBranch = args[baseBranchIdx + 1]
  }

  return options
}

async function main() {
  const options = parseArgs()
  const config = loadConfig(options.baseBranch ? { baseBranch: options.baseBranch } : undefined)

  header("Upstream Change Analysis")

  // Check upstream remote
  if (!(await git.hasUpstreamRemote())) {
    error("No 'upstream' remote found. Please add it:")
    info("  git remote add upstream git@github.com:anomalyco/opencode.git")
    process.exit(1)
  }

  // Fetch upstream
  info("Fetching upstream...")
  await git.fetchUpstream()

  // Determine target
  let target: version.VersionInfo | null = null

  if (options.commit) {
    target = await version.getVersionForCommit(options.commit)
    if (!target) {
      target = { version: "unknown", tag: "unknown", commit: options.commit }
    }
  } else if (options.version) {
    const versions = await version.getAvailableUpstreamVersions()
    target = versions.find((v) => v.version === options.version || v.tag === options.version) || null

    if (!target) {
      error(`Version ${options.version} not found`)
      info("Use 'bun run script/upstream/list-versions.ts' to see available versions")
      process.exit(1)
    }
  } else {
    target = await version.getLatestUpstreamVersion()
  }

  if (!target) {
    error("Could not determine target version")
    process.exit(1)
  }

  success(`Analyzing: ${target.tag} (${target.commit.slice(0, 8)})`)
  divider()

  // Analyze conflicts
  info("Analyzing changes...")

  // Use commit hash directly since we may not have the tag fetched locally
  const conflicts = await report.analyzeConflicts(target.commit, config.baseBranch, config.keepOurs)

  // Group by type
  const byType = new Map<string, report.ConflictFile[]>()
  for (const c of conflicts) {
    const list = byType.get(c.type) || []
    list.push(c)
    byType.set(c.type, list)
  }

  // Group by recommendation
  const byRec = new Map<string, report.ConflictFile[]>()
  for (const c of conflicts) {
    const list = byRec.get(c.recommendation) || []
    list.push(c)
    byRec.set(c.recommendation, list)
  }

  console.log()
  success(`Total files changed: ${conflicts.length}`)
  console.log()

  // By type
  info("Changes by type:")
  for (const [type, files] of byType) {
    console.log(`  ${type.padEnd(12)} ${files.length}`)
  }
  console.log()

  // By recommendation
  info("Changes by recommendation:")
  for (const [rec, files] of byRec) {
    const label =
      rec === "keep-ours"
        ? "Keep Devil's"
        : rec === "codemod"
          ? "Auto-transform"
          : rec === "keep-theirs"
            ? "Take upstream"
            : "Manual review"
    console.log(`  ${label.padEnd(16)} ${files.length}`)
  }

  // Show manual review files
  const manual = byRec.get("manual") || []
  if (manual.length > 0 && manual.length <= 20) {
    console.log()
    warn("Files requiring manual review:")
    list(manual.map((f) => f.path))
  }

  // Generate report
  const conflictReport: report.ConflictReport = {
    timestamp: new Date().toISOString(),
    upstreamVersion: target.version,
    upstreamCommit: target.commit,
    baseBranch: config.baseBranch,
    mergeBranch: "",
    totalConflicts: conflicts.length,
    conflicts,
    recommendations: [],
  }

  if (manual.length > 0) {
    conflictReport.recommendations.push(`${manual.length} files require manual review`)
  }

  const codemodFiles = byRec.get("codemod") || []
  if (codemodFiles.length > 0) {
    conflictReport.recommendations.push(`${codemodFiles.length} files will be auto-transformed`)
  }

  const keepOursFiles = byRec.get("keep-ours") || []
  if (keepOursFiles.length > 0) {
    conflictReport.recommendations.push(`${keepOursFiles.length} files will keep Devil's version`)
  }

  // Save report
  const outputPath = options.output || `upstream-analysis-${target.version}.md`
  await report.saveReport(conflictReport, outputPath)

  divider()
  success(`Report saved to ${outputPath}`)

  console.log()
  info("Next steps:")
  info("  1. Review the report")
  info("  2. Run merge with: bun run script/upstream/merge.ts --version " + target.tag)
}

main().catch((err) => {
  error(`Error: ${err}`)
  process.exit(1)
})
