import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"

// File-size ratchet for hand-written, non-i18n sources in this package.
//
// The cap of a listed file is its line count at the time it was added, or the
// merged baseline after a base update, rounded up to the nearest 50. Do NOT
// raise a cap to fit new hand-written code. Instead, extract logic into a
// smaller module and call it from the original file. A cap only moves when the
// file is split and the new number reflects the extraction.
//
// Counts use `readFileSync(...).split("\n").length`, the same measure the test
// enforces, so they include a trailing empty line for a newline-terminated file.
const MAX_LINES: Record<string, number> = {
  "webview-ui/src/components/settings/ProviderConnectDialog.tsx": 750,
  "webview-ui/src/components/settings/ProvidersTab.tsx": 700,
  "webview-ui/src/components/settings/PermissionEditor.tsx": 600,
  "webview-ui/src/v2/question.tsx": 550,
  // The v2 base added the custom provider models feature on ed11618cb62; cap is the merged baseline.
  "webview-ui/src/components/settings/CustomProviderDialog.tsx": 932,
  "webview-ui/src/components/settings/agent-behaviour/ModeEditView.tsx": 550,
  "webview-ui/src/components/settings/agent-behaviour/McpSubtab.tsx": 500,
  "webview-ui/src/components/profile/DeviceAuthCard.tsx": 450,
  "webview-ui/src/components/settings/settings-search.ts": 450,
  "webview-ui/src/components/shared/ModelSelector.tsx": 400,
}

const ROOT = path.resolve(import.meta.dir, "..")

describe("file size ratchet", () => {
  test("no listed file exceeds its line cap", () => {
    const report = Object.entries(MAX_LINES)
      .filter(([file]) => fs.existsSync(path.join(ROOT, file)))
      .map(([file, cap]) => {
        const lines = fs.readFileSync(path.join(ROOT, file), "utf-8").split("\n").length
        return { file, cap, lines }
      })

    const overweight = report.filter((entry) => entry.lines > entry.cap)

    expect(
      overweight.length,
      `File too large - needs better modularization.\n\n` +
        report.map((entry) => `  ${entry.file}: ${entry.lines}/${entry.cap} lines`).join("\n") +
        `\n\nDo NOT raise the cap outside a base merge. Extract logic into a smaller module and call it\n` +
        `from the original file, then lower the cap to the extracted count.`,
    ).toBe(0)
  })

  test("every listed file still exists", () => {
    const stale = Object.keys(MAX_LINES).filter((file) => !fs.existsSync(path.join(ROOT, file)))

    expect(
      stale,
      `These files are listed in MAX_LINES but no longer exist. Remove them:\n` +
        stale.map((file) => `  - ${file}`).join("\n"),
    ).toEqual([])
  })
})
