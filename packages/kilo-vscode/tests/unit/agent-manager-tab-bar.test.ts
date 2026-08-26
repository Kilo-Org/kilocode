import { describe, expect, it } from "bun:test"
import fs from "node:fs"
import path from "node:path"

const TAB_BAR = path.resolve(import.meta.dir, "../../webview-ui/agent-manager/TabBar.tsx")

describe("Agent Manager diff toggle", () => {
  it("renders live Git stats rather than pull-request stats", () => {
    const source = fs.readFileSync(TAB_BAR, "utf-8")
    const start = source.indexOf('title={props.t("agentManager.diff.toggle")}')
    const end = source.indexOf("</TooltipKeybind>", start)
    const button = source.slice(start, end)

    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)
    expect(button).toContain("<Show when={hasChanges()}>")
    expect(button).toContain("stats()!.files")
    expect(button).toContain("stats()!.additions")
    expect(button).toContain("stats()!.deletions")
    expect(button).not.toContain("props.prStatus()")
    expect(button).not.toContain("pr().additions")
    expect(button).not.toContain("pr().deletions")
  })
})
