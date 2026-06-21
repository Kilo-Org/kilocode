import { describe, it, expect } from "bun:test"
import {
  computeLineHash,
  formatFileWithHashes,
  stripHashes,
  applyHashEdit,
  HashlineError,
  parseHashRef,
  normalizeHashRef,
  buildHashMap,
  verifyHash,
  computeFileRev,
  extractFileRev,
  getAdaptiveHashLength,
} from "../../src/kilocode/hashline/hashline"

// ---------------------------------------------------------------------------
// computeLineHash
// ---------------------------------------------------------------------------

describe("computeLineHash", () => {
  it("returns lowercase hex of specified length", () => {
    const hash = computeLineHash(0, "function hello() {", 3)
    expect(hash).toMatch(/^[0-9a-f]{3}$/)
  })

  it("is deterministic — same inputs always yield same output", () => {
    const a = computeLineHash(1, "  return 42;", 3)
    const b = computeLineHash(1, "  return 42;", 3)
    expect(a).toBe(b)
  })

  it("ignores trailing whitespace but preserves leading indentation", () => {
    const noTrailing = computeLineHash(0, "  hello  ", 3)
    const withTrailing = computeLineHash(0, "  hello", 3)
    expect(noTrailing).toBe(withTrailing)
  })

  it("produces different hashes for different line indexes", () => {
    const a = computeLineHash(0, "same content", 3)
    const b = computeLineHash(1, "same content", 3)
    expect(a).not.toBe(b)
  })
})

// ---------------------------------------------------------------------------
// getAdaptiveHashLength
// ---------------------------------------------------------------------------

describe("getAdaptiveHashLength", () => {
  it("returns 3 for files ≤ 4096 lines", () => {
    expect(getAdaptiveHashLength(1)).toBe(3)
    expect(getAdaptiveHashLength(4096)).toBe(3)
  })

  it("returns 4 for files > 4096 lines", () => {
    expect(getAdaptiveHashLength(4097)).toBe(4)
    expect(getAdaptiveHashLength(10000)).toBe(4)
  })
})

// ---------------------------------------------------------------------------
// formatFileWithHashes / stripHashes
// ---------------------------------------------------------------------------

