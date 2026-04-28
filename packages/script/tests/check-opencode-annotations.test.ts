import { describe, expect, test } from "bun:test"
import path from "node:path"

const SOURCE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx"])

function isExempt(file: string) {
  const norm = file.replaceAll("\\", "/").toLowerCase()
  return norm.split("/").some((part) => part.includes("kilocode") || part.includes("devilcode"))
}

function isSource(file: string) {
  return SOURCE_EXTS.has(path.extname(file))
}

const legacy = "kilo" + "code_change"
const marker = `(?:devilcode_change|${legacy})`
const comment = String.raw`(?:\/\/|\{?\s*\/\*)`
const inline = String.raw`(?:^|\s)${comment}\s*${marker}`
const anchored = String.raw`^\s*${comment}\s*${marker}`
const MARKER_PREFIX = new RegExp(`${inline}\\b`)
const NEW_FILE = new RegExp(`${anchored}\\s*-\\s*new\\s*file\\b`)
const BLOCK_START = new RegExp(`${anchored}\\s+start\\b`)
const BLOCK_END = new RegExp(`${anchored}\\s+end\\b`)

function hasMarker(line: string) {
  return MARKER_PREFIX.test(line)
}

function coveredLines(text: string): Set<number> {
  const lines = text.split(/\r?\n/)
  const covered = new Set<number>()

  const first = lines.find((x) => x.trim() !== "")
  if (first?.match(NEW_FILE)) {
    for (let i = 1; i <= lines.length; i++) covered.add(i)
    return covered
  }

  let depth = 0
  for (let i = 0; i < lines.length; i++) {
    const n = i + 1
    const line = lines[i] ?? ""

    if (line.match(BLOCK_START)) {
      depth += 1
      covered.add(n)
      continue
    }

    if (line.match(BLOCK_END)) {
      covered.add(n)
      depth = Math.max(0, depth - 1)
      continue
    }

    if (depth > 0) {
      covered.add(n)
      continue
    }

    if (hasMarker(line)) covered.add(n)
  }

  return covered
}

function checkLine(line: string, covered: Set<number>, n: number): boolean {
  const trim = line.trim()
  if (!trim) return true
  if (hasMarker(trim)) return true
  return covered.has(n)
}

// ─── hasMarker tests ──────────────────────────────────────────────────────────

describe("hasMarker", () => {
  const cases: Array<[string, boolean]> = [
    // JS-style inline
    ["// devilcode_change", true],
    ["  // devilcode_change", true],
    ["const x = 1 // devilcode_change", true],
    ["// devilcode_change start", true],
    ["// devilcode_change end", true],
    ["// devilcode_change - new file", true],
    ["//   devilcode_change", true],
    ["// devilcode_change  ", true],

    // JSX-style inline
    ["{/* devilcode_change */}", true],
    ["  {/* devilcode_change */}", true],
    ["{/* devilcode_change start */}", true],
    ["{/* devilcode_change end */}", true],
    ["{/* devilcode_change - new file */}", true],
    ["{/* devilcode_change - KiloNews added */}", true],
    ["{/*   devilcode_change */}", true],
    ["{/* devilcode_change  */}", true],

    // bare /* */ style
    ["/* devilcode_change */", true],
    ["  /* devilcode_change */", true],
    ["/* devilcode_change start */", true],
    ["/* devilcode_change end */", true],

    // legacy migration markers
    [`// ${legacy}`, true],
    [`{/* ${legacy} start */}`, true],
    [`/* ${legacy} - new file */`, true],

    // Non-markers
    ["const x = 1", false],
    ["<text fg={color}>{label}</text>", false],
    ["// some other comment", false],
    ["{/* just a comment */}", false],
    ["/* something else */", false],
    ['const text = "// devilcode_change"', false],
    ['const text = "/* devilcode_change */"', false],
    ['const text = "{/* devilcode_change */}"', false],
    // typo variants — should NOT match (missing word boundary)
    ["// devilcode_changes", false],
    ["// devilcode_changelog", false],
    ["/* devilcode_change_log */", false],
    ["{/* devilcode_changes */}", false],
    ["// devilcode_changeable", false],
    ["", false],
    ["  ", false],
  ]

  test.each(cases)("input %j → %j", (input, expected) => {
    expect(hasMarker(input)).toBe(expected)
  })
})

// ─── isExempt tests ───────────────────────────────────────────────────────────

