#!/usr/bin/env bun
/**
 * Upstream Merge Orchestration Script
 *
 * Automates the process of merging upstream opencode changes into Kilo.
 *
 * Usage:
 *   bun run script/upstream/merge.ts [options]
 *
 * Options:
 *   --version <version>  Target upstream version (e.g., v1.1.49)
 *   --commit <hash>      Target upstream commit hash
 *   --base-branch <name> Base branch to merge into (default: main)
 *   --dry-run            Preview changes without applying them
 *   --no-push            Don't push branches to remote
 *   --report-only        Only generate conflict report, don't merge
 *   --verbose            Enable verbose logging
 *   --author <name>      Author name for branch prefix (default: from git config)
 */

import { $ } from "bun"
import * as git from "./utils/git"
import * as logger from "./utils/logger"
import * as version from "./utils/version"
import * as report from "./utils/report"
import { defaultConfig, loadConfig, type MergeConfig } from "./utils/config"
import { transformAll as transformPackageNames } from "./transforms/package-names"
import { preserveAllVersions } from "./transforms/preserve-versions"
import { keepOursFiles, resetToOurs } from "./transforms/keep-ours"
import { skipFiles, skipSpecificFiles } from "./transforms/skip-files"
import { transformConflictedI18n, transformAllI18n } from "./transforms/transform-i18n"
// New transforms for auto-resolving more conflict types
import {
  transformConflictedTakeTheirs,
  shouldTakeTheirs,
  transformAllTakeTheirs,
} from "./transforms/transform-take-theirs"
import { transformConflictedTauri, isTauriFile, transformAllTauri } from "./transforms/transform-tauri"
import {
  transformConflictedPackageJson,
  isPackageJson,
  transformAllPackageJson,
} from "./transforms/transform-package-json"
import { transformConflictedScripts, isScriptFile, transformAllScripts } from "./transforms/transform-scripts"
import {
  transformConflictedExtensions,
  isExtensionFile,
  transformAllExtensions,
} from "./transforms/transform-extensions"
import { transformConflictedWeb, isWebFile, transformAllWeb } from "./transforms/transform-web"
import { resolveLockFileConflicts, regenerateLockFiles } from "./transforms/lock-files"

interface MergeOptions {
  version?: string
  commit?: string
  baseBranch?: string
  dryRun: boolean
  push: boolean
  reportOnly: boolean
  verbose: boolean
  author?: string
}

function parseArgs(): MergeOptions {
  const args = process.argv.slice(2)

  const options: MergeOptions = {
    dryRun: args.includes("--dry-run"),
    push: !args.includes("--no-push"),
    reportOnly: args.includes("--report-only"),
    verbose: args.includes("--verbose"),
  }

  const versionIdx = args.indexOf("--version")
  if (versionIdx !== -1 && args[versionIdx + 1]) {
    options.version = args[versionIdx + 1]
  }

  const commitIdx = args.indexOf("--commit")
  if (commitIdx !== -1 && args[commitIdx + 1]) {
    options.commit = args[commitIdx + 1]
  }

  const authorIdx = args.indexOf("--author")
  if (authorIdx !== -1 && args[authorIdx + 1]) {
    options.author = args[authorIdx + 1]
  }

  const baseBranchIdx = args.indexOf("--base-branch")
  if (baseBranchIdx !== -1 && args[baseBranchIdx + 1]) {
    options.baseBranch = args[baseBranchIdx + 1]
  }

  return options
}

async function getAuthor(): Promise<string> {
  const result = await $`git config user.name`.text()
  return result
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, "")
}

async function createBackupBranch(baseBranch: string): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
  const backupName = `backup/${baseBranch}-${timestamp}`

  await git.createBranch(backupName, baseBranch)
  await git.checkout(baseBranch)

  return backupName
}

