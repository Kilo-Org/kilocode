import { describe, expect, it } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { needsLocalDraft } from "../../webview-ui/agent-manager/project/local-tabs"
import { createTerminalState } from "../../webview-ui/agent-manager/terminal/state"
import { createSidePanel } from "../../webview-ui/agent-manager/side-panel-state"
import { SidePanel } from "../../webview-ui/agent-manager/side-panel-layout"
import {
  createTabMemory,
  rememberSelectionTab,
  selectLocalAction,
  selectWorktreeAction,
  type SelectionActionDeps,
} from "../../webview-ui/agent-manager/selection-actions"

function deps() {
  const calls: string[] = []
  const value: SelectionActionDeps<{ id: string }> = {
    saveTabMemory: () => {},
    setReviewActive: () => {},
    setSelection: () => {},
    post: () => {},
    tabMemory: () => ({}),
    terms: { forSelection: () => [], hasRemembered: () => false, setActiveId: () => {} },
    nsKey: (id) => id,
    activateTerminal: () => {},
    setActivePendingId: () => {},
    focusLocal: (id) => calls.push(`local:${id}`),
    selectSession: (id) => calls.push(`select:${id}`),
    clearSession: () => {},
    resetSession: () => calls.push("reset"),
    isPending: () => false,
    isReviewTab: () => false,
  }
  return { calls, value }
}

describe("selectWorktreeAction", () => {
  it("selects a managed session before its metadata reaches the live store", () => {
    const result = deps()

    selectWorktreeAction(result.value, "wt-b", [], ["ses-b"])

    expect(result.calls).toEqual(["select:ses-b"])
  })

  it("restores a remembered managed session before choosing the first session", () => {
    const result = deps()
    result.value.tabMemory = () => ({ "wt-b": "ses-b2" })

    selectWorktreeAction(result.value, "wt-b", [{ id: "ses-b1" }], ["ses-b1", "ses-b2"])

    expect(result.calls).toEqual(["select:ses-b2"])
  })

  it("resets only when the project has no known session", () => {
    const result = deps()

    selectWorktreeAction(result.value, "wt-b", [])

    expect(result.calls).toEqual(["reset"])
  })
})

