import { describe, it, expect } from "bun:test"
import { FamilyStreamLanes } from "../../src/kilo-provider/family-stream-lanes"

function make() {
  const sent: { id: string; visible: boolean }[] = []
  const lanes = new FamilyStreamLanes((id, visible) => sent.push({ id, visible }))
  return { lanes, sent }
}

describe("FamilyStreamLanes", () => {
  it("grants the lane when a linked child's parent is focused", () => {
    const { lanes, sent } = make()
    lanes.focus("root")
    lanes.link("child", "root")
    expect(sent).toEqual([{ id: "child", visible: true }])
  })

  it("grants immediately when focus arrives after the link", () => {
    const { lanes, sent } = make()
    lanes.link("child", "root")
    expect(sent).toEqual([])
    lanes.focus("root")
    expect(sent).toEqual([{ id: "child", visible: true }])
  })

  it("grants nested grandchildren through the link chain", () => {
    const { lanes, sent } = make()
    lanes.link("child", "root")
    lanes.link("grand", "child")
    lanes.focus("root")
    expect(sent).toEqual([
      { id: "child", visible: true },
      { id: "grand", visible: true },
    ])
  })

  it("resolves chains that arrive out of order", () => {
    const { lanes, sent } = make()
    lanes.focus("root")
    lanes.link("grand", "child")
    expect(sent).toEqual([])
    lanes.link("child", "root")
    expect(sent).toEqual([
      { id: "grand", visible: true },
      { id: "child", visible: true },
    ])
  })

  it("ignores sessions outside the focused family", () => {
    const { lanes, sent } = make()
    lanes.focus("root")
    lanes.link("other", "elsewhere")
    expect(sent).toEqual([])
  })

  it("revokes grants for the old family when focus changes", () => {
    const { lanes, sent } = make()
    lanes.link("child", "root")
    lanes.link("next", "second")
    lanes.focus("root")
    lanes.focus("second")
    expect(sent).toEqual([
      { id: "child", visible: true },
      { id: "child", visible: false },
      { id: "next", visible: true },
    ])
  })

  it("revokes everything when focus is cleared", () => {
    const { lanes, sent } = make()
    lanes.focus("root")
    lanes.link("child", "root")
    lanes.focus(undefined)
    expect(sent).toEqual([
      { id: "child", visible: true },
      { id: "child", visible: false },
    ])
  })

  it("delete stops tracking and revokes an active grant", () => {
    const { lanes, sent } = make()
    lanes.focus("root")
    lanes.link("child", "root")
    lanes.delete("child")
    expect(sent).toEqual([
      { id: "child", visible: true },
      { id: "child", visible: false },
    ])
    // Link again: without a recorded parent there is no chain to the focus.
    lanes.link("child", "root")
    expect(sent).toHaveLength(3)
    expect(sent[2]).toEqual({ id: "child", visible: true })
  })

  it("reassert re-emits active grants after a downstream reset", () => {
    const { lanes, sent } = make()
    lanes.focus("root")
    lanes.link("child", "root")
    sent.length = 0
    lanes.reassert()
    expect(sent).toEqual([{ id: "child", visible: true }])
  })

  it("clear revokes all grants and forgets links", () => {
    const { lanes, sent } = make()
    lanes.focus("root")
    lanes.link("child", "root")
    lanes.clear()
    expect(sent).toEqual([
      { id: "child", visible: true },
      { id: "child", visible: false },
    ])
    lanes.focus("root")
    expect(sent).toHaveLength(2)
  })

  it("handles link cycles without looping", () => {
    const { lanes, sent } = make()
    lanes.link("a", "b")
    lanes.link("b", "a")
    lanes.focus("a")
    // b reaches a through the cycle, a itself is never a "child" to grant.
    expect(sent).toEqual([{ id: "b", visible: true }])
  })
})