async function main() {
  const options = parseArgs()
  const config = loadConfig(options.baseBranch ? { baseBranch: options.baseBranch } : undefined)

  if (options.verbose) {
    logger.setVerbose(true)
  }

  logger.header("Kilo Upstream Merge Tool")

  // Step 1: Validate environment
  logger.step(1, 8, "Validating environment...")

  if (!(await git.hasUpstreamRemote())) {
    logger.error("No 'upstream' remote found. Please add it:")
    logger.info("  git remote add upstream git@github.com:anomalyco/opencode.git")
    process.exit(1)
  }

  if (await git.hasUncommittedChanges()) {
    logger.error("Working directory has uncommitted changes. Please commit or stash them first.")
    process.exit(1)
  }

  const currentBranch = await git.getCurrentBranch()
  logger.info(`Current branch: ${currentBranch}`)

  // Step 2: Fetch upstream
  logger.step(2, 8, "Fetching upstream...")

  if (!options.dryRun) {
    await git.fetchUpstream()
  }

  // Step 3: Determine target version/commit
  logger.step(3, 8, "Determining target version...")

  let targetVersion: version.VersionInfo | null = null

  if (options.commit) {
    targetVersion = await version.getVersionForCommit(options.commit)
    if (!targetVersion) {
      targetVersion = {
        version: "unknown",
        tag: "unknown",
        commit: options.commit,
      }
    }
  } else if (options.version) {
    const versions = await version.getAvailableUpstreamVersions()
    targetVersion = versions.find((v) => v.version === options.version || v.tag === options.version) || null

    if (!targetVersion) {
      logger.error(`Version ${options.version} not found in upstream`)
      logger.info("Available versions:")
      for (const v of versions.slice(0, 10)) {
        logger.info(`  - ${v.tag} (${v.commit.slice(0, 8)})`)
      }
      process.exit(1)
    }
  } else {
    targetVersion = await version.getLatestUpstreamVersion()
  }

  if (!targetVersion) {
    logger.error("Could not determine target version")
    process.exit(1)
  }

  logger.success(`Target: ${targetVersion.tag} (${targetVersion.commit.slice(0, 8)})`)

  // Step 4: Generate conflict report
  logger.step(4, 8, "Analyzing potential conflicts...")

  // Use the commit hash or tag directly (tags are fetched, not remote refs)
  const upstreamRef = targetVersion.commit || targetVersion.tag
  const conflicts = await report.analyzeConflicts(upstreamRef, config.baseBranch, config.keepOurs, config.skipFiles)

  const conflictReport: report.ConflictReport = {
    timestamp: new Date().toISOString(),
    upstreamVersion: targetVersion.version,
    upstreamCommit: targetVersion.commit,
    baseBranch: config.baseBranch,
    mergeBranch: "", // Will be set later
    totalConflicts: conflicts.length,
    conflicts,
    recommendations: [],
  }

  // Add recommendations
  const skipCount = conflicts.filter((c) => c.recommendation === "skip").length
  const i18nCount = conflicts.filter((c) => c.recommendation === "i18n-transform").length
  const keepOursCount = conflicts.filter((c) => c.recommendation === "keep-ours").length
  const codemodCount = conflicts.filter((c) => c.recommendation === "codemod").length
  const manualCount = conflicts.filter((c) => c.recommendation === "manual").length

  if (skipCount > 0) {
    conflictReport.recommendations.push(`${skipCount} files will be skipped (auto-removed)`)
  }
  if (i18nCount > 0) {
    conflictReport.recommendations.push(`${i18nCount} i18n files will be auto-transformed`)
  }
  if (keepOursCount > 0) {
    conflictReport.recommendations.push(`${keepOursCount} files will keep Kilo's version`)
  }
  if (codemodCount > 0) {
    conflictReport.recommendations.push(`${codemodCount} files will be processed by codemods`)
  }
  if (manualCount > 0) {
    conflictReport.recommendations.push(`${manualCount} files require manual review`)
  }

  logger.info(`Total files changed: ${conflicts.length}`)
  logger.info(`  - Skip (auto-remove): ${skipCount}`)
  logger.info(`  - i18n transform: ${i18nCount}`)
  logger.info(`  - Keep ours: ${keepOursCount}`)
  logger.info(`  - Codemod: ${codemodCount}`)
  logger.info(`  - Manual review: ${manualCount}`)

  if (options.reportOnly) {
    const reportPath = `upstream-merge-report-${targetVersion.version}.md`
    await report.saveReport(conflictReport, reportPath)
    logger.success(`Report saved to ${reportPath}`)
    process.exit(0)
  }

  if (options.dryRun) {
    logger.info("[DRY-RUN] Would proceed with merge")
    const reportPath = `upstream-merge-report-${targetVersion.version}.md`
    await report.saveReport(conflictReport, reportPath)
    logger.success(`Report saved to ${reportPath}`)
    process.exit(0)
  }

  // Step 5: Create branches
  logger.step(5, 8, "Creating branches...")

  const author = options.author || (await getAuthor())
  const kiloVersion = await version.getCurrentKiloVersion()

  // Create backup branch
  await git.checkout(config.baseBranch)
  await git.pull(config.originRemote)
  const backupBranch = await createBackupBranch(config.baseBranch)
  logger.info(`Created backup branch: ${backupBranch}`)

  // Create Kilo merge branch
  const kiloBranch = `${author}/kilo-opencode-${targetVersion.tag}`
  const kiloBackup = await git.backupAndDeleteBranch(kiloBranch)
  if (kiloBackup) {
    logger.info(`Backed up existing branch to: ${kiloBackup}`)
  }
  await git.createBranch(kiloBranch)

  if (options.push) {
    await git.push(config.originRemote, kiloBranch, true)
  }
  logger.info(`Created Kilo branch: ${kiloBranch}`)

  // Create opencode compatibility branch from upstream commit
  const opencodeBranch = `${author}/opencode-${targetVersion.tag}`
  const opencodeBackup = await git.backupAndDeleteBranch(opencodeBranch)
  if (opencodeBackup) {
    logger.info(`Backed up existing branch to: ${opencodeBackup}`)
  }
  await git.checkout(targetVersion.commit)
  await git.createBranch(opencodeBranch)
  logger.info(`Created opencode branch: ${opencodeBranch}`)

  // Step 6: Apply ALL transformations to opencode branch (pre-merge)
  // This reduces conflicts by transforming upstream code to Kilo conventions BEFORE merging
  logger.step(6, 8, "Applying transformations to opencode branch (pre-merge)...")

  // 6a. Transform package names (opencode-ai -> @kilocode/cli)
  logger.info("Transforming package names...")
  const nameResults = await transformPackageNames({ dryRun: false, verbose: options.verbose })
  logger.success(`Transformed ${nameResults.length} files`)

  // 6b. Preserve Kilo versions
  logger.info("Preserving Kilo versions...")
  const versionResults = await preserveAllVersions({
    dryRun: false,
    verbose: options.verbose,
    targetVersion: kiloVersion,
  })
  logger.success(`Preserved versions in ${versionResults.length} files`)

  // 6c. Transform i18n files (OpenCode -> Kilo branding)
  logger.info("Transforming i18n files...")
  const i18nPreResults = await transformAllI18n({ dryRun: false, verbose: options.verbose })
  const i18nPreCount = i18nPreResults.filter((r) => r.replacements > 0).length
  if (i18nPreCount > 0) {
    logger.success(`Transformed ${i18nPreCount} i18n files with Kilo branding`)
  }

  // 6d. Transform branding-only files (take-theirs patterns)
  logger.info("Transforming branding-only files...")
  const brandingResults = await transformAllTakeTheirs({ dryRun: false, verbose: options.verbose })
  const brandingCount = brandingResults.filter((r) => r.action === "transformed" && r.replacements > 0).length
  if (brandingCount > 0) {
    logger.success(`Transformed ${brandingCount} files with Kilo branding`)
  }

  // 6e. Transform Tauri/Desktop config files
  logger.info("Transforming Tauri/Desktop config files...")
  const tauriPreResults = await transformAllTauri({ dryRun: false, verbose: options.verbose })
  const tauriPreCount = tauriPreResults.filter((r) => r.action === "transformed" && r.replacements > 0).length
  if (tauriPreCount > 0) {
    logger.success(`Transformed ${tauriPreCount} Tauri config files`)
  }

  // 6f. Transform package.json files (names, deps, Kilo injections)
  logger.info("Transforming package.json files...")
  const pkgPreResults = await transformAllPackageJson({ dryRun: false, verbose: options.verbose })
  const pkgPreCount = pkgPreResults.filter((r) => r.action === "transformed" && r.changes.length > 0).length
  if (pkgPreCount > 0) {
    logger.success(`Transformed ${pkgPreCount} package.json files`)
  }

  // 6g. Transform script files (GitHub API references)
  logger.info("Transforming script files...")
  const scriptPreResults = await transformAllScripts({ dryRun: false, verbose: options.verbose })
  const scriptPreCount = scriptPreResults.filter((r) => r.action === "transformed" && r.replacements > 0).length
  if (scriptPreCount > 0) {
    logger.success(`Transformed ${scriptPreCount} script files`)
  }

  // 6h. Transform extension files (Zed, etc.)
  logger.info("Transforming extension files...")
  const extPreResults = await transformAllExtensions({ dryRun: false, verbose: options.verbose })
  const extPreCount = extPreResults.filter((r) => r.action === "transformed" && r.replacements > 0).length
  if (extPreCount > 0) {
    logger.success(`Transformed ${extPreCount} extension files`)
  }

  // 6i. Transform web/docs files
  logger.info("Transforming web/docs files...")
  const webPreResults = await transformAllWeb({ dryRun: false, verbose: options.verbose })
  const webPreCount = webPreResults.filter((r) => r.action === "transformed" && r.replacements > 0).length
  if (webPreCount > 0) {
    logger.success(`Transformed ${webPreCount} web/docs files`)
  }

  // 6j. Reset keep-ours files to Kilo's version
  logger.info("Resetting Kilo-specific files...")
  const keepOursResults = await resetToOurs(config.keepOurs, { dryRun: false, verbose: options.verbose })
  logger.success(`Reset ${keepOursResults.length} files to Kilo's version`)

  // Commit all transformations
  await git.stageAll()
  await git.commit(`refactor: kilo compat for ${targetVersion.tag}`)
  logger.success("Committed pre-merge transformations")

  // Step 7: Merge into Kilo branch
  logger.step(7, 8, "Merging into Kilo branch...")

  await git.checkout(kiloBranch)
  const mergeResult = await git.merge(opencodeBranch)

  if (!mergeResult.success) {
    logger.warn("Merge has conflicts (these should only be files with actual code differences)")
    logger.info("Conflicted files:")
    logger.list(mergeResult.conflicts)

    // Since we applied all branding transforms pre-merge, remaining conflicts should be minimal.
    // These are likely files with kilocode_change markers or actual logic differences.

    // Step 7a: Skip files that shouldn't exist in Kilo
    logger.info("Removing files that shouldn't exist in Kilo...")
    const skipResults = await skipFiles({ dryRun: false, verbose: options.verbose })
    const skippedCount = skipResults.filter((r) => r.action === "removed").length
    if (skippedCount > 0) {
      logger.success(`Skipped ${skippedCount} files (removed from merge)`)
    }

    // Step 7b: Auto-resolve keep-ours conflicts
    logger.info("Keeping Kilo-specific files...")
    const resolved = await keepOursFiles({ dryRun: false, verbose: options.verbose })
    const autoResolved = resolved.filter((r) => r.action === "kept")
    if (autoResolved.length > 0) {
      logger.success(`Auto-resolved ${autoResolved.length} conflicts (kept Kilo's version)`)
    }

    // Step 7c: Try to auto-resolve remaining conflicts with post-merge transforms
    // These handle edge cases where pre-merge transforms might have missed something
    let conflictedFiles = await git.getConflictedFiles()

    if (conflictedFiles.length > 0) {
      logger.info("Attempting to auto-resolve remaining conflicts...")

      // Transform i18n files
      const i18nResults = await transformConflictedI18n(conflictedFiles, { dryRun: false, verbose: options.verbose })
      const i18nTransformed = i18nResults.filter((r) => r.replacements > 0).length
      if (i18nTransformed > 0) {
        logger.success(`Auto-resolved ${i18nTransformed} i18n conflicts`)
      }

      // Transform branding-only files
      conflictedFiles = await git.getConflictedFiles()
      if (conflictedFiles.length > 0) {
        const takeTheirsResults = await transformConflictedTakeTheirs(conflictedFiles, {
          dryRun: false,
          verbose: options.verbose,
        })
        const takeTheirsCount = takeTheirsResults.filter((r) => r.action === "transformed").length
        if (takeTheirsCount > 0) {
          logger.success(`Auto-resolved ${takeTheirsCount} branding conflicts`)
        }
      }

      // Transform Tauri files
      conflictedFiles = await git.getConflictedFiles()
      if (conflictedFiles.length > 0) {
        const tauriResults = await transformConflictedTauri(conflictedFiles, {
          dryRun: false,
          verbose: options.verbose,
        })
        const tauriCount = tauriResults.filter((r) => r.action === "transformed").length
        if (tauriCount > 0) {
          logger.success(`Auto-resolved ${tauriCount} Tauri conflicts`)
        }
      }

      // Transform package.json files
      conflictedFiles = await git.getConflictedFiles()
      if (conflictedFiles.length > 0) {
        const pkgResults = await transformConflictedPackageJson(conflictedFiles, {
          dryRun: false,
          verbose: options.verbose,
        })
        const pkgCount = pkgResults.filter((r) => r.action === "transformed").length
        if (pkgCount > 0) {
          logger.success(`Auto-resolved ${pkgCount} package.json conflicts`)
        }
      }

      // Transform script files
      conflictedFiles = await git.getConflictedFiles()
      if (conflictedFiles.length > 0) {
        const scriptResults = await transformConflictedScripts(conflictedFiles, {
          dryRun: false,
          verbose: options.verbose,
        })
        const scriptCount = scriptResults.filter((r) => r.action === "transformed").length
        if (scriptCount > 0) {
          logger.success(`Auto-resolved ${scriptCount} script conflicts`)
        }
      }

      // Transform extension files
      conflictedFiles = await git.getConflictedFiles()
      if (conflictedFiles.length > 0) {
        const extResults = await transformConflictedExtensions(conflictedFiles, {
          dryRun: false,
          verbose: options.verbose,
        })
        const extCount = extResults.filter((r) => r.action === "transformed").length
        if (extCount > 0) {
          logger.success(`Auto-resolved ${extCount} extension conflicts`)
        }
      }

      // Transform web/docs files
      conflictedFiles = await git.getConflictedFiles()
      if (conflictedFiles.length > 0) {
        const webResults = await transformConflictedWeb(conflictedFiles, {
          dryRun: false,
          verbose: options.verbose,
        })
        const webCount = webResults.filter((r) => r.action === "transformed").length
        if (webCount > 0) {
          logger.success(`Auto-resolved ${webCount} web/docs conflicts`)
        }
      }

      // Resolve lock file conflicts (accept ours, will regenerate later)
      conflictedFiles = await git.getConflictedFiles()
      if (conflictedFiles.length > 0) {
        const lockResults = await resolveLockFileConflicts({
          dryRun: false,
          verbose: options.verbose,
        })
        const lockCount = lockResults.filter((r) => r.action === "resolved").length
        if (lockCount > 0) {
          logger.success(`Resolved ${lockCount} lock file conflicts (will regenerate)`)
        }
      }
    }

    // Check remaining conflicts
    const remaining = await git.getConflictedFiles()
    if (remaining.length > 0) {
      logger.warn(`${remaining.length} conflicts require manual resolution:`)
      logger.list(remaining)
      logger.info("")
      logger.info("These conflicts likely contain kilocode_change markers or have actual code differences.")
      logger.info("After resolving conflicts, run:")
      logger.info("  git add -A && git commit -m 'resolve merge conflicts'")

      // Save report before exiting so user has documentation
      conflictReport.mergeBranch = kiloBranch
      const reportPath = `upstream-merge-report-${targetVersion.version}.md`
      await report.saveReport(conflictReport, reportPath)
      logger.success(`Report saved to ${reportPath}`)

      logger.divider()
      logger.info("Next steps:")
      logger.info("  1. Resolve remaining conflicts manually")
      logger.info("  2. git add -A && git commit -m 'resolve merge conflicts'")
      logger.info(`  3. git push ${config.originRemote} ${kiloBranch}`)
      logger.info("  4. Create PR from " + kiloBranch + " to " + config.baseBranch)
      logger.info("")
      logger.info("To rollback:")
      logger.info(`  git checkout ${config.baseBranch}`)
      logger.info(`  git reset --hard ${backupBranch}`)

      // Exit early - don't continue to finalization steps
      process.exit(1)
    } else {
      await git.stageAll()
      await git.commit(`merge: upstream ${targetVersion.tag}`)
      logger.success("Merge completed - all conflicts auto-resolved!")
    }
  } else {
    logger.success("Merge completed without conflicts!")
    await git.stageAll()
    const hasChanges = await git.hasUncommittedChanges()
    if (hasChanges) {
      await git.commit(`merge: upstream ${targetVersion.tag}`)
    }
  }

  // Step 8: Regenerate lock files and finalize
  logger.step(8, 8, "Regenerating lock files and finalizing...")

  // Regenerate lock files (bun.lock, Cargo.lock, etc.)
  const lockRegenResults = await regenerateLockFiles({ dryRun: false, verbose: options.verbose })
  const regeneratedCount = lockRegenResults.filter((r) => r.action === "regenerated").length
  if (regeneratedCount > 0) {
    logger.success(`Regenerated ${regeneratedCount} lock file(s)`)
    // Stage and commit the regenerated lock files
    await git.stageAll()
    const hasLockChanges = await git.hasUncommittedChanges()
    if (hasLockChanges) {
      await git.commit("chore: regenerate lock files after upstream merge")
      logger.success("Committed regenerated lock files")
    }
  }

  if (options.push) {
    await git.push(config.originRemote, kiloBranch)
    logger.success(`Pushed ${kiloBranch} to ${config.originRemote}`)
  }

  // Update merge branch in report
  conflictReport.mergeBranch = kiloBranch

  // Save final report
  const reportPath = `upstream-merge-report-${targetVersion.version}.md`
  await report.saveReport(conflictReport, reportPath)
  logger.success(`Report saved to ${reportPath}`)

  // Summary
  logger.divider()
  logger.header("Merge Summary")

  logger.info(`Upstream version: ${targetVersion.tag}`)
  logger.info(`Kilo branch: ${kiloBranch}`)
  logger.info(`Opencode branch: ${opencodeBranch}`)
  logger.info(`Backup branch: ${backupBranch}`)
  logger.info(`Report: ${reportPath}`)

  const remainingConflicts = await git.getConflictedFiles()
  if (remainingConflicts.length > 0) {
    logger.warn(`${remainingConflicts.length} conflicts need manual resolution`)
  } else {
    logger.success("All conflicts resolved")
  }

  logger.divider()

  logger.info("Next steps:")
  if (remainingConflicts.length > 0) {
    logger.info("  1. Resolve remaining conflicts")
    logger.info("  2. git add -A && git commit -m 'resolve merge conflicts'")
    logger.info(`  3. git push ${config.originRemote} ${kiloBranch}`)
    logger.info("  4. Create PR from " + kiloBranch + " to " + config.baseBranch)
  } else {
    logger.info("  1. Review changes")
    logger.info("  2. Create PR from " + kiloBranch + " to " + config.baseBranch)
  }

  logger.info("")
  logger.info("To rollback:")
  logger.info(`  git checkout ${config.baseBranch}`)
  logger.info(`  git reset --hard ${backupBranch}`)
}

main().catch((err) => {
  logger.error(`Fatal error: ${err}`)
  process.exit(1)
})
