import { describe, expect, test } from "bun:test"
import { marked } from "marked"
import remend from "remend"
import { stream } from "../components/markdown-stream"
import { stableBlocks } from "./markdown-stable-blocks"

async function render(text: string) {
  const html = await Promise.all(stream(text, true).map((block) => Promise.resolve(marked.parse(block.src))))
  return html.join("")
}

describe("stable markdown blocks", () => {
  test("keeps completed top-level tokens stable and only heals the tail", () => {
    expect(
      stableBlocks(
        [
          { type: "heading", raw: "# Title\n\n" },
          { type: "paragraph", raw: "First" },
          { type: "space", raw: "\n\n" },
          { type: "paragraph", raw: "Second **open" },
        ],
        (raw) => `${raw}**`,
      ),
    ).toEqual([
      { raw: "# Title\n\n", src: "# Title\n\n", mode: "full" },
      { raw: "First\n\n", src: "First\n\n", mode: "full" },
      { raw: "Second **open", src: "Second **open**", mode: "live" },
    ])
  })

  test("leaves a single mutable token on the existing streaming path", () => {
    expect(stableBlocks([{ type: "paragraph", raw: "Still streaming" }], (raw) => raw)).toBeUndefined()
  })

  test("matches canonical streaming HTML for mixed completed blocks", async () => {
    const text = [
      "# Report",
      "",
      "A completed paragraph with **emphasis**.",
      "",
      "- first item",
      "- second item",
      "",
      "```ts",
      "export const value = 1",
      "```",
      "",
      "The final paragraph is *still streaming",
    ].join("\n")

    expect(await render(text)).toBe(await marked.parse(remend(text, { linkMode: "text-only" })))
    expect(stream(text, true).map((block) => block.mode)).toEqual(["full", "full", "full", "full", "live"])
  })
})
