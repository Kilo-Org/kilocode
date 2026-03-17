/**
 * Architecture test: package.json ↔ source command sync
 *
 * Every command declared in package.json contributes.commands must have a
 * matching registerCommand() call somewhere in src/. A declaration without
 * an implementation causes a silent "command not found" error at runtime
 * that is hard to diagnose — VS Code shows no warning at activation time.
 */

import { describe, it, expect } from "bun:test"
import fs from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dir, "../..")
const PKG_JSON_FILE = path.join(ROOT, "package.json")
const SRC_DIR = path.join(ROOT, "src")

function readSrcFiles(dir: string): string {
  const parts: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      parts.push(readSrcFiles(full))
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") && !entry.name.endsWith(".spec.ts")) {
      parts.push(fs.readFileSync(full, "utf-8"))
    }
  }
  return parts.join("\n")
}

describe("Extension — package.json command sync", () => {
  const pkg = JSON.parse(fs.readFileSync(PKG_JSON_FILE, "utf-8"))
  const declared: string[] = pkg.contributes?.commands?.map((c: { command: string }) => c.command) ?? []
  const source = readSrcFiles(SRC_DIR)

  // Extract command IDs that appear in registerCommand() calls specifically.
  // This avoids false positives from executeCommand() or other string references.
  const registered = new Set([...source.matchAll(/registerCommand\s*\(\s*["']([^"']+)["']/g)].map((m) => m[1]))

  /**
   * Every command declared in package.json must be registered via registerCommand()
   * somewhere in src/. A bare string match would accept executeCommand() references,
   * which don't actually register a handler.
   *
   * Commands registered via template literals (e.g. jumpTo${i}) are detected by
   * checking the dynamic registerCommand pattern in source instead.
   */
  it("every contributes.commands entry has a registerCommand() call", () => {
    // Commands generated via template literals can't be extracted by regex,
    // so verify the dynamic registration pattern exists in source instead.
    const dynamic: Record<string, string> = {
      "kilo-code.new.agentManager.jumpTo": "registerCommand(`kilo-code.new.agentManager.jumpTo${",
    }

    const missing: string[] = []
    for (const cmd of declared) {
      const entry = Object.entries(dynamic).find(([prefix]) => cmd.startsWith(prefix))
      if (entry) {
        const [, pattern] = entry
        if (!source.includes(pattern)) missing.push(`${cmd} (dynamic pattern not found)`)
        continue
      }
      if (!registered.has(cmd)) missing.push(cmd)
    }

    expect(
      missing,
      `Commands declared in package.json but not registered via registerCommand().\n` +
        `Add registerCommand("...", ...) or remove the declaration:\n` +
        missing.map((m) => `  - ${m}`).join("\n"),
    ).toEqual([])
  })

  /**
   * All declared commands must use the kilo-code.new. prefix.
   * The legacy kilo-code.* namespace (without .new.) belongs to the old
   * extension and must not be reintroduced.
   */
  it("all declared commands use the kilo-code.new. prefix", () => {
    const bad = declared.filter((cmd) => !cmd.startsWith("kilo-code.new."))
    expect(
      bad,
      `Commands without "kilo-code.new." prefix — use the namespaced form:\n` + bad.map((b) => `  - ${b}`).join("\n"),
    ).toEqual([])
  })
})
