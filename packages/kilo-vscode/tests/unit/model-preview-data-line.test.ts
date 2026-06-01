import { describe, expect, it } from "bun:test"
import fs from "node:fs"
import path from "node:path"

const root = path.resolve(import.meta.dir, "../..")
const preview = fs.readFileSync(path.join(root, "webview-ui/src/components/shared/ModelPreview.tsx"), "utf8")
const styles = fs.readFileSync(path.join(root, "webview-ui/src/styles/model-selector.css"), "utf8")

describe("model preview data collection line", () => {
  it("shows a visible data collection row above context details", () => {
    const data = preview.indexOf('class="model-preview-data-line"')
    const context = preview.indexOf("model.preview.label.context")

    expect(data).toBeGreaterThanOrEqual(0)
    expect(context).toBeGreaterThan(data)
    expect(preview).toContain('Icon name="warning"')
    expect(preview).toContain("isDataCollectedModel(model())")
    expect(preview).toContain('language.t("model.tag.dataCollected")')
    expect(styles).toContain(".model-preview-data-line")
  })
})
