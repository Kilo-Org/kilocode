import { describe, it, expect } from "bun:test"
import { slimPart } from "../../src/kilo-provider/slim-metadata"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function part(tool: string, state: Record<string, unknown>) {
  return { type: "tool", id: "p1", tool, state }
}

function bytes(obj: unknown): number {
  return JSON.stringify(obj).length
}

/**
 * Hard ceiling per slimmed tool state (JSON bytes).  Real slimmed parts
 * should be well under this.  If a slimmer leaks even one file-content
 * field (~50-500 KB each) the test blows past this immediately.
 */
const MAX_SLIM_BYTES = 10_000

const BIG = "x".repeat(200_000) // 200 KB — typical file content size
const DIAG = [
  { range: { start: { line: 1, character: 0 }, end: { line: 1, character: 5 } }, message: "err", severity: 1 },
]

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("slimPart", () => {
  it("passes through non-tool parts unchanged", () => {
    const text = { type: "text", id: "t1", content: "hello" }
    expect(slimPart(text)).toBe(text)
  })

  it("passes through unknown tool types unchanged", () => {
    const p = part("some_new_tool", { status: "completed", metadata: { big: BIG } })
    expect(slimPart(p)).toBe(p)
  })

  // -----------------------------------------------------------------------
  // edit
  // -----------------------------------------------------------------------
  describe("edit", () => {
    const heavy = part("edit", {
      status: "completed",
      input: { filePath: "/a.ts", oldString: "old", newString: "new" },
      output: "Edit applied successfully.",
      metadata: {
        diff: BIG,
        filediff: { file: "/a.ts", before: BIG, after: BIG, additions: 3, deletions: 1 },
        diagnostics: { "/a.ts": DIAG },
      },
    })

    it("stays under size cap", () => {
      expect(bytes(slimPart(heavy))).toBeLessThan(MAX_SLIM_BYTES)
    })

    it("keeps filediff counts and diagnostics", () => {
      const slim = slimPart(heavy) as Record<string, any>
      const meta = slim.state.metadata
      expect(meta.filediff.file).toBe("/a.ts")
      expect(meta.filediff.additions).toBe(3)
      expect(meta.filediff.deletions).toBe(1)
      expect(meta.diagnostics).toEqual({ "/a.ts": DIAG })
    })

    it("keeps output and input intact", () => {
      const slim = slimPart(heavy) as Record<string, any>
      expect(slim.state.output).toBe("Edit applied successfully.")
      expect(slim.state.input.filePath).toBe("/a.ts")
    })

    it("drops unknown heavy metadata fields", () => {
      const withUnknown = part("edit", {
        ...heavy.state,
        metadata: { ...(heavy.state.metadata as object), newUpstreamBlob: BIG, otherData: BIG },
      })
      expect(bytes(slimPart(withUnknown))).toBeLessThan(MAX_SLIM_BYTES)
    })
  })

  // -----------------------------------------------------------------------
  // apply_patch
  // -----------------------------------------------------------------------
  describe("apply_patch", () => {
    const heavy = part("apply_patch", {
      status: "completed",
      input: { patchText: BIG },
      output: "Success. Updated the following files:\n a.ts",
      metadata: {
        diff: BIG,
        files: [
          {
            filePath: "/a.ts",
            relativePath: "a.ts",
            type: "update",
            before: BIG,
            after: BIG,
            diff: BIG,
            additions: 5,
            deletions: 2,
          },
          {
            filePath: "/b.ts",
            relativePath: "b.ts",
            type: "add",
            before: undefined,
            after: BIG,
            diff: BIG,
            additions: 10,
            deletions: 0,
            movePath: undefined,
          },
        ],
        diagnostics: { "/a.ts": DIAG },
      },
    })

    it("stays under size cap", () => {
      expect(bytes(slimPart(heavy))).toBeLessThan(MAX_SLIM_BYTES)
    })

    it("keeps file summary fields and diagnostics", () => {
      const slim = slimPart(heavy) as Record<string, any>
      const meta = slim.state.metadata
      expect(meta.files[0].filePath).toBe("/a.ts")
      expect(meta.files[0].relativePath).toBe("a.ts")
      expect(meta.files[0].type).toBe("update")
      expect(meta.files[0].additions).toBe(5)
      expect(meta.files[1].type).toBe("add")
      expect(meta.diagnostics).toEqual({ "/a.ts": DIAG })
    })

    it("drops unknown heavy metadata fields", () => {
      const withUnknown = part("apply_patch", {
        ...heavy.state,
        metadata: { ...(heavy.state.metadata as object), rawPatch: BIG, snapshot: BIG },
      })
      expect(bytes(slimPart(withUnknown))).toBeLessThan(MAX_SLIM_BYTES)
    })

    it("drops unknown heavy fields inside files[]", () => {
      const withUnknown = part("apply_patch", {
        ...heavy.state,
        metadata: {
          ...(heavy.state.metadata as Record<string, unknown>),
          files: [
            {
              filePath: "/a.ts",
              relativePath: "a.ts",
              type: "update",
              additions: 1,
              deletions: 0,
              newHeavyField: BIG,
              anotherBlob: BIG,
            },
          ],
        },
      })
      expect(bytes(slimPart(withUnknown))).toBeLessThan(MAX_SLIM_BYTES)
    })
  })

  // -----------------------------------------------------------------------
  // multiedit
  // -----------------------------------------------------------------------
  describe("multiedit", () => {
    const heavy = part("multiedit", {
      status: "completed",
      input: { edits: [] },
      output: "Applied 2 edits.",
      metadata: {
        diff: BIG,
        diagnostics: { "/a.ts": DIAG },
        results: [
          {
            filediff: { file: "/a.ts", before: BIG, after: BIG, additions: 1, deletions: 1 },
            diagnostics: { "/a.ts": DIAG },
            diff: BIG,
          },
          { filediff: { file: "/b.ts", before: BIG, after: BIG, additions: 2, deletions: 0 }, diagnostics: {} },
        ],
      },
    })

    it("stays under size cap", () => {
      expect(bytes(slimPart(heavy))).toBeLessThan(MAX_SLIM_BYTES)
    })

    it("keeps filediff counts and per-result diagnostics", () => {
      const slim = slimPart(heavy) as Record<string, any>
      const meta = slim.state.metadata
      expect(meta.results[0].filediff.file).toBe("/a.ts")
      expect(meta.results[0].filediff.additions).toBe(1)
      expect(meta.results[0].diagnostics).toEqual({ "/a.ts": DIAG })
      expect(meta.results[1].filediff.file).toBe("/b.ts")
      expect(meta.diagnostics).toEqual({ "/a.ts": DIAG })
    })

    it("drops unknown heavy metadata fields", () => {
      const withUnknown = part("multiedit", {
        ...heavy.state,
        metadata: { ...(heavy.state.metadata as object), rawCombinedDiff: BIG },
      })
      expect(bytes(slimPart(withUnknown))).toBeLessThan(MAX_SLIM_BYTES)
    })

    it("drops unknown heavy fields inside results[]", () => {
      const withUnknown = part("multiedit", {
        ...heavy.state,
        metadata: {
          ...(heavy.state.metadata as Record<string, unknown>),
          results: [{ filediff: { file: "/a.ts", additions: 1, deletions: 0 }, diagnostics: {}, newBlob: BIG }],
        },
      })
      expect(bytes(slimPart(withUnknown))).toBeLessThan(MAX_SLIM_BYTES)
    })
  })

  // -----------------------------------------------------------------------
  // write
  // -----------------------------------------------------------------------
  describe("write", () => {
    const heavy = part("write", {
      status: "completed",
      input: { filePath: "/a.ts", content: BIG },
      output: "File written.",
      metadata: {
        filepath: "/a.ts",
        exists: true,
        diff: BIG,
        filediff: { file: "/a.ts", before: BIG, after: BIG, additions: 100, deletions: 0 },
        diagnostics: { "/a.ts": DIAG },
      },
    })

    it("stays under size cap", () => {
      expect(bytes(slimPart(heavy))).toBeLessThan(MAX_SLIM_BYTES)
    })

    it("keeps filepath, exists, filediff counts, diagnostics", () => {
      const slim = slimPart(heavy) as Record<string, any>
      const meta = slim.state.metadata
      expect(meta.filepath).toBe("/a.ts")
      expect(meta.exists).toBe(true)
      expect(meta.filediff.file).toBe("/a.ts")
      expect(meta.filediff.additions).toBe(100)
      expect(meta.filediff.deletions).toBe(0)
      expect(meta.diagnostics).toEqual({ "/a.ts": DIAG })
    })

    it("drops unknown heavy metadata fields", () => {
      const withUnknown = part("write", {
        ...heavy.state,
        metadata: { ...(heavy.state.metadata as object), compiled: BIG },
      })
      expect(bytes(slimPart(withUnknown))).toBeLessThan(MAX_SLIM_BYTES)
    })
  })

  // -----------------------------------------------------------------------
  // bash
  // -----------------------------------------------------------------------
  describe("bash", () => {
    const heavy = part("bash", {
      status: "completed",
      input: { command: "ls" },
      output: BIG,
      metadata: { output: BIG },
    })

    it("truncates metadata.output and state.output", () => {
      const slim = slimPart(heavy) as Record<string, any>
      expect(slim.state.metadata.output.length).toBeLessThan(BIG.length)
      expect((slim.state.output as string).length).toBeLessThan(BIG.length)
    })

    it("stays under size cap", () => {
      expect(bytes(slimPart(heavy))).toBeLessThan(MAX_SLIM_BYTES)
    })
  })
})