describe("formatFileWithHashes", () => {
  const content = "function hello() {\n  return 'world';\n}"

  it("annotates every line with #HL prefix, line number, and hash", () => {
    const annotated = formatFileWithHashes(content)
    const lines = annotated.split("\n")
    for (const line of lines.filter((l) => !l.includes("REV:"))) {
      expect(line).toMatch(/^#HL \d+:[0-9a-f]{2,8}\|/)
    }
  })

  it("produces one annotated line per source line", () => {
    const annotated = formatFileWithHashes(content)
    const sourceLines = content.split("\n").length
    const annotatedLines = annotated.split("\n").filter((l) => l.startsWith("#HL") && !l.includes("REV:"))
    expect(annotatedLines.length).toBe(sourceLines)
  })

  it("includes REV header when includeFileRev=true", () => {
    const annotated = formatFileWithHashes(content, undefined, undefined, true)
    expect(annotated.split("\n")[0]).toMatch(/^#HL REV:[0-9a-f]{8}$/)
  })

  it("omits REV header when includeFileRev=false", () => {
    const annotated = formatFileWithHashes(content, undefined, undefined, false)
    expect(annotated.split("\n")[0]).not.toMatch(/REV:/)
  })
})

describe("stripHashes", () => {
  const content = "function hello() {\n  return 'world';\n}"

  it("round-trips: stripHashes(formatFileWithHashes(x)) === x", () => {
    const annotated = formatFileWithHashes(content)
    const stripped = stripHashes(annotated)
    expect(stripped).toBe(content)
  })

  it("is a no-op on non-annotated content", () => {
    expect(stripHashes(content)).toBe(content)
  })
})

// ---------------------------------------------------------------------------
// parseHashRef / normalizeHashRef
// ---------------------------------------------------------------------------

describe("parseHashRef", () => {
  it("parses a valid reference", () => {
    const ref = parseHashRef("2:f1c")
    expect(ref.line).toBe(2)
    expect(ref.hash).toBe("f1c")
  })

  it("throws INVALID_REF on malformed input", () => {
    expect(() => parseHashRef("not-a-ref")).toThrow()
    expect(() => parseHashRef("")).toThrow()
  })
})

describe("normalizeHashRef", () => {
  it("handles plain refs", () => {
    expect(normalizeHashRef("3:0e7")).toBe("3:0e7")
  })

  it("handles annotated refs like #HL 2:f1c|const x = 1;", () => {
    expect(normalizeHashRef("#HL 2:f1c|const x = 1;")).toBe("2:f1c")
  })

  it("lowercases the hash", () => {
    expect(normalizeHashRef("2:F1C")).toBe("2:f1c")
  })
})

// ---------------------------------------------------------------------------
// verifyHash
// ---------------------------------------------------------------------------

describe("verifyHash", () => {
  const content = "line one\nline two\nline three"

  it("returns valid=true when hash matches", () => {
    const hash = computeLineHash(0, "line one", 3)
    const result = verifyHash(1, hash, content)
    expect(result.valid).toBe(true)
  })

  it("returns HASH_MISMATCH when hash does not match", () => {
    const result = verifyHash(1, "000", content)
    expect(result.valid).toBe(false)
    expect(result.code).toBe("HASH_MISMATCH")
  })

  it("returns TARGET_OUT_OF_RANGE for line beyond file", () => {
    const result = verifyHash(999, "abc", content)
    expect(result.valid).toBe(false)
    expect(result.code).toBe("TARGET_OUT_OF_RANGE")
  })
})

// ---------------------------------------------------------------------------
// buildHashMap
// ---------------------------------------------------------------------------

describe("buildHashMap", () => {
  it("builds a map with '<line>:<hash>' keys", () => {
    const content = "alpha\nbeta\ngamma"
    const map = buildHashMap(content)
    expect(map.size).toBe(3)
    for (const key of map.keys()) {
      expect(key).toMatch(/^\d+:[0-9a-f]{3,8}$/)
    }
  })
})

// ---------------------------------------------------------------------------
// computeFileRev / extractFileRev
// ---------------------------------------------------------------------------

describe("computeFileRev", () => {
  it("returns 8 hex chars", () => {
    expect(computeFileRev("hello world")).toMatch(/^[0-9a-f]{8}$/)
  })

  it("is deterministic", () => {
    expect(computeFileRev("hello")).toBe(computeFileRev("hello"))
  })
})

describe("extractFileRev", () => {
  it("extracts REV from annotated content", () => {
    const content = "some content here"
    const annotated = formatFileWithHashes(content, undefined, undefined, true)
    const rev = extractFileRev(annotated)
    expect(rev).toMatch(/^[0-9a-f]{8}$/)
  })

  it("returns null if no REV header", () => {
    const annotated = formatFileWithHashes("hello")
    expect(extractFileRev(annotated)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// applyHashEdit — successful operations
// ---------------------------------------------------------------------------

describe("applyHashEdit — replace", () => {
  const content = "line one\nline two\nline three"

  it("replaces a single line by hash reference", () => {
    const annotated = formatFileWithHashes(content)
    const refLine = annotated.split("\n").find((l) => l.includes("|line two"))!
    const ref = normalizeHashRef(refLine)

    const result = applyHashEdit({ operation: "replace", startRef: ref, replacement: "line TWO" }, content)
    expect(result.content).toBe("line one\nline TWO\nline three")
    expect(result.startLine).toBe(2)
  })
})

describe("applyHashEdit — insert_after", () => {
  const content = "line one\nline two"

  it("inserts content after the target line", () => {
    const annotated = formatFileWithHashes(content)
    const refLine = annotated.split("\n").find((l) => l.includes("|line one"))!
    const ref = normalizeHashRef(refLine)

    const result = applyHashEdit({ operation: "insert_after", startRef: ref, replacement: "line one-and-a-half" }, content)
    expect(result.content).toBe("line one\nline one-and-a-half\nline two")
  })
})

describe("applyHashEdit — insert_before", () => {
  const content = "line one\nline two"

  it("inserts content before the target line", () => {
    const annotated = formatFileWithHashes(content)
    const refLine = annotated.split("\n").find((l) => l.includes("|line two"))!
    const ref = normalizeHashRef(refLine)

    const result = applyHashEdit({ operation: "insert_before", startRef: ref, replacement: "line one-and-a-half" }, content)
    expect(result.content).toBe("line one\nline one-and-a-half\nline two")
  })
})

describe("applyHashEdit — delete", () => {
  const content = "line one\nline two\nline three"

  it("deletes the target line", () => {
    const annotated = formatFileWithHashes(content)
    const refLine = annotated.split("\n").find((l) => l.includes("|line two"))!
    const ref = normalizeHashRef(refLine)

    const result = applyHashEdit({ operation: "delete", startRef: ref }, content)
    expect(result.content).toBe("line one\nline three")
  })
})

// ---------------------------------------------------------------------------
// applyHashEdit — error conditions
// ---------------------------------------------------------------------------

describe("applyHashEdit — HASH_MISMATCH", () => {
  it("throws HashlineError with code HASH_MISMATCH on bad hash", () => {
    const content = "line one\nline two"
    let caught: unknown
    try {
      applyHashEdit({ operation: "replace", startRef: "1:000", replacement: "new" }, content)
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(HashlineError)
    expect((caught as HashlineError).code).toBe("HASH_MISMATCH")
  })
})

describe("applyHashEdit — MISSING_REPLACEMENT", () => {
  it("throws HashlineError with code MISSING_REPLACEMENT when replacement omitted for replace", () => {
    const content = "line one\nline two"
    const annotated = formatFileWithHashes(content)
    const refLine = annotated.split("\n").find((l) => l.includes("|line one"))!
    const ref = normalizeHashRef(refLine)

    let caught: unknown
    try {
      applyHashEdit({ operation: "replace", startRef: ref }, content)
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(HashlineError)
    expect((caught as HashlineError).code).toBe("MISSING_REPLACEMENT")
  })
})

describe("applyHashEdit — INVALID_REF", () => {
  it("throws HashlineError with code INVALID_REF for malformed reference", () => {
    const content = "line one"
    let caught: unknown
    try {
      applyHashEdit({ operation: "replace", startRef: "bad-ref", replacement: "x" }, content)
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(HashlineError)
    expect((caught as HashlineError).code).toBe("INVALID_REF")
  })
})
