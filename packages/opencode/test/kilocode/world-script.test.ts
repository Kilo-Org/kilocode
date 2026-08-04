import { describe, expect, test } from "bun:test"
import { homedir } from "node:os"
import path from "node:path"
import { inspect } from "../../src/kilocode/tool/world-script"

describe("world script inspection", () => {
  test("finds every navigated URL and deduplicates it", () => {
    const script = inspect(
      "navigate --url=https://example.com ; tabs open --url https://kilo.ai ; navigate --url https://example.com",
      "/workspace",
    )
    expect(script.urls).toEqual(["https://example.com", "https://kilo.ai"])
    expect(script.evaluates).toBe(false)
  })

  test("resolves file reads and writes against the active directory", () => {
    const root = path.resolve("/workspace/project")
    const script = inspect(
      "evaluate --js-file scripts/check.js ; screenshot --out=artifacts/page.png ; screenshot --out /tmp/final.png",
      root,
    )
    expect(script.reads).toEqual([path.join(root, "scripts/check.js")])
    expect(script.writes).toEqual([path.join(root, "artifacts/page.png"), path.normalize("/tmp/final.png")])
  })

  test("expands home-relative paths before requesting permission", () => {
    const script = inspect("screenshot --out ~/screenshots/page.png", "/workspace")
    expect(script.writes).toEqual([path.join(homedir(), "screenshots/page.png")])
  })

  test("expands environment paths before requesting permission", () => {
    const key = "KILO_WORLD_TEST_OUTPUT"
    const before = process.env[key]
    process.env[key] = path.join(homedir(), "screenshots")
    try {
      const script = inspect(`screenshot --out %${key}%/page.png`, "/workspace")
      expect(script.writes).toEqual([path.join(homedir(), "screenshots/page.png")])
    } finally {
      if (before === undefined) delete process.env[key]
      else process.env[key] = before
    }
  })

  test("rejects agent-controlled session selection", () => {
    expect(() => inspect("status --session another-session", "/workspace")).toThrow("--session is reserved for Kilo")
  })

  test("identifies scripts that execute JavaScript", () => {
    expect(inspect('evaluate --js "document.title"', "/workspace").evaluates).toBe(true)
  })

  test("does not treat unrelated --url and --out flags as capabilities", () => {
    const script = inspect("wait-for --url https://example.com ; evaluate --out secret.txt --js 1", "/workspace")
    expect(script.urls).toEqual([])
    expect(script.writes).toEqual([])
  })
})
