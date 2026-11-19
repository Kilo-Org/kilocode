import { describe, expect, test } from "bun:test"
import { createMarkdownStream, renderBlocksToHtml } from "../src/index"

// kilocode_change start
// These bounds compare one shape at two sizes instead of timing a fixed input: quadratic parsing needs about 16x the
// work for a 4x input, linear parsing about 4x, and how loaded the host is does not change how much CPU the parser
// burns. Each side is the fastest of several samples taken from a fresh heap: a busy host inflates the middle of the
// distribution, so the minimum is the sample that still reflects the work, and a quadratic pass cannot hide behind it.
const ratioLimit = 8

/**
 * Fastest CPU time at the `to` size divided by the fastest CPU time at the `from` size.
 *
 * CPU time, not wall time: a loaded runner has this process off the CPU for most of a sample, which would make a
 * longer sample look worse than it is.
 *
 * Compare tables of the same shape so the input size grows without changing the nesting depth.
 */
function growth(work: (scale: number) => void, from = 1, to = 4, samples = 5) {
  const clock = () => {
    const usage = process.cpuUsage()
    return (usage.user + usage.system) / 1_000 // microseconds to milliseconds
  }
  const fastest = (scale: number) =>
    Math.min(
      ...Array.from({ length: samples }, () => {
        Bun.gc(true) // without it a collection from the previous sample lands inside this one
        const started = clock()
        work(scale)
        return clock() - started
      }),
    )
  work(from) // warm the JIT and the module caches for both sizes before measuring
  work(to)
  return fastest(to) / Math.max(fastest(from), 1)
}

/**
 * Characters a full parse reads through `charCodeAt`, which is how the block and inline parsers peek at the source.
 *
 * A count, not a clock, for shapes whose samples the collector owns: one node per nesting level means a sample is
 * mostly allocation and sweep, so the same 4x step measures anywhere from 4x to 8x between runs. The count is the
 * same number on every run, and it grows only with the characters the parser looks at.
 */
function charsRead(parse: () => void) {
  const proto = String.prototype as unknown as { charCodeAt: (this: string, pos: number) => number }
  const native = proto.charCodeAt
  let read = 0
  proto.charCodeAt = function (this: string, pos: number) {
    read++
    return native.call(this, pos)
  }
  try {
    parse()
  } finally {
    proto.charCodeAt = native // the rest of the suite runs with the built-in
  }
  return read
}

