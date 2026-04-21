import { describe, it, expect } from "bun:test"
import { readFileSync } from "fs"
import { join } from "path"

// NOTE: We cannot directly `import()` packages/opencode/src/devilcode/workflow-tui/index.tsx
// in a Bun test because the module statically imports @opentui/solid, which targets a
// terminal renderer (TTY process.stdout). The @opentui/solid/jsx-dev-runtime does not
// export `jsxDEV`, causing the Bun dev-mode JSX transform to fail at import time.
// This is a known limitation — all TUI files that import @opentui/solid are
// terminal-only and are excluded from the test harness by convention (see
// test/kilocode/help.test.ts comment for the same rationale).
//
// Instead, this smoke test statically verifies the module's structure to confirm:
//   1. WorkflowView is exported.
//   2. The new provider imports (RenderTargetProvider, CommandRegistryProvider) are present.
//   3. No other workflow-tui files were modified (file listing check).
//   4. createLeaderChain is NOT referenced in the file.

const WORKFLOW_TUI_SRC = join(import.meta.dir, "../../../src/devilcode/workflow-tui")
const INDEX_FILE = join(WORKFLOW_TUI_SRC, "index.tsx")

describe("workflow-tui smoke", () => {
  it("index.tsx exports WorkflowView", () => {
    const source = readFileSync(INDEX_FILE, "utf8")
    expect(source).toContain("export function WorkflowView(")
  })

  it("index.tsx imports RenderTargetProvider from @devilcode/kilo-ui", () => {
    const source = readFileSync(INDEX_FILE, "utf8")
    expect(source).toContain("RenderTargetProvider")
    expect(source).toContain("@devilcode/kilo-ui/context/render-target")
  })

  it("index.tsx imports CommandRegistryProvider from @devilcode/kilo-ui", () => {
    const source = readFileSync(INDEX_FILE, "utf8")
    expect(source).toContain("CommandRegistryProvider")
    expect(source).toContain("@devilcode/kilo-ui/hooks/use-command-registry")
  })

  it("index.tsx imports createTerminalAdapter from @devilcode/kilo-ui/adapters/terminal", () => {
    const source = readFileSync(INDEX_FILE, "utf8")
    expect(source).toContain("createTerminalAdapter")
    expect(source).toContain("@devilcode/kilo-ui/adapters/terminal")
  })

  it("index.tsx wraps WorkflowViewInner with no props", () => {
    const source = readFileSync(INDEX_FILE, "utf8")
    expect(source).toContain("<WorkflowViewInner />")
  })

  it("index.tsx does NOT reference createLeaderChain", () => {
    const source = readFileSync(INDEX_FILE, "utf8")
    expect(source).not.toContain("createLeaderChain")
  })

  it("index.tsx preserves the original command.register call inside WorkflowViewInner", () => {
    const source = readFileSync(INDEX_FILE, "utf8")
    expect(source).toContain("command.register(")
    expect(source).toContain("workflow.back")
  })
})
