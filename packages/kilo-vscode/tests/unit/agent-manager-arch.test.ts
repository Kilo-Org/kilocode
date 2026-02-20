/**
 * Architecture tests: Agent Manager
 *
 * The agent manager runs in the same webview context as other UI.
 * All its CSS classes must be prefixed with "am-" to avoid conflicts.
 * These tests also verify consistency between CSS definitions and TSX usage,
 * and that the provider sends correct message types for each action.
 */

import { describe, it, expect } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { Project, SyntaxKind } from "ts-morph"

const ROOT = path.resolve(import.meta.dir, "../..")
const CSS_FILE = path.join(ROOT, "webview-ui/agent-manager/agent-manager.css")
const TSX_FILE = path.join(ROOT, "webview-ui/agent-manager/AgentManagerApp.tsx")
const PROVIDER_FILE = path.join(ROOT, "src/agent-manager/AgentManagerProvider.ts")

describe("Agent Manager CSS Prefix", () => {
  it("all class selectors should use am- prefix", () => {
    const css = fs.readFileSync(CSS_FILE, "utf-8")
    const matches = [...css.matchAll(/\.([a-z][a-z0-9-]*)/gi)]
    const names = [...new Set(matches.map((m) => m[1]))]

    const invalid = names.filter((n) => !n!.startsWith("am-"))

    expect(invalid, `Classes missing "am-" prefix: ${invalid.join(", ")}`).toEqual([])
  })

  it("all CSS custom properties should use am- prefix", () => {
    const css = fs.readFileSync(CSS_FILE, "utf-8")
    const matches = [...css.matchAll(/--([a-z][a-z0-9-]*)\s*:/gi)]
    const names = [...new Set(matches.map((m) => m[1]))]

    // Allow kilo-ui design tokens and vscode theme variables used as fallbacks
    const allowed = ["am-", "vscode-", "surface-", "text-", "border-"]
    const invalid = names.filter((n) => !allowed.some((p) => n!.startsWith(p)))

    expect(invalid, `CSS properties missing allowed prefix: ${invalid.join(", ")}`).toEqual([])
  })

  it("all @keyframes should use am- prefix", () => {
    const css = fs.readFileSync(CSS_FILE, "utf-8")
    const matches = [...css.matchAll(/@keyframes\s+([a-z][a-z0-9-]*)/gi)]
    const names = matches.map((m) => m[1])

    const invalid = names.filter((n) => !n!.startsWith("am-"))

    expect(invalid, `Keyframes missing "am-" prefix: ${invalid.join(", ")}`).toEqual([])
  })
})

describe("Agent Manager CSS/TSX Consistency", () => {
  it("all classes used in TSX should be defined in CSS", () => {
    const css = fs.readFileSync(CSS_FILE, "utf-8")
    const tsx = fs.readFileSync(TSX_FILE, "utf-8")

    // Extract am- classes defined in CSS
    const cssMatches = [...css.matchAll(/\.([a-z][a-z0-9-]*)/gi)]
    const defined = new Set(cssMatches.map((m) => m[1]))

    // Extract am- classes referenced in TSX (class="am-..." or `am-...`)
    const tsxMatches = [...tsx.matchAll(/\bam-[a-z0-9-]+/g)]
    const used = [...new Set(tsxMatches.map((m) => m[0]))]

    const missing = used.filter((c) => !defined.has(c))

    expect(missing, `Classes used in TSX but not defined in CSS: ${missing.join(", ")}`).toEqual([])
  })

  it("all am- classes defined in CSS should be used in TSX", () => {
    const css = fs.readFileSync(CSS_FILE, "utf-8")
    const tsx = fs.readFileSync(TSX_FILE, "utf-8")

    // Extract am- classes defined in CSS
    const cssMatches = [...css.matchAll(/\.([a-z][a-z0-9-]*)/gi)]
    const defined = [...new Set(cssMatches.map((m) => m[1]!).filter((n) => n.startsWith("am-")))]

    const unused = defined.filter((c) => !tsx.includes(c!))

    expect(unused, `Classes defined in CSS but not used in TSX: ${unused.join(", ")}`).toEqual([])
  })
})

describe("Agent Manager Provider Messages", () => {
  function getMethodBody(name: string): string {
    const project = new Project({ compilerOptions: { allowJs: true } })
    const source = project.addSourceFileAtPath(PROVIDER_FILE)
    const cls = source.getFirstDescendantByKind(SyntaxKind.ClassDeclaration)
    const method = cls?.getMethod(name)
    expect(method, `method ${name} not found in AgentManagerProvider`).toBeTruthy()
    return method!.getText()
  }

  /**
   * Regression: onAddSessionToWorktree must NOT send agentManager.worktreeSetup
   * because that triggers a full-screen overlay with a spinner. Adding a session
   * to an existing worktree should use agentManager.sessionAdded instead.
   */
  it("onAddSessionToWorktree should not send worktreeSetup messages", () => {
    const body = getMethodBody("onAddSessionToWorktree")
    expect(body).not.toContain("agentManager.worktreeSetup")
  })

  it("onAddSessionToWorktree should send sessionAdded message", () => {
    const body = getMethodBody("onAddSessionToWorktree")
    expect(body).toContain("agentManager.sessionAdded")
  })
})