describe("isExempt", () => {
  const cases: Array<[string, boolean]> = [
    // exempt — "kilocode" in path
    ["packages/opencode/test/kilocode/bar.test.ts", true],
    ["packages/opencode/src/some/kilocode/deep/path.ts", true],
    // exempt — "devilcode" in path
    ["packages/opencode/src/devilcode/foo.ts", true],
    ["packages/opencode/src/devilcode/deep/nested/file.tsx", true],
    // exempt — "kilocode" in filename
    ["packages/opencode/src/foo/kilocode.ts", true],
    ["packages/opencode/src/bar/kilocode.test.ts", true],
    ["packages/opencode/src/file.kilocode.ts", true],
    // exempt — "devilcode" in filename
    ["packages/opencode/src/foo/devilcode.ts", true],
    // exempt — case-insensitive
    ["packages/opencode/src/KiloCode/foo.ts", true],
    ["packages/opencode/src/KILOCODE/bar.ts", true],
    ["packages/opencode/src/DevilCode/foo.ts", true],
    // NOT exempt
    ["packages/opencode/src/index.ts", false],
    ["packages/opencode/src/cli/cmd/tui/routes/home.tsx", false],
    ["packages/opencode/src/cli/cmd/tui/routes/session/index.tsx", false],
    ["packages/opencode/src/tool/registry.ts", false],
    ["packages/opencode/src/config/config.ts", false],
    ["packages/opencode/src/indexing/search-service.ts", false],
    // path has no "devilcode" or "kilocode" segment — marker text in content doesn't exempt the path
    ["packages/opencode/src/check-opencode-annotations.ts", false],
  ]

  test.each(cases)("%j → exempt=%j", (file, expected) => {
    expect(isExempt(file)).toBe(expected)
  })
})

// ─── isSource tests ───────────────────────────────────────────────────────────

describe("isSource", () => {
  const cases: Array<[string, boolean]> = [
    ["foo.ts", true],
    ["foo.tsx", true],
    ["foo/bar.tsx", true],
    ["foo.js", true],
    ["foo.jsx", true],
    [".json", false],
    [".md", false],
    [".txt", false],
    ["Makefile", false],
    ["foo.go", false],
    ["foo.rs", false],
  ]

  test.each(cases)("%j → isSource=%j", (file, expected) => {
    expect(isSource(file)).toBe(expected)
  })
})

// ─── coveredLines tests ───────────────────────────────────────────────────────

