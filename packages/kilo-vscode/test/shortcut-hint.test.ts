import { describe, expect, it } from "bun:test"
import { recommend, type Hint, type HintContext, type ManagerContext } from "../webview-ui/src/v2/shortcut-hint"

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
  quickWorktree: "⌘⇧N",
  jumpTo3: "⌘3",
}

const idle: HintContext = {
  bindings,
  queue: "⌥↵",
  focused: true,
  away: false,
  draft: false,
  busy: false,
  selection: false,
}
const manager: ManagerContext = { changes: false, pr: false, worktrees: 0 }
const am = (state: Partial<ManagerContext>, ctx: Partial<HintContext> = {}) =>
  recommend({ ...idle, ...ctx, manager: () => ({ ...manager, ...state }) })

describe("shortcut hint recommendation", () => {
  describe("sidebar chat", () => {
    it("user selected code in the editor: add it to the chat", () => {
      const hint: Hint = { binding: "⌘K ⌘A", label: "addSelection" }
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

    it("agent runs while the user waits in the prompt: queue the follow-up", () => {
      expect(recommend({ ...idle, busy: true })).toEqual({ binding: "⌥↵", label: "queue" })
    })

    it("another session tab is open: show how to switch session tabs", () => {
      const hint: Hint = { binding: "⌘⌥← ⌘⌥→", label: "sessions" }
      expect(recommend({ ...idle, tabs: true })).toEqual(hint)
      expect(recommend({ ...idle, tabs: true, busy: true })).toEqual({ binding: "⌥↵", label: "queue" })
      expect(recommend({ ...idle, tabs: true, draft: true })).toBeUndefined()
    })
  })

  describe("agent manager", () => {
    it("another session waits for an answer: jump to it, before anything in this session", () => {
      const hint: Hint = { binding: "⌘3", label: "waiting" }
      expect(am({ waiting: 3, changes: true, worktrees: 2 })).toEqual(hint)
      expect(am({ waiting: 3 }, { focused: false })).toEqual(hint)
      expect(am({ waiting: 3 }, { busy: true })).toEqual(hint)
      expect(am({ waiting: 3 }, { draft: true })).toBeUndefined()
    })

    it("a selection in the editor still wins, because the user just made it", () => {
      expect(am({ waiting: 3 }, { focused: false, away: true, selection: true })?.label).toBe("addSelection")
    })

    it("focus is in the sidebar, a panel, or a terminal: Cmd+Shift+M goes back to the prompt", () => {
      expect(am({ worktrees: 2 }, { focused: false })).toEqual({ binding: "⌘⇧M", label: "type" })
    })

    it("agent runs: queue the follow-up, as in the sidebar", () => {
      expect(am({ worktrees: 2, changes: true }, { busy: true })).toEqual({ binding: "⌥↵", label: "queue" })
    })

    it("agent finished with changes: review them, unless the diff is already open", () => {
      expect(am({ changes: true, pr: true, worktrees: 2 })).toEqual({ binding: "⌘D", label: "changes" })
      expect(am({ changes: true, pr: true, panel: "diff" })).toEqual({ binding: "⌘⇧R", label: "pr" })
    })

    it("pull request exists and its panel is closed: open it", () => {
      expect(am({ pr: true })).toEqual({ binding: "⌘⇧R", label: "pr" })
      expect(am({ pr: true, panel: "pr" })).toEqual({ binding: "⌘⇧N", label: "newWorktree" })
    })

    it("nothing to review: switch session when there is more than one", () => {
      expect(am({ worktrees: 1 })?.label).toBe("sessions")
    })

    it("nothing to review and no other worktree: starting a worktree is the next task", () => {
      expect(am({})).toEqual({ binding: "⌘⇧N", label: "newWorktree" })
    })

    it("a shortcut the user removed is never suggested", () => {
      const rest = { ...bindings, toggleDiff: "" }
      // The review hint is skipped, so the next one in rank order shows instead.
      expect(
        recommend({ ...idle, bindings: rest, manager: () => ({ ...manager, changes: true, worktrees: 2 }) })?.label,
      ).toBe("sessions")
      const none = { ...bindings, toggleDiff: "", previousSession: "", nextSession: "", quickWorktree: "" }
      expect(
        recommend({ ...idle, bindings: none, manager: () => ({ ...manager, changes: true, worktrees: 2 }) }),
      ).toBeUndefined()
    })

    it("a draft is dropped before the sidebar state is read", () => {
      const read = { called: false }
      expect(
        recommend({
          ...idle,
          draft: true,
          manager: () => {
            read.called = true
            return manager
          },
        }),
      ).toBeUndefined()
      expect(read.called).toBe(false)
    })
  })
})
