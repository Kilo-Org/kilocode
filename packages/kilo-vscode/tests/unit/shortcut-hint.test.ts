import { describe, expect, it } from "bun:test"
import { recommend, type HintContext, type ManagerContext } from "../../webview-ui/src/utils/shortcut-hint"

const bindings = {
  addToContext: "⌘K ⌘A",
  focusChatInput: "⌘⇧A",
  agentManagerOpen: "⌘⇧M",
  previousSession: "⌘⌥↑",
  nextSession: "⌘⌥↓",
  previousTab: "⌘⌥←",
  nextTab: "⌘⌥→",
  toggleDiff: "⌘D",
  openPR: "⌘⇧R",
  jumpTo3: "⌘3",
}

const idle: HintContext = { bindings, focused: true, away: false, draft: false, busy: false, selection: false }
const manager: ManagerContext = { changes: false, pr: false, worktrees: 0 }
const am = (state: Partial<ManagerContext>, ctx: Partial<HintContext> = {}) =>
  recommend({ ...idle, ...ctx, manager: { ...manager, ...state } })

describe("shortcut hint recommendation", () => {
  describe("sidebar chat", () => {
    it("user selected code in the editor: add it to the chat", () => {
      const hint = { binding: "⌘K ⌘A", label: "addSelection" }
      expect(recommend({ ...idle, focused: false, away: true, selection: true })).toEqual(hint)
    })

    it("the hint lives in the placeholder, so a draft always hides it", () => {
      expect(recommend({ ...idle, focused: false, away: true, selection: true, draft: true })).toBeUndefined()
    })

    it("user clicked back into the prompt after selecting: the editor shortcut no longer works", () => {
      expect(recommend({ ...idle, selection: true })).toBeUndefined()
    })

    it("user works in the editor: show how to get back to the prompt", () => {
      expect(recommend({ ...idle, focused: false, away: true })).toEqual({ binding: "⌘⇧A", label: "type" })
    })

    it("user types or the prompt is idle: show nothing", () => {
      expect(recommend({ ...idle, focused: false, draft: true })).toBeUndefined()
      expect(recommend(idle)).toBeUndefined()
    })

    it("agent runs while the user waits in the prompt: Esc stops it", () => {
      expect(recommend({ ...idle, busy: true })).toEqual({ binding: "Esc", label: "stop" })
    })

    it("another session tab is open: show how to switch session tabs", () => {
      const hint = { binding: "⌘⌥← ⌘⌥→", label: "sessions" }
      expect(recommend({ ...idle, tabs: true })).toEqual(hint)
      expect(recommend({ ...idle, tabs: true, busy: true })).toEqual(hint)
      expect(recommend({ ...idle, tabs: true, draft: true })).toBeUndefined()
    })
  })

})