describe("coveredLines", () => {
  test("empty file", () => {
    const covered = coveredLines("")
    expect(covered.size).toBe(0)
  })

  test("file with only whitespace", () => {
    const covered = coveredLines("   \n\n  \n")
    expect(covered.size).toBe(0)
  })

  test("whole-file JS annotation", () => {
    const covered = coveredLines("// devilcode_change - new file\nexport const x = 1\nexport const y = 2")
    expect(covered).toEqual(new Set([1, 2, 3]))
  })

  test("whole-file JSX annotation", () => {
    const covered = coveredLines("{/* devilcode_change - new file */}\nexport const x = 1\nexport const y = 2")
    expect(covered).toEqual(new Set([1, 2, 3]))
  })

  test("JS block markers", () => {
    const text = [
      "const a = 1",
      "// devilcode_change start",
      "const b = 2",
      "const c = 3",
      "// devilcode_change end",
      "const d = 4",
    ].join("\n")
    const covered = coveredLines(text)
    expect(covered).toEqual(new Set([2, 3, 4, 5])) // block markers + content
  })

  test("JSX block markers", () => {
    const text = [
      "const a = 1",
      "{/* devilcode_change start */}",
      "const b = 2",
      "const c = 3",
      "{/* devilcode_change end */}",
      "const d = 4",
    ].join("\n")
    const covered = coveredLines(text)
    expect(covered).toEqual(new Set([2, 3, 4, 5]))
  })

  test("mixed JS and JSX block markers (nested)", () => {
    const text = [
      "// devilcode_change start",
      "{/* devilcode_change start */}",
      "const b = 2",
      "{/* devilcode_change end */}",
      "// devilcode_change end",
    ].join("\n")
    const covered = coveredLines(text)
    expect(covered).toEqual(new Set([1, 2, 3, 4, 5]))
  })

  test("bare /* */ block markers", () => {
    const text = ["/* devilcode_change start */", "const b = 2", "/* devilcode_change end */"].join("\n")
    const covered = coveredLines(text)
    expect(covered).toEqual(new Set([1, 2, 3]))
  })

  test("inline JS marker covers only that line", () => {
    const text = ["const a = 1", "const b = 2 // devilcode_change", "const c = 3"].join("\n")
    const covered = coveredLines(text)
    expect(covered).toEqual(new Set([2]))
  })

  test("inline JSX marker covers only that line", () => {
    const text = ["const a = 1", "{/* devilcode_change */}", "const c = 3"].join("\n")
    const covered = coveredLines(text)
    expect(covered).toEqual(new Set([2]))
  })

  test("inline JS marker with code on same line", () => {
    const text = "const url = Flag.KILO_MODELS_URL || 'https://models.dev' // devilcode_change\n"
    const covered = coveredLines(text)
    expect(covered).toEqual(new Set([1]))
  })

  test("JSX block marker with descriptive suffix", () => {
    const text = [
      "{/* devilcode_change start - Kilo-specific error display */}",
      "<ErrorDisplay />",
      "{/* devilcode_change end */}",
    ].join("\n")
    const covered = coveredLines(text)
    expect(covered).toEqual(new Set([1, 2, 3]))
  })

  test("multiple independent blocks", () => {
    const text = [
      "// devilcode_change start",
      "const a = 1",
      "// devilcode_change end",
      "const b = 2",
      "{/* devilcode_change start */}",
      "const c = 3",
      "{/* devilcode_change end */}",
      "const d = 4",
    ].join("\n")
    const covered = coveredLines(text)
    expect(covered).toEqual(new Set([1, 2, 3, 5, 6, 7]))
  })

  test("marker line with extra text after marker is still covered", () => {
    const text = [
      "const a = 1",
      "// devilcode_change start - this is kilo specific",
      "const b = 2",
      "// devilcode_change end",
    ].join("\n")
    const covered = coveredLines(text)
    expect(covered).toEqual(new Set([2, 3, 4]))
  })

  test("nested block — inner end decrements depth, outer block continues", () => {
    const text = [
      "// devilcode_change start",
      "{/* devilcode_change start */}",
      "const b = 2",
      "{/* devilcode_change end */}",
      "const c = 3",
      "// devilcode_change end",
    ].join("\n")
    const covered = coveredLines(text)
    // Line 1: depth 0→1, covered
    // Line 2: depth 1→2, covered
    // Line 3: depth=2, covered
    // Line 4: inner end, depth 2→1, covered
    // Line 5: depth=1 (outer still open), covered
    // Line 6: outer end, depth 1→0, covered
    expect(covered).toEqual(new Set([1, 2, 3, 4, 5, 6]))
  })

  test("whitespace before marker is handled", () => {
    const text = ["  {/* devilcode_change start */}", "    const b = 2", "  {/* devilcode_change end */}"].join("\n")
    const covered = coveredLines(text)
    expect(covered).toEqual(new Set([1, 2, 3]))
  })

  test("marker text inside string literals does not open a block", () => {
    const text = [
      'const start = "// devilcode_change start"',
      "const uncovered = 1",
      'const end = "// devilcode_change end"',
    ].join("\n")
    const covered = coveredLines(text)
    expect(covered).toEqual(new Set())
  })

  test("marker text inside a string literal is not a whole-file annotation", () => {
    const text = ['"// devilcode_change - new file"', "const uncovered = 1"].join("\n")
    const covered = coveredLines(text)
    expect(covered).toEqual(new Set())
  })
})

// ─── checkLine integration tests ──────────────────────────────────────────────
// Simulates what the main loop does for each added line

