import { describe, expect, it } from "bun:test"
import { recommend, type HintContext, type ManagerContext } from "../../webview-ui/src/utils/shortcut-hint"

const bindings = {
  addToContext: "⌘K ⌘A",
  focusChatInput: "⌘⇧A",
  agentManagerOpen: "⌘⇧M",
  previousSession: "⌘⌥↑",
  nextSession: "⌘⌥↓",
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
  })

  describe("agent manager", () => {
    it("another session waits for an answer: jump to it, before anything in this session", () => {
      const hint = { binding: "⌘3", label: "waiting" }
      expect(am({ waiting: 3, changes: true, worktrees: 2 })).toEqual(hint)
      expect(am({ waiting: 3 }, { focused: false })).toEqual(hint)
      expect(am({ waiting: 3 }, { draft: true })).toBeUndefined()
    })

    it("a selection in the editor still wins, because the user just made it", () => {
      expect(am({ waiting: 3 }, { focused: false, away: true, selection: true })?.label).toBe("addSelection")
    })

    it("focus is in the sidebar, a panel, or a terminal: Cmd+Shift+M goes back to the prompt", () => {
      expect(am({ worktrees: 2 }, { focused: false })).toEqual({ binding: "⌘⇧M", label: "type" })
    })

    it("agent runs: suggest working on another session, or stop with one session", () => {
      expect(am({ worktrees: 2, changes: true }, { busy: true })).toEqual({ binding: "⌘⌥↑ ⌘⌥↓", label: "sessions" })
      expect(am({}, { busy: true })).toEqual({ binding: "Esc", label: "stop" })
    })

    it("agent finished with changes: review them, unless the diff is already open", () => {
      expect(am({ changes: true, pr: true, worktrees: 2 })).toEqual({ binding: "⌘D", label: "changes" })
      expect(am({ changes: true, pr: true, panel: "diff" })).toEqual({ binding: "⌘⇧R", label: "pr" })
    })

    it("pull request exists and its panel is closed: open it", () => {
      expect(am({ pr: true })).toEqual({ binding: "⌘⇧R", label: "pr" })
      expect(am({ pr: true, panel: "pr" })).toBeUndefined()
    })

    it("nothing to review: switch session when there is more than one", () => {
      expect(am({ worktrees: 1 })?.label).toBe("sessions")
      expect(am({})).toBeUndefined()
    })

    it("a shortcut the user removed is never suggested", () => {
      const rest = { ...bindings, toggleDiff: "" }
      expect(recommend({ ...idle, bindings: rest, manager: { ...manager, changes: true } })).toBeUndefined()
    })
  })
})
