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
const EXTENSION_FILE = path.join(ROOT, "src/extension.ts")
const KILO_PROVIDER_FILE = path.join(ROOT, "src/KiloProvider.ts")

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

// ---------------------------------------------------------------------------
// KiloProvider handler wiring — every new KiloProvider() must get
// setContinueInWorktreeHandler() called before resolving its webview.
//
// Regression: tab panels created via openKiloInNewTab() and the TabPanel
// deserializer were missing the handler, causing "Capturing changes..." to
// spin forever because the webview message was silently dropped.
// ---------------------------------------------------------------------------

describe("Extension — KiloProvider handler wiring", () => {
  const ext = fs.readFileSync(EXTENSION_FILE, "utf-8")

  /**
   * Every `new KiloProvider(` in extension.ts must be followed (before the
   * next `new KiloProvider(`) by a `setContinueInWorktreeHandler` call.
   * This prevents future tab/panel additions from silently missing the handler.
   */
  it("every KiloProvider instance gets setContinueInWorktreeHandler wired", () => {
    const pattern = /new KiloProvider\(/g
    const instances: number[] = []
    let match
    while ((match = pattern.exec(ext)) !== null) {
      instances.push(match.index)
    }

    expect(
      instances.length,
      "expected at least 3 KiloProvider instances (sidebar, tab, deserializer)",
    ).toBeGreaterThanOrEqual(3)

    const missing: string[] = []
    for (let i = 0; i < instances.length; i++) {
      const start = instances[i]
      const end = instances[i + 1] ?? ext.length
      const region = ext.slice(start, end)

      if (!region.includes("setContinueInWorktreeHandler")) {
        const line = ext.slice(0, start).split("\n").length
        missing.push(`KiloProvider at line ${line}`)
      }
    }

    expect(
      missing,
      `These KiloProvider instances are missing setContinueInWorktreeHandler.\n` +
        `Without it, "Continue in Worktree" silently no-ops and the spinner\n` +
        `stays stuck on "Capturing changes..." forever.\n\n` +
        missing.map((m) => `  - ${m}`).join("\n"),
    ).toEqual([])
  })

  it("openKiloInNewTab wires setContinueInWorktreeHandler before resolveWebviewPanel", () => {
    const fn = ext.indexOf("function openKiloInNewTab")
    expect(fn, "openKiloInNewTab must exist").toBeGreaterThan(-1)
    const body = ext.slice(fn, fn + 1500)
    const handler = body.indexOf("setContinueInWorktreeHandler")
    const resolve = body.indexOf("resolveWebviewPanel")
    expect(handler, "setContinueInWorktreeHandler must be called").toBeGreaterThan(-1)
    expect(resolve, "resolveWebviewPanel must be called").toBeGreaterThan(-1)
    expect(handler, "handler must be wired before resolving the panel").toBeLessThan(resolve)
  })

  it("TabPanel deserializer wires setContinueInWorktreeHandler before resolveWebviewPanel", () => {
    const serializer = ext.indexOf('"kilo-code.new.TabPanel"')
    expect(serializer, "TabPanel serializer must exist").toBeGreaterThan(-1)
    const body = ext.slice(serializer, serializer + 800)
    const handler = body.indexOf("setContinueInWorktreeHandler")
    const resolve = body.indexOf("resolveWebviewPanel")
    expect(handler, "setContinueInWorktreeHandler must be called in deserializer").toBeGreaterThan(-1)
    expect(resolve, "resolveWebviewPanel must be called in deserializer").toBeGreaterThan(-1)
    expect(handler, "handler must be wired before resolving the panel").toBeLessThan(resolve)
  })
})

// ---------------------------------------------------------------------------
// KiloProvider — continueInWorktree error fallback
//
// Regression: when continueInWorktreeHandler is null, the message handler
// must send an error back to the webview so the spinner resets. Previously
// it silently no-op'd, leaving the UI stuck.
// ---------------------------------------------------------------------------

describe("KiloProvider — continueInWorktree error fallback", () => {
  const helper = fs.readFileSync(path.join(ROOT, "src/kilo-provider/continue-worktree.ts"), "utf-8")

  it("sends error progress when handler is missing", () => {
    expect(helper, "must send error status back to webview").toContain('"error"')
    expect(helper, "must use continueInWorktreeProgress message type").toContain("continueInWorktreeProgress")
    expect(helper, "must handle missing handler case").toContain("no handler registered")
  })
})