describe("checkLine (main loop simulation)", () => {
  function check(text: string, addedLines: number[]): string[] {
    const covered = coveredLines(text)
    const lines = text.split(/\r?\n/)
    const violations: string[] = []
    for (const n of addedLines) {
      const line = lines[n - 1] ?? ""
      const trim = line.trim()
      if (!trim) continue
      if (hasMarker(trim)) continue
      if (!covered.has(n)) violations.push(`line ${n}: ${trim}`)
    }
    return violations
  }

  test("covered line reports no violation", () => {
    const text = ["// devilcode_change start", "const kilo = 1", "// devilcode_change end"].join("\n")
    expect(check(text, [2])).toEqual([])
  })

  test("uncovered line reports violation", () => {
    const text = ["const uncovered = 1", "const also_uncovered = 2"].join("\n")
    expect(check(text, [1, 2])).toEqual(["line 1: const uncovered = 1", "line 2: const also_uncovered = 2"])
  })

  test("empty lines are skipped", () => {
    const text = ["const x = 1", "", "  ", "", "const y = 2"].join("\n")
    expect(check(text, [1, 2, 3, 4, 5])).toEqual(["line 1: const x = 1", "line 5: const y = 2"])
  })

  test("marker lines are skipped even if uncovered", () => {
    // This shouldn't normally happen, but the loop should skip it
    const text = ["{/* devilcode_change */}", "{/* devilcode_change start */}"].join("\n")
    expect(check(text, [1, 2])).toEqual([])
  })

  test("real-world TSX home.tsx pattern", () => {
    const text = [
      '<box width="100%" maxWidth={75}>',
      "  {/* devilcode_change start */}",
      "  <Show when={indexingOn()}>",
      "    <text fg={indexingColor()}>{indexingLabel()}</text>",
      "  </Show>",
      "  {/* devilcode_change end */}",
      "</box>",
    ].join("\n")
    // Only the first and last lines (opening/closing box) should be uncovered
    expect(check(text, [1, 7])).toEqual([`line 1: <box width="100%" maxWidth={75}>`, `line 7: </box>`])
    // Middle lines are covered
    expect(check(text, [2, 3, 4, 5, 6])).toEqual([])
  })

  test("real-world TSX session index.tsx pattern", () => {
    const text = [
      "const foo = 1",
      "{/* devilcode_change start */}",
      '<Match when={props.part.tool === "semantic_search"}>',
      "<SemanticSearch {...toolprops} />",
      "</Match>",
      "{/* devilcode_change end */}",
      "const bar = 2",
    ].join("\n")
    // Lines 1 and 7 are uncovered (not in any block)
    expect(check(text, [1, 7])).toEqual(["line 1: const foo = 1", "line 7: const bar = 2"])
    // Lines 2-6 are covered
    expect(check(text, [2, 3, 4, 5, 6])).toEqual([])
  })

  test("real-world TSX sidebar.tsx pattern", () => {
    const text = [
      "<box>",
      "                {/* devilcode_change start */}",
      "                <SessionTree />",
      "                {/* devilcode_change end */}",
      "</box>",
      "          {/* devilcode_change start */}",
      "          <div>other content</div>",
      "          {/* devilcode_change end */}",
    ].join("\n")
    expect(check(text, [1, 5])).toEqual(["line 1: <box>", "line 5: </box>"])
    expect(check(text, [2, 3, 4, 6, 7, 8])).toEqual([])
  })

  test("real-world TSX permission.tsx inline pattern", () => {
    const text = [
      "{/* devilcode_change */}",
      "<PermissionDeniedCard />",
      "{/* devilcode_change */}",
      "<AnotherKiloComponent />",
    ].join("\n")
    expect(check(text, [2, 4])).toEqual(["line 2: <PermissionDeniedCard />", "line 4: <AnotherKiloComponent />"])
    expect(check(text, [1, 3])).toEqual([])
  })

  test("JS-style session/index.tsx pattern (from existing codebase)", () => {
    const text = ["const foo = 1", "<Toast />", "{/* devilcode_change */}", "<Footer />", "</box>"].join("\n")
    // Line 2 (<Toast />) is NOT covered — it's between <Toast /> and the marker
    expect(check(text, [2, 4])).toEqual(["line 2: <Toast />", "line 4: <Footer />"])
    expect(check(text, [3])).toEqual([])
  })

  test("whole-file annotated file — no violations even for unmarked lines", () => {
    const text = [
      "// devilcode_change - new file",
      "export const kiloFeature = true",
      "export const alsoKilo = 123",
      "export const notMarked = 'oops'",
    ].join("\n")
    expect(check(text, [2, 3, 4])).toEqual([])
  })
})

// ─── Regex edge cases ─────────────────────────────────────────────────────────

describe("MARKER_PREFIX regex edge cases", () => {
  test("handles { followed immediately by /*", () => {
    expect(hasMarker("{/* devilcode_change */}")).toBe(true)
  })

  test("handles { followed by whitespace then /*", () => {
    expect(hasMarker("{ /* devilcode_change */}")).toBe(true)
  })

  test("handles just /* with no brace", () => {
    expect(hasMarker("/* devilcode_change */")).toBe(true)
  })

  test("handles // with no spaces", () => {
    expect(hasMarker("//devilcode_change")).toBe(true)
  })

  test("handles // with lots of spaces", () => {
    expect(hasMarker("//    devilcode_change")).toBe(true)
  })

  test("does not match {/* without devilcode_change", () => {
    expect(hasMarker("{/* some other comment */}")).toBe(false)
  })

  test("does not match /* without devilcode_change", () => {
    expect(hasMarker("/* just a comment */")).toBe(false)
  })

  test("does not match devilcode_changes (word boundary)", () => {
    expect(hasMarker("// devilcode_changes")).toBe(false)
    expect(hasMarker("// devilcode_changelog")).toBe(false)
    expect(hasMarker("{/* devilcode_changes */}")).toBe(false)
    expect(hasMarker("// devilcode_changeable")).toBe(false)
  })
})

// ─── isExempt — Windows paths ─────────────────────────────────────────────────

