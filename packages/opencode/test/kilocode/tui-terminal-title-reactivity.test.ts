import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"

const APP_FILE = path.resolve(import.meta.dir, "../../src/cli/cmd/tui/app.tsx")

describe("terminal title done tracking", () => {
  test("app.tsx untracks the done snapshot passed to getTerminalTitle", () => {
    const content = fs.readFileSync(APP_FILE, "utf-8")

    expect(content).toContain("done: untrack(done)")
  })

  test("app.tsx reads the reactive title icon setting", () => {
    const content = fs.readFileSync(APP_FILE, "utf-8")

    expect(content).toContain("icon: tuiConfig.title_icon")
  })

  test("app.tsx untracks the done guard before setDone", () => {
    const content = fs.readFileSync(APP_FILE, "utf-8")

    expect(content).toContain("const id = kiloTitle.id")
    expect(content).toContain("untrack(() => done()[id]) !== true")
  })
})
