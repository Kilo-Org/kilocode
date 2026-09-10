import { describe, expect, it } from "bun:test"
import fs from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dir, "../..")
const CSS = fs
  .readFileSync(path.join(ROOT, "webview-ui/agent-manager/pr/pr-panel.css"), "utf-8")
  .replace(/\/\*[\s\S]*?\*\//g, "")

function blocks(source: string) {
  return source
    .split("}")
    .map((chunk) => {
      const open = chunk.lastIndexOf("{")
      if (open === -1) return undefined
      return {
        selectors: chunk
          .slice(0, open)
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
        body: chunk.slice(open + 1),
      }
    })
    .filter((value): value is { selectors: string[]; body: string } => value !== undefined)
}

describe("diff composer action ordering", () => {
  it("orders the split-button wrapper, not the inner primary button", () => {
    const rules = blocks(CSS)
    const ordered = rules.filter(
      (rule) =>
        rule.selectors.some((selector) => selector.startsWith('.am-pr-comment-composer[data-action="diff"]')) &&
        /(^|[;\s])order\s*:/.test(rule.body),
    )
    const targets = ordered.flatMap((rule) => rule.selectors.map((selector) => selector))
    const inner = targets.filter((selector) => selector.includes('[data-action="send-primary"]'))
    expect(inner, "the inner send-primary keeps DOM order; the wrapper carries flex order").toEqual([])
    expect(
      targets.some((selector) => selector.includes(".am-split-button")),
      "the split-button wrapper must carry the flex order",
    ).toBe(true)
  })

  it("keeps preview before the send group and save/cancel on the left", () => {
    const rules = blocks(CSS)
    const order = (needle: string) => {
      const rule = rules.find((item) =>
        item.selectors.some(
          (selector) => selector.startsWith('.am-pr-comment-composer[data-action="diff"]') && selector.includes(needle),
        ),
      )
      const match = rule?.body.match(/(?:^|[;\s])order\s*:\s*(\d+)/)
      return match ? Number(match[1]) : 0
    }
    expect(order('[data-action="save"]')).toBeLessThan(order(".am-split-button"))
    expect(order('[data-action="preview"]')).toBeLessThan(order(".am-split-button"))
    expect(order('[data-action="cancel"]')).toBeLessThan(order('[data-slot="comment-actions-gap"]'))
  })
})