describe("isExempt — Windows backslash paths", () => {
  test("Windows paths with backslashes", () => {
    expect(isExempt("packages\\opencode\\src\\kilocode\\foo.ts")).toBe(true)
    expect(isExempt("packages\\opencode\\test\\kilocode\\bar.test.ts")).toBe(true)
    expect(isExempt("packages\\opencode\\src\\index.ts")).toBe(false)
  })
})

// ─── coveredLines — additional patterns ───────────────────────────────────────

describe("coveredLines — additional patterns", () => {
  test("block with descriptive suffix is still recognized", () => {
    const text = [
      "{/* devilcode_change start - Kilo-specific indexing display */}",
      "<IndexingStatus />",
      "{/* devilcode_change end */}",
    ].join("\n")
    const covered = coveredLines(text)
    expect(covered).toEqual(new Set([1, 2, 3]))
  })

  test("empty file content", () => {
    const covered = coveredLines("// devilcode_change start\n  \n// devilcode_change end")
    expect(covered).toEqual(new Set([1, 2, 3]))
  })

  test("multiple separate JS inline markers", () => {
    const text = [
      "const a = 1 // devilcode_change",
      "const b = 2",
      "const c = 3 // devilcode_change",
      "const d = 4",
    ].join("\n")
    const covered = coveredLines(text)
    expect(covered).toEqual(new Set([1, 3]))
  })

  test("consecutive block markers (no content)", () => {
    const text = ["// devilcode_change start", "// devilcode_change end"].join("\n")
    const covered = coveredLines(text)
    expect(covered).toEqual(new Set([1, 2]))
  })

  test("block immediately followed by another start", () => {
    const text = [
      "// devilcode_change start",
      "const a = 1",
      "// devilcode_change end",
      "{/* devilcode_change start */}",
      "const b = 2",
      "{/* devilcode_change end */}",
    ].join("\n")
    const covered = coveredLines(text)
    expect(covered).toEqual(new Set([1, 2, 3, 4, 5, 6]))
  })

  test("trailing empty line after block end is not covered", () => {
    const text = "// devilcode_change start\nconst a = 1\n// devilcode_change end\n\n"
    const covered = coveredLines(text)
    // Block ends at line 3; trailing empty line 4 is outside the block
    expect(covered).toEqual(new Set([1, 2, 3]))
  })
})

// ─── checkLine — additional patterns ─────────────────────────────────────────

describe("checkLine — additional patterns", () => {
  function check(text: string, addedLines: number[]): string[] {
    const covered = coveredLines(text)
    const lines = text.split(/\r?\n/)
    const violations: string[] = []
    for (const n of addedLines) {
      const line = lines[n - 1] ?? ""
      const trim = line.trim()
      if (!trim) continue
      if (hasMarker(trim)) continue
      if (!covered.has(n)) violations.push(`line ${n}: ${trim}`)
    }
    return violations
  }

  test("real-world dialog-status.tsx pattern — multiple inline blocks", () => {
    // Based on actual file: packages/opencode/src/cli/cmd/tui/component/dialog-status.tsx
    const text = [
      "{/* devilcode_change start */}",
      "<KiloDialog>",
      "{/* devilcode_change end */}",
      "const normal = 1",
      "  {/* devilcode_change start */}",
      "  <KiloDialog />",
      "  {/* devilcode_change end */}",
    ].join("\n")
    // Lines 4 is uncovered
    expect(check(text, [4])).toEqual(["line 4: const normal = 1"])
    // Lines 1-3 and 5-7 are covered
    expect(check(text, [1, 2, 3, 5, 6, 7])).toEqual([])
  })

  test("real-world TUI routes — line between marker and code should be uncovered", () => {
    // A common mistake: putting code on a different line from the marker
    const text = ["{/* devilcode_change start */}", "", "<KiloIndexing />", "", "{/* devilcode_change end */}"].join("\n")
    // Empty lines (2, 4) are skipped
    expect(check(text, [3])).toEqual([])
    // All non-empty lines (1, 3, 5) are covered
    expect(check(text, [1, 3, 5])).toEqual([])
  })

  test("end marker on same line as content is covered", () => {
    const text = "const a = 1\n{/* devilcode_change end */} // block already closed, still covered\n"
    const covered = coveredLines(text)
    expect(covered).toEqual(new Set([2]))
  })

  test("end marker closes block correctly", () => {
    const text = [
      "// devilcode_change start",
      "const a = 1",
      "// devilcode_change end",
      "const b = 2", // uncovered
    ].join("\n")
    expect(check(text, [1, 2, 3, 4])).toEqual(["line 4: const b = 2"])
  })
})
