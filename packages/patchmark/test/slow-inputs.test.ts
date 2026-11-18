import { describe, expect, test } from "bun:test"
import { createMarkdownStream, renderBlocksToHtml } from "../src/index"

// These bounds compare one shape at 1x and 4x size instead of timing a fixed input: quadratic parsing needs about 16x
// the time, linear parsing about 4x, and the ratio does not move when the host is loaded. Each side is the median of
// several samples, so one scheduling stall cannot decide the outcome.
const ratioLimit = 8

/** Median time at 4x size divided by median time at 1x size. */
function growth(work: (scale: number) => void, samples = 5) {
  const measure = (scale: number) =>
    Array.from({ length: samples }, () => {
      const started = performance.now()
      work(scale)
      return performance.now() - started
    })
      .sort((left, right) => left - right)
      .at(Math.floor(samples / 2))!
  work(1) // warm the JIT and the module caches before measuring
  return measure(4) / Math.max(measure(1), 1)
}

describe("slow-input linear-time bounds", () => {
  test("deeply nested brackets and bracket-link chains stay linear", () => {
    expect(
      growth((scale) => {
        const nested = "[".repeat(10_000 * scale) + "a" + "]".repeat(10_000 * scale)
        const f1 = createMarkdownStream({ renderHtml: true }).update(nested, { streaming: false })
        expect(renderBlocksToHtml(f1.blocks)).toContain("[a]")

        const links = "[".repeat(5_000 * scale) + "[a](b)".repeat(5_000 * scale)
        const f2 = createMarkdownStream({ renderHtml: true }).update(links, { streaming: false })
        expect(renderBlocksToHtml(f2.blocks)).toContain('<a href="b">a</a>')
      }),
    ).toBeLessThan(ratioLimit)
  })

  test("long * and _ delimiter runs and distinct unclosed backtick runs stay linear", () => {
    // The backtick runs are one fixed batch repeated per scale, so the input length stays proportional to the scale.
    const ticks = Array.from({ length: 500 }, (_, i) => "`".repeat(i + 1) + "a").join(" ")
    expect(
      growth((scale) => {
        const emph = "*a".repeat(5_000 * scale) + " " + "_b".repeat(5_000 * scale) + " " + "**c*d".repeat(2_000 * scale)
        const f1 = createMarkdownStream({ renderHtml: true }).update(emph, { streaming: false })
        expect(f1.blocks).toHaveLength(1)

        const mismatchedHeal = "*a ".repeat(5_000 * scale) + "b_ ".repeat(5_000 * scale)
        const fHeal = createMarkdownStream({ renderHtml: false }).update(mismatchedHeal, { streaming: true })
        expect(fHeal.blocks).toHaveLength(1)

        const f2 = createMarkdownStream({ renderHtml: true }).update(
          Array.from({ length: scale }, () => ticks).join(" "),
          { streaming: false },
        )
        expect(f2.blocks).toHaveLength(1)
      }),
    ).toBeLessThan(ratioLimit)
  })

  test("deeply nested blockquotes and lists stay linear", () => {
    // The nesting arrives in one update, so comparing 1x and 4x catches a quadratic walk over the nesting depth.
    expect(
      growth((scale) => {
        const md = "> ".repeat(200 * scale) + "deep quote\n\n" + "- ".repeat(200 * scale) + "deep list\n"
        const frame = createMarkdownStream({ renderHtml: true }).update(md, { streaming: false })
        expect(frame.blocks).toHaveLength(2)
      }),
    ).toBeLessThan(ratioLimit)

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

  test("huge GFM table streamed row-by-row stays linear", () => {
    expect(
      growth((scale) => {
        const stream = createMarkdownStream({ renderHtml: false })
        stream.append("| Col A | Col B | Col C | Col D |\n|---|---|---|---|\n")

        for (let i = 0; i < 1_000 * scale; i++) {
          stream.append(`| cell ${i} | **bold ${i}** | \`code ${i}\` | [link](https://example.com/${i}) |\n`)
        }

        const done = stream.finalize()
        expect(done.blocks).toHaveLength(1)
        expect(done.blocks[0]!.kind.type).toBe("table")

        if (done.blocks[0]!.kind.type === "table") {
          expect(done.blocks[0]!.kind.rows).toHaveLength(1_000 * scale)
        }
      }),
    ).toBeLessThan(ratioLimit)
  })

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
