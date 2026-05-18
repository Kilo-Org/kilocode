import { describe, expect, it } from "bun:test"
import fs from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dir, "../../../..")
const FILE = path.join(ROOT, "packages/opencode/src/cli/cmd/tui/ui/dialog-export-options.tsx")

describe("TUI export dialog checkbox click contract", () => {
  const source = fs.readFileSync(FILE, "utf-8")

  it("toggles checkbox state when a checkbox row is clicked", () => {
    expect(source).toContain("const toggleOption =")
    expect(source).toContain('setStore("active", option)')
    expect(source).toContain("setStore(option, !store[option])")
    expect(source).toContain('onMouseUp={() => toggleOption("thinking")}')
    expect(source).toContain('onMouseUp={() => toggleOption("toolDetails")}')
    expect(source).toContain('onMouseUp={() => toggleOption("assistantMetadata")}')
    expect(source).toContain('onMouseUp={() => toggleOption("openWithoutSaving")}')
  })
})
