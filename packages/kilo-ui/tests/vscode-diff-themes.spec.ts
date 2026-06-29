import { expect, test } from "@playwright/test"
import { VSCODE_THEMES } from "../src/stories/vscode-themes"

const STORY = "components-diff--default"
// Hue-bearing roles that must stay visually distinct. The earlier regression
// washed them all toward one near-neutral color; raw theme tokens keep them
// separate, which is what this guards.
const distinct = [
  "--syntax-comment",
  "--syntax-string",
  "--syntax-keyword",
  "--syntax-primitive",
  "--syntax-property",
  "--syntax-type",
  "--syntax-constant",
]
const surfaces = [
  "--surface-diff-add-base",
  "--surface-diff-add-weaker",
  "--surface-diff-add-weak",
  "--surface-diff-delete-base",
  "--surface-diff-delete-weaker",
  "--surface-diff-delete-weak",
]

test.describe.parallel("VS Code diff themes", () => {
  for (const [id, theme] of Object.entries(VSCODE_THEMES)) {
    test(`${id} keeps diff text and hierarchy readable`, async ({ page }) => {
      const globals = `colorScheme:${theme.colorScheme};theme:kilo-vscode;vscodeTheme:${id}`
      await page.goto(`/iframe.html?id=${STORY}&viewMode=story&globals=${globals}`, { waitUntil: "load" })

      const host = page.locator("diffs-container")
      await expect(host).toHaveAttribute("data-color-scheme", theme.colorScheme)
      await expect
        .poll(() =>
          host.evaluate((node) => Boolean(node.shadowRoot?.querySelector("[data-line-type='change-addition']"))),
        )
        .toBe(true)

      const result = await host.evaluate(
        (node, args) => {
          const parse = (value: string) => {
            const nums = value.match(/[\d.]+/g)?.map(Number) ?? []
            if (value.startsWith("color(srgb")) return nums.slice(0, 3).map((part) => part * 255)
            return nums.slice(0, 3)
          }
          const distance = (a: string, b: string) => {
            const first = parse(a)
            const second = parse(b)
            return Math.sqrt(first.reduce((sum, part, index) => sum + (part - second[index]) ** 2, 0))
          }
          const sample = (property: string, type: "color" | "background") => {
            const probe = document.createElement("span")
            const value = `color-mix(in srgb, var(${property}) 100%, transparent)`
            probe.style[type === "color" ? "color" : "backgroundColor"] = value
            document.body.appendChild(probe)
            const computed = getComputedStyle(probe)[type === "color" ? "color" : "backgroundColor"]
            probe.remove()
            return computed
          }

          const palette = args.distinct.map((property) => sample(property, "color"))
          const backgrounds = Object.fromEntries(
            args.surfaces.map((property) => [property, sample(property, "background")]),
          )
          const editor = sample("--vscode-editor-background", "background")
          const root = node.shadowRoot!
          const line = root.querySelector<HTMLElement>("[data-line-type='change-addition']")!

          return {
            distinctColors: new Set(palette).size,
            addition: [
              distance(editor, backgrounds["--surface-diff-add-base"]),
              distance(editor, backgrounds["--surface-diff-add-weaker"]),
              distance(editor, backgrounds["--surface-diff-add-weak"]),
            ],
            deletion: [
              distance(editor, backgrounds["--surface-diff-delete-base"]),
              distance(editor, backgrounds["--surface-diff-delete-weaker"]),
              distance(editor, backgrounds["--surface-diff-delete-weak"]),
            ],
            fontSize: Number.parseFloat(getComputedStyle(line).fontSize),
            outline: getComputedStyle(line).outlineStyle,
            outlineColor: getComputedStyle(line).outlineColor,
          }
        },
        { distinct, surfaces },
      )

      // Syntax keeps the theme's own distinct hues rather than collapsing to gray.
      expect(result.distinctColors).toBeGreaterThanOrEqual(5)
      // Row tint < gutter tint < changed-word tint, on both sides.
      expect(result.addition[0]).toBeLessThan(result.addition[1])
      expect(result.addition[1]).toBeLessThan(result.addition[2])
      expect(result.deletion[0]).toBeLessThan(result.deletion[1])
      expect(result.deletion[1]).toBeLessThan(result.deletion[2])
      expect(result.fontSize).toBeGreaterThanOrEqual(12)
      if (id === "hc-black" || id === "hc-light") {
        expect(result.outline).toBe("solid")
        expect(result.outlineColor).not.toBe("rgba(0, 0, 0, 0)")
      }
    })
  }
})
