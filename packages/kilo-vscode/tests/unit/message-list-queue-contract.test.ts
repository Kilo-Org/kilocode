import { describe, expect, it } from "bun:test"
import fs from "node:fs"
import path from "node:path"

const file = path.resolve(import.meta.dir, "../../webview-ui/src/components/chat/MessageList.tsx")
const source = fs.readFileSync(file, "utf-8")

function virtualizer() {
  const start = source.indexOf("<Virtualizer")
  const end = source.indexOf("</Virtualizer>", start)
  return source.slice(start, end)
}

describe("MessageList queued rendering", () => {
  it("marks only partitioned queued turns as queued", () => {
    expect(virtualizer()).not.toContain("queued=")
    expect(source).toMatch(/<For each=\{partition\(\)\.queued\}>[\s\S]*?<VscodeSessionTurn turn=\{turn\} queued \/>/)
  })
})
