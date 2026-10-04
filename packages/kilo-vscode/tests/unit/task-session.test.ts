import { describe, expect, it } from "bun:test"
import { VisibleTaskStreams } from "../../src/kilo-provider/visible-task-streams"

describe("VisibleTaskStreams", () => {
  it("suspends and restores visible child sessions with provider activity", () => {
    const sent: Array<[string, boolean]> = []
    const streams = new VisibleTaskStreams((id, visible) => sent.push([id, visible]))
    streams.handle({ type: "streamSessionVisible", sessionID: "child", visible: true })
    streams.setActive(false)
    streams.setActive(true)
    streams.handle({ type: "streamSessionVisible", sessionID: "child", visible: false })
    expect(sent).toEqual([
      ["child", true],
      ["child", false],
      ["child", true],
      ["child", false],
    ])
  })

  it("clears visible refs after a webview reload", () => {
    const sent: Array<[string, boolean]> = []
    const streams = new VisibleTaskStreams((id, visible) => sent.push([id, visible]))
    streams.handle({ type: "streamSessionVisible", sessionID: "child", visible: true })
    streams.clear()
    streams.handle({ type: "streamSessionVisible", sessionID: "child", visible: false })
    expect(sent).toEqual([
      ["child", true],
      ["child", false],
      ["child", false],
    ])
  })
})
