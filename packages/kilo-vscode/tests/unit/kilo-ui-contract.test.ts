/**
 * Runtime contract tests for kilo-vscode's dependencies on @kilocode/kilo-ui.
 *
 * These tests import the upstream UI modules directly and verify at runtime
 * that the exports kilo-vscode depends on still exist with the expected shape.
 *
 * Because the upstream modules use SolidJS JSX (jsxImportSource: "solid-js"),
 * they must be loaded from within packages/kilo-ui/ where bun picks up the
 * correct tsconfig. We use Bun.spawnSync to run a small check script in that
 * context.
 *
 * TypeScript types (OpenFileFn, ToolProps, ToolInfo) are erased at runtime,
 * so those are verified via source analysis on the upstream file.
 */

import { describe, it, expect } from "bun:test"
import fs from "node:fs"
import path from "node:path"

const MONOREPO_ROOT = path.resolve(import.meta.dir, "../../../..")
const KILO_UI_DIR = path.join(MONOREPO_ROOT, "packages/kilo-ui")
const DATA_CONTEXT_FILE = path.join(MONOREPO_ROOT, "packages/ui/src/context/data.tsx")
const MESSAGE_PART_FILE = path.join(MONOREPO_ROOT, "packages/ui/src/components/message-part.tsx")
const KILO_MESSAGE_PART_FILE = path.join(MONOREPO_ROOT, "packages/kilo-ui/src/components/message-part.tsx")

function check(code: string): { ok: boolean; output: string } {
  const result = Bun.spawnSync(["bun", "--conditions=browser", "-e", code], {
    cwd: KILO_UI_DIR,
    stdout: "pipe",
    stderr: "pipe",
  })
  const stdout = result.stdout.toString()
  const stderr = result.stderr.toString()
  return {
    ok: result.exitCode === 0,
    output: stdout + stderr,
  }
}

/**
 * Tool names that kilo-vscode overrides or uses directly.
 * Sources:
 *   - VscodeToolOverrides.tsx: "bash"
 *   - TaskToolExpanded.tsx:    "task"
 *   - TaskToolExpanded.tsx uses getToolInfo() which handles all of these
 */
const TOOL_NAMES_WE_DEPEND_ON = ["bash", "task", "read", "write", "glob", "edit", "todowrite"]

describe("ToolRegistry tool name contract (runtime)", () => {
  it("all tools used by kilo-vscode are registered in ToolRegistry", () => {
    const names = JSON.stringify(TOOL_NAMES_WE_DEPEND_ON)
    const result = check(`
      const hist = { state: null, length: 1, replaceState(s) { hist.state = s }, pushState(s) { hist.state = s }, go() {} }
      const mql = { matches: false, media: "", onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true } }
      globalThis.window = globalThis.window || { history: hist, location: { pathname: "/", search: "", hash: "", href: "/", origin: "" }, scrollTo() {}, addEventListener() {}, removeEventListener() {}, confirm() { return false }, matchMedia() { return mql } }
      const { ToolRegistry } = await import("./src/components/message-part.tsx")
      const names = ${names}
      const missing = names.filter(n => typeof ToolRegistry.render(n) !== "function")
      if (missing.length) {
        console.error("Missing tools: " + missing.join(", "))
        process.exit(1)
      }
      console.log("ok")
      process.exit(0)
    `)
    expect(result.ok, `ToolRegistry check failed: ${result.output}`).toBe(true)
  })
})

