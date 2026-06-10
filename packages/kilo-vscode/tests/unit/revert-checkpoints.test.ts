import { describe, expect, it } from "bun:test"
import fs from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dir, "../..")
const TURN_FILE = path.join(ROOT, "webview-ui/src/components/chat/VscodeSessionTurn.tsx")

const src = fs.readFileSync(TURN_FILE, "utf-8")

describe("message revert checkpoints", () => {
  it("keeps revert actions available after a session is already reverted", () => {
    expect(src).toMatch(/onRevert=\{\s*assistantMessages\(\)\.length > 0\s*\? \(\) =>/)
    expect(src).not.toMatch(/onRevert=\{[\s\S]*?&& !session\.revert\(\)[\s\S]*?\? \(\) =>/)
  })

  it("only marks revert disabled while the agent is busy", () => {
    expect(src).toMatch(/data-revert-disabled=\{\s*assistantMessages\(\)\.length > 0 && session\.status\(\) !== "idle"/)
    expect(src).not.toMatch(/data-revert-disabled=\{[\s\S]*?!session\.revert\(\)/)
  })
})
