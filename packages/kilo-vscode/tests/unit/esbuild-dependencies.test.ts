import { describe, it, expect } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { builtinModules } from "node:module"

const ROOT = path.resolve(import.meta.dir, "../..")
const PKG_FILE = path.join(ROOT, "package.json")
const ESBUILD_FILE = path.join(ROOT, "esbuild.js")

const BUILTINS = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)])

function extractPackageName(specifier: string): string | null {
  if (specifier.startsWith(".") || specifier.startsWith("/")) return null
  if (BUILTINS.has(specifier)) return null
  if (specifier.startsWith("node:")) return null

  if (specifier.startsWith("@")) {
    const parts = specifier.split("/")
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : specifier
  }
  return specifier.split("/")[0]
}

function findImportsAndRequires(content: string): string[] {
  const specifiers = new Set<string>()
  const requireRegex = /require\(["']([^"']+)["']\)/g
  const importRegex = /(?:import|from)\s+["']([^"']+)["']/g

  for (const match of content.matchAll(requireRegex)) {
    specifiers.add(match[1])
  }
  for (const match of content.matchAll(importRegex)) {
    specifiers.add(match[1])
  }

  return Array.from(specifiers)
}

describe("Build Script Dependency Declarations", () => {
  it("esbuild.js must declare all imported/required packages in package.json", () => {
    const pkg = JSON.parse(fs.readFileSync(PKG_FILE, "utf8"))
    const declared = new Set([
      ...Object.keys(pkg.dependencies || {}),
      ...Object.keys(pkg.devDependencies || {}),
      ...Object.keys(pkg.peerDependencies || {}),
      "vscode",
    ])

    const esbuildContent = fs.readFileSync(ESBUILD_FILE, "utf8")
    const specifiers = findImportsAndRequires(esbuildContent)

    const undeclared: string[] = []
    for (const spec of specifiers) {
      const pkgName = extractPackageName(spec)
      if (pkgName && !declared.has(pkgName)) {
        undeclared.push(`${spec} (package: ${pkgName})`)
      }
    }

    expect(undeclared).toEqual([])
  })
})
