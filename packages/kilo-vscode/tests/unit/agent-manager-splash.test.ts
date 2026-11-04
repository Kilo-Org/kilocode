import { describe, expect, it } from "bun:test"
import { createRoot } from "solid-js"
import { createFold } from "../../webview-ui/agent-manager/splash/fold"
import { navigate, start, wrap } from "../../webview-ui/agent-manager/splash/carousel-logic"
import { examples } from "../../webview-ui/agent-manager/splash/examples"
import { fleet, rowId } from "../../webview-ui/agent-manager/splash/fleet"
import { fixture } from "../fixtures/run"
import type { WebviewMessage } from "../../webview-ui/src/types/messages"

describe("Agent Manager splash gating", () => {
  it("defaults to legacy and switches live", () => fixture("splash-intro"))
})

describe("Agent Manager splash fold", () => {
  const poster = () => {
    const posted: WebviewMessage[] = []
    return { posted, postMessage: (message: WebviewMessage) => posted.push(message) }
  }
  const fold = (value: boolean) => ({ type: "agentManager.setSplashFolded", folded: value })
  const intro = (value: boolean) => ({ type: "agentManager.setIntroDismissed", dismissed: value })

  it("folds once on the first session and respects stored preferences across reloads", () => {
    const vscode = poster()
    createRoot((dispose) => {
      const state = createFold(vscode)
      expect(state.folded()).toBe(false)
      state.started()
      expect(state.folded()).toBe(true)
      state.started()
      state.show()
      state.started()
      expect(state.folded()).toBe(false)
      dispose()
    })
    expect(vscode.posted).toEqual([fold(true), fold(false)])
    for (const value of [true, false]) {
      const vscode = poster()
      createRoot((dispose) => {
        const state = createFold(vscode, value)
        state.started()
        expect(state.folded()).toBe(value)
        dispose()
      })
      expect(vscode.posted).toEqual([])
    }
  })

  it("honors a prior Skip, hides explicitly, and never auto-folds over either choice", () => {
    const skipped = poster()
    createRoot((dispose) => {
      const state = createFold(skipped, undefined, true)
      expect(state.hidden()).toBe(true)
      state.started()
      expect(state.hidden()).toBe(true)
      dispose()
    })
    expect(skipped.posted).toEqual([])
    const vscode = poster()
    createRoot((dispose) => {
      const state = createFold(vscode)
      state.hide()
      expect(state.hidden()).toBe(true)
      state.started()
      expect(state.hidden()).toBe(true)
      state.show()
      expect(state.hidden()).toBe(false)
      expect(state.folded()).toBe(false)
      state.started()
      expect(state.folded()).toBe(false)
      dispose()
    })
    expect(vscode.posted).toEqual([intro(true), fold(false), intro(false)])
  })
})

describe("Agent Manager splash carousel logic", () => {
  it("navigates with arrows in reading direction, wrapping and Home/End", () => {
    expect(wrap(0, -1, 4)).toBe(3)
    expect(wrap(3, 1, 4)).toBe(0)
    expect([0, 1, 2, 3].map((index) => start(index, 4))).toEqual([0, 0, 1, 1])
    expect(navigate("ArrowRight", 3, 4, false)).toBe(0)
    expect(navigate("ArrowLeft", 0, 4, false)).toBe(3)
    expect(navigate("ArrowRight", 1, 4, true)).toBe(0)
    expect(navigate("ArrowLeft", 3, 4, true)).toBe(0)
    expect(navigate("Home", 2, 4, false)).toBe(0)
    expect(navigate("End", 1, 4, true)).toBe(3)
    expect(navigate("ArrowDown", 1, 4, false)).toBeUndefined()
  })
})

describe("Agent Manager splash preview rows", () => {
  it("maps every feature to a rendered, unique splash-only sidebar id", () => {
    const seen = new Set<string>()
    for (const example of examples) {
      const ids = new Set(
        fleet(example).flatMap((row) => [
          row.project.id,
          ...row.state.worktrees.flatMap((wt) => [wt.id, ...(wt.groupId ? [wt.groupId] : [])]),
          ...(row.state.sections ?? []).map((section) => section.id),
        ]),
      )
      expect(ids.size).toBeGreaterThan(0)
      for (const id of ids) {
        expect(id.startsWith("splash:")).toBe(true)
        expect(seen.has(id)).toBe(false)
        seen.add(id)
      }
      for (const feature of example.features) expect(ids.has(rowId(example, feature.row))).toBe(true)
    }
  })
})