describe("getToolInfo() export contract (runtime)", () => {
  it("getToolInfo is an exported function", () => {
    // Note: getToolInfo() calls useI18n() internally, so we cannot invoke it
    // outside a SolidJS rendering context. We verify it exists as a function.
    const result = check(`
      const hist = { state: null, length: 1, replaceState(s) { hist.state = s }, pushState(s) { hist.state = s }, go() {} }
      const mql = { matches: false, media: "", onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true } }
      globalThis.window = globalThis.window || { history: hist, location: { pathname: "/", search: "", hash: "", href: "/", origin: "" }, scrollTo() {}, addEventListener() {}, removeEventListener() {}, confirm() { return false }, matchMedia() { return mql } }
      const { getToolInfo } = await import("./src/components/message-part.tsx")
      if (typeof getToolInfo !== "function") {
        console.error("getToolInfo is " + typeof getToolInfo)
        process.exit(1)
      }
      console.log("ok")
      process.exit(0)
    `)
    expect(result.ok, `getToolInfo check failed: ${result.output}`).toBe(true)
  })

  it("ToolInfo type still declares icon and title fields (source)", () => {
    // ToolInfo is a TypeScript type erased at runtime, so we verify via source
    const src = fs.readFileSync(MESSAGE_PART_FILE, "utf-8")
    expect(src).toMatch(/export type ToolInfo\s*=\s*\{[^}]*icon\s*:/s)
    expect(src).toMatch(/export type ToolInfo\s*=\s*\{[^}]*title\s*:/s)
  })
})

describe("DataProvider contract (runtime)", () => {
  it("DataProvider and useData are exported functions", () => {
    const result = check(`
      import { DataProvider, useData } from "./src/context/data.tsx"
      if (typeof DataProvider !== "function") {
        console.error("DataProvider is " + typeof DataProvider)
        process.exit(1)
      }
      if (typeof useData !== "function") {
        console.error("useData is " + typeof useData)
        process.exit(1)
      }
      console.log("ok")
    `)
    expect(result.ok, `DataProvider check failed: ${result.output}`).toBe(true)
  })

  it("DataProvider accepts onOpenFile prop and exports OpenFileFn (source)", () => {
    // onOpenFile and OpenFileFn are `kilocode_change` additions — TypeScript types
    // erased at runtime, so we verify via source analysis
    const src = fs.readFileSync(DATA_CONTEXT_FILE, "utf-8")
    expect(src).toContain("onOpenFile")
    expect(src).toContain("OpenFileFn")
    expect(src).toMatch(/openFile:\s*props\.onOpenFile/)
  })

  it("DataProvider accepts onOpenDiff prop and exports OpenDiffFn (source)", () => {
    // onOpenDiff and OpenDiffFn are `kilocode_change` additions — TypeScript types
    // erased at runtime, so we verify via source analysis
    const src = fs.readFileSync(DATA_CONTEXT_FILE, "utf-8")
    expect(src).toContain("onOpenDiff")
    expect(src).toContain("OpenDiffFn")
    expect(src).toMatch(/openDiff:\s*props\.onOpenDiff/)
  })
})

describe("Edit tool diff-first click contract (source)", () => {
  const src = fs.readFileSync(KILO_MESSAGE_PART_FILE, "utf-8")

  const editBlockMatch = src.match(/ToolRegistry\.register\(\{\s*name:\s*"edit"[\s\S]*?(?=ToolRegistry\.register\(|$)/)
  const editBlock = editBlockMatch?.[0] ?? ""

  it("edit tool derives before/after content from filediff or input", () => {
    expect(editBlock).toMatch(/filediff\?\.before\s*\?\?.*oldString/)
    expect(editBlock).toMatch(/filediff\?\.after\s*\?\?.*newString/)
  })
})

describe("BasicTool export contract (runtime)", () => {
  it("BasicTool and GenericTool are exported from basic-tool", () => {
    const result = check(`
      const { BasicTool, GenericTool } = await import("./src/components/basic-tool.tsx")
      if (typeof BasicTool !== "function") {
        console.error("BasicTool is " + typeof BasicTool)
        process.exit(1)
      }
      if (typeof GenericTool !== "function") {
        console.error("GenericTool is " + typeof GenericTool)
        process.exit(1)
      }
      console.log("ok")
      process.exit(0)
    `)
    expect(result.ok, `BasicTool export check failed: ${result.output}`).toBe(true)
  })
})
