import { describe, expect, it } from "bun:test"
import fs from "node:fs"
import path from "node:path"

const root = path.resolve(import.meta.dir, "../..")
const file = path.join(root, "webview-ui/src/components/chat/PermissionDock.tsx")

describe("PermissionDock layout", () => {
  const source = fs.readFileSync(file, "utf-8")
  const footerStart = source.indexOf("footer={")
  const bodyStart = source.indexOf(">\n        <Show", footerStart)
  const footer = source.slice(footerStart, bodyStart)

  it("keeps approval actions in the dock footer", () => {
    expect(footer).toContain('data-slot="permission-actions"')
    expect(footer).toContain('language.t("ui.permission.run")')
    expect(footer).toContain('language.t("ui.permission.deny")')
  })

  it("keeps approval actions on the shared submit path", () => {
    expect(footer).toContain('onClick={() => submit("once")}')
    expect(footer).toContain('onClick={() => submit("reject")}')
  })
})
