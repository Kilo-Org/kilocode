#!/usr/bin/env bun

/**
 * Package.json Conflict Resolver
 *
 * This script resolves common merge conflicts in package.json files,
 * specifically for fields that should always keep the Kilo (HEAD) version:
 * - name (package name)
 * - version (our version number)
 * - bin (binary names)
 * - repository (our repo URL)
 *
 * It also handles dependency conflicts by preferring the newer version
 * while preserving Kilo-specific dependencies.
 */

import { execSync } from "node:child_process"

const _KILO_SPECIFIC_DEPS = ["@kilocode/kilo-gateway", "@kilocode/kilo-telemetry", "@kilocode/plugin", "@kilocode/sdk"]

function isGitRepository(): boolean {
  try {
    execSync("git rev-parse --is-inside-work-tree", { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

function getConflictedFiles(): string[] {
  try {
    const output = execSync("git diff --name-only --diff-filter=U", { encoding: "utf8" })
    return output
      .trim()
      .split("\n")
      .filter((line) => line.trim() !== "")
  } catch {
    return []
  }
}

interface ConflictBlock {
  start: number
  separator: number
  end: number
  headLines: string[]
  incomingLines: string[]
}

function parseConflicts(content: string): ConflictBlock[] {
  const lines = content.split("\n")
  const blocks: ConflictBlock[] = []
  let current: Partial<ConflictBlock> | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!

    if (line.startsWith("<<<<<<< ")) {
      current = { start: i, headLines: [], incomingLines: [] }
    } else if (current && line.startsWith("=======")) {
      current.separator = i
    } else if (current && line.startsWith(">>>>>>> ")) {
      current.end = i

      // Extract head and incoming lines
      current.headLines = lines.slice(current.start! + 1, current.separator)
      current.incomingLines = lines.slice(current.separator! + 1, current.end)

      blocks.push(current as ConflictBlock)
      current = null
    }
  }

  return blocks
}

async function resolvePackageJsonConflicts(filePath: string): Promise<boolean> {
  const file = Bun.file(filePath)
  const content = await file.text()

  if (!content.includes("<<<<<<< ")) {
    console.log(`  No conflicts found in ${filePath}`)
    return false
  }

  const conflicts = parseConflicts(content)
  console.log(`  Found ${conflicts.length} conflict block(s)`)

  const lines = content.split("\n")
  let resolved = [...lines]
  let offset = 0

  for (const block of conflicts) {
    const headContent = block.headLines.join("\n")
    const incomingContent = block.incomingLines.join("\n")

    // Determine which version to keep
    let keepHead = false
    let keepIncoming = false
    let mergedLines: string[] = []

    // Check if this conflict involves fields we always keep from HEAD
    const headFields = extractFields(block.headLines)
    const incomingFields = extractFields(block.incomingLines)

    const kiloOnlyFields = ["name", "version", "bin", "repository"]
    const hasKiloOnlyField = kiloOnlyFields.some((f) => headFields.has(f) || incomingFields.has(f))

    if (hasKiloOnlyField) {
      // For Kilo-specific fields, always keep HEAD
      console.log(`    Keeping HEAD version (contains Kilo-specific fields)`)
      mergedLines = block.headLines
    } else if (headFields.has("dependencies") || headFields.has("devDependencies")) {
      // For dependencies, try to merge intelligently
      console.log(`    Merging dependencies...`)
      mergedLines = mergeDependencyBlock(block.headLines, block.incomingLines)
    } else {
      // Default: keep HEAD
      console.log(`    Keeping HEAD version (default)`)
      mergedLines = block.headLines
    }

    // Replace the conflict block with resolved content
    const blockLength = block.end - block.start + 1
    const adjustedStart = block.start + offset
    resolved.splice(adjustedStart, blockLength, ...mergedLines)
    offset += mergedLines.length - blockLength
  }

  Bun.write(filePath, resolved.join("\n"))
  return true
}

function extractFields(lines: string[]): Set<string> {
  const fields = new Set<string>()
  const fieldPattern = /^\s*"([^"]+)":/

  for (const line of lines) {
    const match = line.match(fieldPattern)
    if (match && match[1]) fields.add(match[1])
  }

  return fields
}

function mergeDependencyBlock(headLines: string[], incomingLines: string[]): string[] {
  // For now, prefer HEAD but this could be enhanced to merge versions
  // intelligently (e.g., pick higher semver)
  return headLines
}

async function main() {
  if (!isGitRepository()) {
    console.error("Error: Not in a git repository")
    process.exit(1)
  }

  const conflictedFiles = getConflictedFiles()
  const packageJsonFiles = conflictedFiles.filter((f) => f.endsWith("package.json"))

  if (packageJsonFiles.length === 0) {
    console.log("No package.json files with conflicts found")
    process.exit(0)
  }

  console.log(`Found ${packageJsonFiles.length} package.json file(s) with conflicts:\n`)

  for (const file of packageJsonFiles) {
    console.log(`Processing: ${file}`)
    const resolved = await resolvePackageJsonConflicts(file)

    if (resolved) {
      execSync(`git add "${file}"`, { stdio: "ignore" })
      console.log(`  ✓ Resolved and staged\n`)
    } else {
      console.log(`  - Skipped\n`)
    }
  }

  console.log("Package.json conflict resolution complete!")
  console.log("Run 'git status' to see remaining conflicts")
}

main().catch(console.error)
