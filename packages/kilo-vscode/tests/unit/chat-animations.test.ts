/**
 * Motion budget for the chat webview.
 *
 * The chat animates the status shimmer, the spinner, and the agent avatars
 * while a session works. Those animations tick on the main thread, so a
 * window that is in the background keeps a renderer busy at the display
 * refresh rate. The budget is the smaller of what the user asked for and
 * what the window can afford.
 */

import { describe, expect, it } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { reduceMotion, resolveAnimations } from "../../webview-ui/src/animations"

const ROOT = path.resolve(import.meta.dir, "../..")

describe("resolveAnimations", () => {
  it("keeps the full motion while the window is focused", () => {
    expect(resolveAnimations("full", true, false)).toBe("full")
    expect(resolveAnimations("reduced", true, false)).toBe("reduced")
  })

  it("pauses the motion while the window is not focused", () => {
    expect(resolveAnimations("full", false, false)).toBe("paused")
    expect(resolveAnimations("reduced", false, false)).toBe("paused")
  })

  it("pauses the motion while the view is hidden", () => {
    expect(resolveAnimations("full", true, true)).toBe("paused")
  })

  it("never adds motion back when the user turned it off", () => {
    expect(resolveAnimations("off", true, false)).toBe("off")
    expect(resolveAnimations("off", false, false)).toBe("off")
    expect(resolveAnimations("off", true, true)).toBe("off")
  })
})

describe("reduceMotion", () => {
  it("stops the script-driven motion the stylesheet cannot reach", () => {
    expect(reduceMotion("off")).toBe(true)
    expect(reduceMotion("paused")).toBe(true)
  })

  it("leaves the one-shot motion alone when the budget is reduced", () => {
    expect(reduceMotion("full")).toBe(false)
    expect(reduceMotion("reduced")).toBe(false)
  })
})

describe("the host's reduce-motion class", () => {
  // VS Code puts vscode-reduce-motion on the webview body when the user asked
  // for reduced motion, and it removes the class again on every style change.
  // Writing on it would take that setting away from the user.
  it("is only read, never written", () => {
    const source = fs.readFileSync(path.join(ROOT, "webview-ui/src/animations.ts"), "utf-8")
    expect(source).not.toContain('toggle("vscode-reduce-motion"')
    expect(source).not.toContain('add("vscode-reduce-motion"')
    expect(source).not.toContain('remove("vscode-reduce-motion"')
  })
})
