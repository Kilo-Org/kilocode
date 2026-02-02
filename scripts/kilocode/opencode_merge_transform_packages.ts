#!/usr/bin/env bun

/**
 * OpenCode -> Kilo Package Transformation Script
 *
 * This script transforms package.json files from upstream opencode naming
 * to Kilo naming conventions. Run this on the preparation branch BEFORE
 * merging to minimize conflicts.
 *
 * Transformations applied:
 * - @opencode-ai/plugin -> @kilocode/plugin
 * - @opencode-ai/sdk -> @kilocode/sdk
 * - opencode (root/cli name) -> @kilocode/cli
 * - bin.opencode -> bin.kilo
 * - Repository URL updates
 */

import { readdir } from "node:fs/promises"

// Package name mappings: upstream -> kilo
const PACKAGE_NAME_MAPPINGS: Record<string, string> = {
  "@opencode-ai/plugin": "@kilocode/plugin",
  "@opencode-ai/sdk": "@kilocode/sdk",
  "@opencode-ai/script": "@opencode-ai/script", // Keep as-is (not published)
  "@opencode-ai/util": "@opencode-ai/util", // Keep as-is (not published)
  opencode: "@kilocode/cli", // Root and CLI package
}

// Dependency reference mappings (for dependencies/devDependencies)
const DEPENDENCY_MAPPINGS: Record<string, string> = {
  "@opencode-ai/plugin": "@kilocode/plugin",
  "@opencode-ai/sdk": "@kilocode/sdk",
}

// Files to skip entirely (we have our own versions)
const SKIP_FILES = ["README.md", "CHANGELOG.md"]

// Directories to skip
const SKIP_DIRS = [".github", "node_modules"]

interface PackageJson {
  name?: string
  version?: string
  bin?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  repository?: { type: string; url: string } | string
  [key: string]: unknown
}

async function findPackageJsonFiles(dir: string): Promise<string[]> {
  const results: string[] = []

  async function walk(currentDir: string) {
    const entries = await readdir(currentDir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = `${currentDir}/${entry.name}`

      if (entry.isDirectory()) {
        if (SKIP_DIRS.includes(entry.name)) continue
        await walk(fullPath)
      } else if (entry.name === "package.json") {
        results.push(fullPath)
      }
    }
  }

  await walk(dir)
  return results
}

function transformPackageJson(pkg: PackageJson, filePath: string): PackageJson {
  const transformed = { ...pkg }

  // Transform package name
  if (pkg.name && PACKAGE_NAME_MAPPINGS[pkg.name]) {
    console.log(`  name: ${pkg.name} -> ${PACKAGE_NAME_MAPPINGS[pkg.name]}`)
    transformed.name = PACKAGE_NAME_MAPPINGS[pkg.name]
  }

  // Transform bin entries
  if (pkg.bin && typeof pkg.bin === "object") {
    const newBin: Record<string, string> = {}
    for (const [key, value] of Object.entries(pkg.bin)) {
      if (key === "opencode") {
        console.log(`  bin: opencode -> kilo`)
        newBin["kilo"] = value.replace("/opencode", "/kilo")
      } else {
        newBin[key] = value
      }
    }
    transformed.bin = newBin
  }

  // Transform dependencies
  for (const depType of ["dependencies", "devDependencies", "peerDependencies"] as const) {
    if (pkg[depType]) {
      const newDeps: Record<string, string> = {}
      for (const [dep, version] of Object.entries(pkg[depType] as Record<string, string>)) {
        if (DEPENDENCY_MAPPINGS[dep]) {
          console.log(`  ${depType}: ${dep} -> ${DEPENDENCY_MAPPINGS[dep]}`)
          newDeps[DEPENDENCY_MAPPINGS[dep]] = version
        } else {
          newDeps[dep] = version
        }
      }
      transformed[depType] = newDeps
    }
  }

  // Transform repository URL
  if (pkg.repository) {
    if (typeof pkg.repository === "object" && pkg.repository.url) {
      if (pkg.repository.url.includes("anomalyco/opencode") || pkg.repository.url.includes("sst/opencode")) {
        console.log(`  repository: -> https://github.com/Kilo-Org/kilo`)
        transformed.repository = {
          type: "git",
          url: "https://github.com/Kilo-Org/kilo",
        }
      }
    }
  }

  return transformed
}

async function main() {
  const cwd = process.cwd()
  console.log(`Scanning for package.json files in ${cwd}...\n`)

  const packageFiles = await findPackageJsonFiles(cwd)
  console.log(`Found ${packageFiles.length} package.json files\n`)

  for (const filePath of packageFiles) {
    console.log(`Processing: ${filePath.replace(cwd, ".")}`)

    const file = Bun.file(filePath)
    const content = await file.text()
    const pkg = JSON.parse(content) as PackageJson

    const transformed = transformPackageJson(pkg, filePath)

    // Only write if changes were made
    if (JSON.stringify(pkg) !== JSON.stringify(transformed)) {
      await Bun.write(filePath, JSON.stringify(transformed, null, 2) + "\n")
      console.log(`  ✓ Updated\n`)
    } else {
      console.log(`  - No changes needed\n`)
    }
  }

  console.log("Package transformation complete!")
}

main().catch(console.error)
