import { describe, expect, test } from "bun:test"
import { createMarkedParser } from "../context/marked"

const parse = async (text: string) => String(await createMarkedParser({}).parse(text))
const spans = (html: string) => (html.match(/class="katex"/g) ?? []).length

describe("Inline dollar math ($...$)", () => {
  test("renders guarded single-dollar math inline", async () => {
    const html = await parse("where $\\phi$ is golden and $x^2$ grows")
    expect(spans(html)).toBe(2)
    expect(html).not.toContain("$\\phi$")
  })

  test("renders math that starts with a digit", async () => {
    expect(spans(await parse("$2x$ and $3y$ are roots"))).toBe(2)
  })

  test("keeps \\(...\\) working", async () => {
    expect(spans(await parse("inline \\(\\phi\\) still works"))).toBe(1)
  })

  test.each([
    "costs $93K to $307K per run",
    "fee $5 and tax $8",
    "from $1.50 to $2.25 today",
    "the $5-$8 range",
    "$5K-$10K plans",
    "Send $50 please and $60 thanks",
    "echo $HOME and $PATH in shell",
    "total 5$ and 6$",
    "lone $ sign here",
    "the \\$\\phi\\$ symbol stays literal",
    "a $10$-off coupon for $20$ items",
    "paid $5$ in cash and $8$ tax",
    "cost split: $HOME/$PATH var",
    "$PATH and `$HOME` here",
    "the `echo $HOME` and $HOME/.cache file",
    "price is$5 or 10$ fixed",
  ])("leaves money and shell text untouched: %s", async (text) => {
    expect(spans(await parse(text))).toBe(0)
  })

  // $...$ pairs must never straddle an inline code span. Delimiters flush
  // against a span are caught by the boundary rules; when a code span sits
  // between two well-formed delimiters, only the backtick exclusion in the
  // content class blocks the pair (extension tokenizers run before marked's
  // codespan tokenizer, so the span is still raw text at that point).
  test.each([
    "set $PATH to `x$` later",
    "use $vars like `a$` in code",
    "render `$a$` literally",
    "wrap `$phi$` as code",
    "price $5 for `x` and 6$ done",
  ])("does not pair math across code spans: %s", async (text) => {
    expect(spans(await parse(text))).toBe(0)
  })

  test("code span before real math renders only the math", async () => {
    const html = await parse("run `ls $HOME` then $a+b$ grows")
    expect(spans(html)).toBe(1)
    expect(html).toContain("a+b")
  })

  test("renders math adjacent to punctuation and hyphens", async () => {
    const html = await parse("value ($y$) and the $x$-axis, then $\\phi$.")
    expect(spans(html)).toBe(3)
  })

  test("mixes currency and math in one line", async () => {
    const html = await parse("cost $10M for $\\sigma$ only")
    expect(spans(html)).toBe(1)
    expect(html).toContain("$10M")
  })

  test("currency opener does not swallow later math on the line", async () => {
    const html = await parse("I paid $5 and want $x^2$ growth")
    expect(spans(html)).toBe(1)
    expect(html).toContain("$5")
  })

  test("keeps $$ block math as display mode", async () => {
    const html = await parse("text\n\n$$\n\\phi = 1\n$$\n\nmore")
    expect(spans(html)).toBe(1)
    expect(html).toContain("katex-display")
  })

  test("keeps mid-line $$...$$ rendering", async () => {
    expect(spans(await parse("mid-line $$\\phi$$ double"))).toBe(1)
  })

  // The native-parser path post-processes serialized HTML, where a $...$ regex
  // can hit attribute values, span rendered markup, and re-scan generated
  // KaTeX, and \$ escapes are already resolved to literal $. Single-dollar
  // math is therefore intentionally absent there; only $$ and \(..\) pass
  // through, matching the pre-feature behavior.
  test("native-parser path leaves $...$ as text but keeps $$..$$ and \\(..\\)", async () => {
    const native = async (md: string) => `<p>${md.replace(/</g, "&lt;")}</p>`
    const parser = createMarkedParser({ nativeParser: native })
    const single = String(await parser.parse("where $\\phi$ is golden"))
    expect(spans(single)).toBe(0)
    expect(single).toContain("$\\phi$")
    const escaped = String(await parser.parse(String.raw`\$x^2$`))
    expect(spans(escaped)).toBe(0)
    const display = String(await parser.parse("block $$\\phi$$ here"))
    expect(spans(display)).toBe(1)
    const paren = String(await parser.parse("inline \\(\\phi\\) here"))
    expect(spans(paren)).toBe(1)
  })

  test("escaped opening dollar stays literal on the marked path", async () => {
    for (const text of [String.raw`\$x$`, String.raw`\$x^2$`, String.raw`before \$\phi$ after`]) {
      const html = await parse(text)
      expect(spans(html)).toBe(0)
    }
  })

  test("untouched currency and shell text is preserved verbatim", async () => {
    const html = await parse("costs $93K to $307K, split $HOME/$PATH, a $10$-off coupon")
    expect(spans(html)).toBe(0)
    expect(html).toContain("$93K")
    expect(html).toContain("$307K")
    expect(html).toContain("$HOME/$PATH")
    expect(html).toContain("$10$")
  })
})