describe("selectLocalAction", () => {
  it.each(["ses-a2", "pending:draft", "review", "terminal:1"])("remembers Local %s in multi-project mode", (tab) => {
    const memory: Record<string, string> = {}
    const save = createTabMemory({
      selection: () => "local",
      tab: () => tab,
      multi: () => true,
      applied: () => "project-a",
      active: () => "project-a",
      owns: () => false,
      locals: () => ["ses-a1", "ses-a2", "pending:draft"],
      localTab: (id) => id === "review" || id === "terminal:1",
      set: (key, id) => {
        memory[key] = id
      },
    })

    save()
    expect(memory.local).toBe(tab)
    if (tab !== "ses-a2") return
    const result = deps()
    result.value.tabMemory = () => memory
    selectLocalAction(result.value, [{ id: "ses-a1" }, { id: "ses-a2" }])
    expect(result.calls).toEqual(["local:ses-a2"])
  })

  it("restores the remembered second local tab", () => {
    const result = deps()
    result.value.tabMemory = () => ({ local: "ses-a2" })

    selectLocalAction(result.value, [{ id: "ses-a1" }, { id: "ses-a2" }])

    expect(result.calls).toContain("local:ses-a2")
  })

  it("saves the outgoing view before applying a host-driven project switch", () => {
    const memory: Record<string, string> = { local: "review" }
    const sessions: Record<string, string> = {}
    const save = createTabMemory({
      selection: () => "local",
      tab: () => "terminal:a",
      multi: () => true,
      applied: () => "a",
      active: () => "b",
      owns: () => false,
      locals: () => ["ses-a"],
      localTab: (id) => id === "terminal:a",
      session: () => "ses-a",
      rememberSession: (key, id) => {
        sessions[key] = id
      },
      set: (key, id) => {
        memory[key] = id
      },
    })

    save()
    expect(memory.local).toBe("review")
    save(true)
    expect(memory.local).toBe("terminal:a")
    expect(sessions.local).toBe("ses-a")
  })

  it("does not replace destination memory with a foreign terminal", () => {
    const memory: Record<string, string> = { local: "ses-b2" }
    const result = deps()
    result.value.tabMemory = () => memory
    result.value.saveTabMemory = createTabMemory({
      selection: () => "local",
      tab: () => "terminal:a",
      multi: () => true,
      applied: () => "b",
      active: () => "b",
      owns: () => false,
      locals: () => ["ses-b1", "ses-b2"],
      localTab: (id) => id === "terminal:b",
      set: (key, id) => {
        memory[key] = id
      },
    })
    selectLocalAction(result.value, [{ id: "ses-b1" }, { id: "ses-b2" }])
    expect(memory.local).toBe("ses-b2")
    expect(result.calls).toEqual(["local:ses-b2"])
  })

  it.each(["ses-a2", "pending:a"])("restores %s after leaving a fresh project's draft", (tab) => {
    const memory: Record<string, string> = { local: tab }
    const ids = ["ses-a1", tab]
    const result = deps()
    result.value.isPending = (id) => id.startsWith("pending:")
    result.value.setActivePendingId = (id) => {
      if (id) result.calls.push(`draft:${id}`)
    }
    result.value.tabMemory = () => memory
    result.value.saveTabMemory = createTabMemory({
      selection: () => "local",
      tab: () => "pending:b",
      multi: () => true,
      applied: () => "project-a",
      active: () => "project-a",
      owns: () => false,
      locals: () => ids,
      set: (key, id) => {
        memory[key] = id
      },
    })

    selectLocalAction(result.value, [{ id: "ses-a1" }], ids)

    expect(memory.local).toBe(tab)
    expect(result.calls).toEqual([`${result.value.isPending(tab) ? "draft" : "local"}:${tab}`])
  })

  it("ignores a remembered draft that does not belong to Local", () => {
    const result = deps()
    result.value.isPending = (id) => id.startsWith("pending:")
    result.value.tabMemory = () => ({ local: "pending:b" })

    selectLocalAction(result.value, [{ id: "ses-a" }], ["ses-a"])

    expect(result.calls).toEqual(["local:ses-a"])
  })

  it("focuses a project session when shared session metadata is stale", () => {
    const result = deps()

    selectLocalAction(result.value, [], ["ses-b"])

    expect(result.calls).toContain("local:ses-b")
  })
})

