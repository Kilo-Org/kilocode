import { describe, expect, it } from "bun:test"
import fs from "node:fs"
import path from "node:path"

const root = path.resolve(import.meta.dir, "../..")
const preview = fs.readFileSync(path.join(root, "webview-ui/src/components/shared/ModelPreview.tsx"), "utf8")
const selector = fs.readFileSync(path.join(root, "webview-ui/src/components/shared/ModelSelector.tsx"), "utf8")
const agent = fs.readFileSync(path.join(root, "webview-ui/agent-manager/MultiModelSelector.tsx"), "utf8")
const icons = fs.readFileSync(path.join(root, "../kilo-ui/src/components/icon.tsx"), "utf8")
const styles = fs.readFileSync(path.join(root, "webview-ui/src/styles/model-selector.css"), "utf8")

describe("model preview data collection line", () => {
  it("shows a visible data collection row above context details", () => {
    const data = preview.indexOf('class="model-preview-data-line"')
    const context = preview.indexOf("model.preview.label.context")

    expect(data).toBeGreaterThanOrEqual(0)
    expect(context).toBeGreaterThan(data)
    expect(preview).toContain('Icon name="book-open-check"')
    expect(preview).toContain("isDataCollectedModel(model())")
    expect(preview).toContain('language.t("model.tag.dataCollected")')
    expect(styles).toContain(".model-preview-data-line")
  })

  it("renders prompt training independently from the free badge", () => {
    expect(selector).toMatch(
      /<Show when=\{isFree\(model\)\}>[\s\S]*?<\/Show>\s*<Show when=\{isDataCollectedModel\(model\)\}>/,
    )
    expect(preview).toMatch(
      /<Show when=\{model\(\)\.isFree\}>[\s\S]*?<\/Show>\s*<Show when=\{isDataCollectedModel\(model\(\)\)\}>/,
    )
  })

  it("uses the book open check icon for all webview model data disclosures", () => {
    expect(selector).toContain('Icon name="book-open-check"')
    expect(selector).not.toContain('Icon name="warning"')
    expect(agent).toContain('Icon name="book-open-check"')
    expect(agent).not.toContain('Icon name="warning"')
    expect(icons).toContain('"book-open-check"')
  })
})
