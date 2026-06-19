import { describe, expect, it } from "bun:test"
import fs from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dir, "../..")

function read(file: string) {
  return fs.readFileSync(path.join(ROOT, file), "utf-8")
}

describe("chat content width setting", () => {
  it("keeps the readable width limit enabled by default", async () => {
    const manifest = (await Bun.file(path.join(ROOT, "package.json")).json()) as {
      contributes: { configuration: { properties: Record<string, { default?: unknown }> } }
    }

    expect(manifest.contributes.configuration.properties["kilo-code.new.limitChatContentWidth"]?.default).toBe(true)
  })

  it("seeds and applies the width preference before the webview renders", () => {
    const utils = read("src/utils.ts")
    const layout = read("webview-ui/src/styles/chat-layout.css")
    const display = read("webview-ui/src/context/display.tsx")

    expect(utils).toContain("--kilo-chat-content-width")
    expect(layout).toContain("var(--kilo-chat-content-width, 98ch)")
    expect(display).toContain('limitChatContentWidth() ? "initial" : "100%"')
  })

  it("synchronizes changes across open chat webviews", () => {
    const provider = read("src/KiloProvider.ts")
    const watcher = read("src/kilo-provider/chat-width.ts")
    const display = read("webview-ui/src/context/display.tsx")

    expect(provider).toContain("watchChatContentWidthConfig")
    expect(provider).toContain('type: "chatContentWidthLimitChanged"')
    expect(watcher).toContain('affectsConfiguration("kilo-code.new.limitChatContentWidth")')
    expect(display).toContain('key: "limitChatContentWidth"')
  })
})