for (const target of ["local", "wt-b"]) {
  describe(`${target} terminal restoration`, () => {
    it("restores Review's backing session and contextual panel", () => {
      createRoot((dispose) => {
        const [current, setCurrent] = createSignal<string | undefined>("ses-2")
        const panels = createSidePanel({ project: () => "a", selection: () => target, current })
        panels.open(SidePanel.EditPreview)
        setCurrent("other")
        expect(panels.panel()).toBeNull()
        const result = deps()
        result.value.tabMemory = () => ({ [target]: "review" })
        result.value.sessionMemory = () => "ses-2"
        result.value.isReviewTab = (id) => id === "review"
        result.value.focusLocal = setCurrent
        result.value.selectSession = setCurrent
        result.value.setReviewActive = (active) => {
          if (active) result.calls.push("review")
        }
        const sessions = [{ id: "ses-1" }, { id: "ses-2" }]
        if (target === "local") selectLocalAction(result.value, sessions)
        else selectWorktreeAction(result.value, target, sessions)
        expect(current()).toBe("ses-2")
        expect(panels.panel()).toBe(SidePanel.EditPreview)
        expect(result.calls).toEqual(["review"])
        dispose()
      })
    })

    it.each([
      { remembered: undefined, ids: [] },
      { remembered: "terminal:closed", ids: [] },
      { remembered: "terminal:second", ids: [] },
      { remembered: "terminal:second", ids: ["ses-1"] },
    ])("restores a terminal with %j", (entry) => {
      createRoot((dispose) => {
        const result = deps()
        const [selection, select] = createSignal("prj-a:other")
        const terms = createTerminalState(selection)
        for (const id of ["terminal:first", "terminal:second"]) {
          terms.add(`prj-a:${target}`, {
            id,
            title: "Terminal",
            wsUrl: "",
            font: { fontFamily: "Menlo", fontSize: 12 },
            placement: "tab",
          })
        }
        result.value.terms = terms
        result.value.nsKey = (id) => `prj-a:${id}`
        result.value.setSelection = (id) => select(`prj-a:${id}`)
        result.value.tabMemory = () => (entry.remembered ? { [target]: entry.remembered } : {})
        result.value.activateTerminal = (id) => {
          terms.setActiveId(id)
          result.calls.push(`terminal:${id}`)
        }

        const sessions = entry.ids.map((id) => ({ id }))
        if (target === "local") selectLocalAction(result.value, sessions, entry.ids)
        else selectWorktreeAction(result.value, target, sessions, entry.ids)

        const expected = entry.remembered === "terminal:second" ? entry.remembered : "terminal:first"
        expect(terms.activeId()).toBe(expected)
        expect(result.calls).toEqual([`terminal:${expected}`])
        expect(terms.current()).toHaveLength(2)
        dispose()
      })
    })

    it("does not select side terminals or another project's terminal", () => {
      createRoot((dispose) => {
        const result = deps()
        const terms = createTerminalState(() => `prj-a:${target}`)
        for (const placement of ["tab", "side"] as const) {
          terms.add(`${placement === "tab" ? "prj-b" : "prj-a"}:${target}`, {
            id: `terminal:${placement}`,
            title: "Terminal",
            wsUrl: "",
            font: { fontFamily: "Menlo", fontSize: 12 },
            placement,
          })
        }
        result.value.terms = terms
        result.value.nsKey = (id) => `prj-a:${id}`
        result.value.activateTerminal = (id) => result.calls.push(`terminal:${id}`)

        if (target === "local") selectLocalAction(result.value, [])
        else selectWorktreeAction(result.value, target, [])

        expect(terms.activeId()).toBeUndefined()
        expect(result.calls).toEqual(target === "local" ? [] : ["reset"])
        dispose()
      })
    })

    it.each(["session", "review"])("preserves the %s fallback ahead of an unremembered terminal", (kind) => {
      const result = deps()
      result.value.terms.forSelection = () => [{ id: "terminal:first" }]
      result.value.activateTerminal = (id) => result.calls.push(`terminal:${id}`)
      result.value.isReviewTab = () => kind === "review"
      result.value.setReviewActive = (active) => {
        if (active) result.calls.push("review")
      }
      const ids = kind === "session" ? ["ses-1"] : []

      if (target === "local") selectLocalAction(result.value, [], ids)
      else selectWorktreeAction(result.value, target, [], ids)

      expect(result.calls).not.toContain("terminal:terminal:first")
      expect(result.calls).toContain(kind === "review" ? "review" : `${target === "local" ? "local" : "select"}:ses-1`)
    })
  })
}

describe("needsLocalDraft", () => {
  it("does not create a session when Local already has a terminal tab", () => {
    expect(needsLocalDraft([], [{ id: "terminal:local" }])).toBe(false)
  })

  it("does not create another draft when a session or draft already exists", () => {
    expect(needsLocalDraft(["ses-1"], [])).toBe(false)
    expect(needsLocalDraft(["pending:1"], [])).toBe(false)
  })

  it("creates a draft for an empty Local context", () => {
    expect(needsLocalDraft([], [])).toBe(true)
  })
})

describe("rememberSelectionTab", () => {
  it("stores the active tab under the sidebar context", () => {
    const calls: string[][] = []

    rememberSelectionTab((selection, tab) => calls.push([selection, tab]), "local", "ses-a2")

    expect(calls).toEqual([["local", "ses-a2"]])
  })
})