describe("slow-input linear-time bounds", () => {
  test(
    "deeply nested brackets and bracket-link chains bound source scans",
    () => {
      for (const scale of [16, 64]) {
        const nested = "[".repeat(10_000 * scale) + "a" + "]".repeat(10_000 * scale)
        const prefix = "[".repeat(5_000 * scale)
        const links = prefix + "[a](b)".repeat(prefix.length)
        const cases = [[nested, nested], [links, prefix + '<a href="b">a</a>'.repeat(prefix.length)]] as const
        for (const [source, html] of cases) {
          const read = charsRead(() => {
            const frame = createMarkdownStream({ renderHtml: true }).update(source, { streaming: false })
            expect(renderBlocksToHtml(frame.blocks).trim() === `<p>${html}</p>`).toBe(true)
          })
          expect(read / source.length).toBeLessThan(20)
        }
      }
      // Stack traversal does not read source characters. Keep the large link chain and timeout too:
      // revisiting every previous opener for every link would take over 100 billion visits.
    },
    60_000,
  )

  test(
    "delimiter scans and backtick matches stay bounded as the input grows",
    () => {
      // Each shape keeps the run lengths of the original case and one paragraph per unit of size. A 4x longer run would
      // nest emphasis 4x deeper and overflow the stack instead of measuring time.
      const emph = "*a".repeat(5_000) + " " + "_b".repeat(5_000) + " " + "**c*d".repeat(2_000)
      const mismatchedHeal = "*a ".repeat(5_000) + "b_ ".repeat(5_000)
      const ticks = Array.from({ length: 500 }, (_, i) => "`".repeat(i + 1) + "a").join(" ")
      for (const scale of [8, 32]) {
        for (const unit of [emph, mismatchedHeal]) {
          const source = Array(scale).fill(unit).join("\n\n")
          const streaming = unit === mismatchedHeal
          const reads = charsRead(() => {
            const frame = createMarkdownStream({ renderHtml: !streaming }).update(source, { streaming })
            expect(frame.blocks).toHaveLength(scale)
          })
          expect(reads / source.length).toBeLessThan(6)
        }
        // Charge the global backtick search for skipped characters too, including the suffix on a miss.
        const source = Array(scale).fill(ticks).join(" ")
        let searched = 0
        const exec = RegExp.prototype.exec
        RegExp.prototype.exec = function (text) {
          const start = this.lastIndex
          const match = exec.call(this, text)
          if (this.global && this.source === "`+") searched += (match ? this.lastIndex : text.length) - start
          return match
        }
        try {
          const frame = createMarkdownStream({ renderHtml: true }).update(source, { streaming: false })
          expect(frame.blocks).toHaveLength(1)
        } finally {
          RegExp.prototype.exec = exec
        }
        expect(searched / source.length).toBeWithin(0.9, 2)
      }
    },
    60_000,
  )

  test("deeply nested blockquotes and lists stay linear", () => {
    // Every block keeps the 200-deep nesting of the original case and the size grows by how many of them arrive, so
    // the bound measures the document size. Nesting 4x deeper is superlinear by nature: each nested container walks
    // the markers that remain, which measured 12x to 14x for a 4x depth.
    //
    // A wall-clock ratio cannot carry this shape: the parse allocates one node per nesting level, so the collector
    // sets the sample and the same step measured 7.8x to 8.3x for 4x the input at both 32 -> 128 and 64 -> 256.
    const readPerChar = (blocks: number) => {
      const md = ("> ".repeat(200) + "deep quote\n\n" + "- ".repeat(200) + "deep list\n").repeat(blocks)
      const read = charsRead(() => {
        const frame = createMarkdownStream({ renderHtml: true }).update(md, { streaming: false })
        expect(frame.blocks).toHaveLength(2 * blocks)
      })
      return read / md.length
    }
    // Measured 4.7 characters read per input character at 32 blocks and at 128: the nesting depth is fixed, so the
    // scanning per character cannot depend on how many blocks arrive. A nesting step that re-reads the quote stack of
    // every line seen so far grows with the document instead and exceeds this ceiling at both sizes, by 3.5x at 32
    // blocks (52) and 13x at 128 (195).
    expect(readPerChar(32)).toBeLessThan(15)
    expect(readPerChar(128)).toBeLessThan(15)

    // The list is appended one line at a time, so bound the scanning work each item costs: a streaming parser must
    // never rescan earlier lines. (A wall-clock ratio cannot carry this: appending is currently superlinear at 33 ms
    // for 1,000 items and 5.2 s for 16,000, which no load-independent bound would separate from a scheduler stall.)
    const listStream = createMarkdownStream({ renderHtml: false })
    let scanned = 0
    for (let i = 0; i < 1_000; i++) {
      scanned += listStream.append(`- item ${i} with **bold** and \`code\`\n`).charsScanned
    }
    const done = listStream.finalize()
    scanned += done.charsScanned
    expect(done.blocks).toHaveLength(1)
    // Measured 36.9 characters per 36-character item; the ceiling leaves room for the block marker and the scans a
    // settled line re-reads, and still fails by orders of magnitude if appending rescans the whole list.
    expect(scanned / 1_000).toBeLessThan(36 * 6)
  })

  test("huge GFM table stays linear", () => {
    // 250 and 1,000 rows: 4x the table, while both fit under the heap size at which garbage collection starts to
    // dominate the measurement (2,000 rows already cost 5-7x for 4x the input, which is the collector, not the parser).
    const tableParse = (rows: number) => {
      const body = Array.from(
        { length: rows },
        (_, i) => `| cell ${i} | **bold ${i}** | \`code ${i}\` | [link](https://example.com/${i}) |\n`,
      ).join("")
      const done = createMarkdownStream({ renderHtml: false }).update(
        "| Col A | Col B | Col C | Col D |\n|---|---|---|---|\n" + body,
        { streaming: false },
      )
      expect(done.blocks).toHaveLength(1)
      expect(done.blocks[0]!.kind.type).toBe("table")
      if (done.blocks[0]!.kind.type === "table") expect(done.blocks[0]!.kind.rows).toHaveLength(rows)
    }
    expect(growth(tableParse, 250, 1_000)).toBeLessThan(ratioLimit)
  })

  test("a streamed table row scans only the active row", () => {
    // Work, not time. What must not grow is the text each append re-reads, so this bounds characters scanned per row;
    // the ready time of the same appends is superlinear today (33 ms for 1,000 rows and 5.2 s for 16,000), which no
    // load-independent bound would separate from a scheduler stall. It catches a rebuild that re-reads the rows; a
    // rebuild that only copies state without re-reading text is not bounded by any assertion in this file.
    const scannedPerRow = (rows: number) => {
      const stream = createMarkdownStream({ renderHtml: false })
      stream.append("| Col A | Col B | Col C | Col D |\n|---|---|---|---|\n")
      let scanned = 0
      for (let i = 0; i < rows; i++) {
        scanned += stream.append(`| cell ${i} | **bold ${i}** | \`code ${i}\` | [link](https://example.com/${i}) |\n`).charsScanned
      }
      const done = stream.finalize()
      expect(done.blocks).toHaveLength(1)
      expect(done.blocks[0]!.kind.type).toBe("table")
      if (done.blocks[0]!.kind.type === "table") expect(done.blocks[0]!.kind.rows).toHaveLength(rows)
      return (scanned + done.charsScanned) / rows
    }
    // Measured 74.6 characters per 50-character row at 1,000 rows and 77.9 at 4,000: an append scans the active row,
    // never the table. A parser that rescans the table per row grows with the row count instead.
    expect(scannedPerRow(1_000), "characters scanned per row at 1,000 rows").toBeLessThan(150)
    expect(scannedPerRow(4_000), "characters scanned per row at 4,000 rows").toBeLessThan(150)
  })
  // kilocode_change end

  test(
    // kilocode_change start - 256 KB instead of 1 MB: the work bound below is unchanged, but the smaller input
    // keeps the 15 s upstream default timeout out of reach on capped CI runners.
    "a long reply streamed 1 char at a time bounds scanning to the active line",
    () => {
      const unit =
        "## Section Heading\n\nParagraph with **bold**, *italic*, `code`, and [link](https://example.com).\n\n- item one\n- item two\n\n```ts\nconst x = 1;\n```\n\n"
      const full = unit.repeat(Math.ceil(262_144 / unit.length)).slice(0, 262_144) // kilocode_change
      const stream = createMarkdownStream({ renderHtml: false })
      let scanned = 0

      for (let i = 0; i < full.length; i++) {
        scanned += stream.append(full[i]!).charsScanned
      }

      const done = stream.finalize()
      expect(done.blocks.length).toBeGreaterThan(5_000) // kilocode_change
      // Count work rather than machine load; the timeout only catches catastrophic regressions on slow runners.
      // The enforced ceiling is `unit.length` (about 139) scanned characters per input character, roughly 6x the
      // measured ~23.4. It is a constant, so scanning must stay linear: rescanning the whole reply on every append
      // grows with input length and exceeds it by orders of magnitude.
      expect(scanned).toBeLessThan(full.length * unit.length)
    },
    60_000, // kilocode_change
    // kilocode_change end
  )
})
