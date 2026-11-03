import { describe, expect, it } from "bun:test"
import { createRoot } from "solid-js"
import { createFold } from "../../webview-ui/agent-manager/splash/fold"
import { splash } from "../../webview-ui/agent-manager/splash/gate"
import { isKnownRootSession, LOCAL } from "../../webview-ui/agent-manager/navigate"
import { backgroundCreated } from "../../webview-ui/agent-manager/project/local-tabs"
import { createProjectStore } from "../../webview-ui/agent-manager/project/store"
import { fixture } from "../fixtures/run"
import type { ExtensionMessage, WebviewMessage } from "../../webview-ui/src/types/messages"

const source = await Bun.file(new URL("../../webview-ui/agent-manager/AgentManagerApp.tsx", import.meta.url)).text()

describe("Agent Manager splash gating", () => {
  it("keeps the dev gate off", () => {
    expect(splash).toBe(false)
  })

  it("renders the legacy intro, whose session start posts nothing, while the gate is off", () =>
    fixture("splash-intro"))
})

describe("Agent Manager accepted session auto-fold boundary", () => {
  // Execute the real subscription, including guards, without mounting the entire application.
  const start = source.indexOf("    const unsubCreate = vscode.onMessage(")
  const end = source.indexOf("\n    // Mark sessions loaded", start)
  if (start < 0 || end < 0) throw new Error("Agent Manager sessionCreated subscription not found")
  const code = new Bun.Transpiler({ loader: "tsx" }).transformSync(source.slice(start, end))

  for (const kind of [
    "closed",
    "discarded",
    "removed",
    "duplicate",
    "echo",
    "child",
    "local",
    "worktree",
    "background",
  ]) {
    it(`${kind} session creation ${["local", "worktree", "background"].includes(kind) ? "folds" : "does not fold"}`, () => {
      createRoot((dispose) => {
        const posted: WebviewMessage[] = []
        const vscode = {
          onMessage: (handler: (msg: ExtensionMessage) => void) => handler,
          postMessage: (message: WebviewMessage) => posted.push(message),
        }
        const fold = createFold(vscode)
        const scope = {
          vscode,
          intro: fold,
          isKnownRootSession,
          createdSessions: new Set(kind === "echo" ? ["session"] : []),
          closedDrafts: new Set(kind === "closed" ? ["draft"] : []),
          promotePendingDraftDiscard: () => kind === "discarded",
          registry: { all: () => [], ensure: () => createProjectStore("b") },
          currentProjectId: () => "a",
          projectList: () => [{ id: "a" }, { id: "b" }],
          backgroundCreated,
          localSessionIDs: () => (kind === "duplicate" ? ["session"] : []),
          worktreeSessionIds: () => new Set(kind === "worktree" ? ["session"] : []),
          activePendingId: () => undefined,
          selection: () => LOCAL,
          saveTabMemory: () => {},
          placeLocal: () => {},
          setSelection: () => {},
          session: { selectSession: () => {} },
          LOCAL,
        }
        const handle = new Function(...Object.keys(scope), `${code}\nreturn unsubCreate`)(...Object.values(scope)) as (
          msg: ExtensionMessage,
        ) => void
        handle({
          type: "sessionCreated",
          projectId: kind === "removed" ? "removed" : kind === "background" ? "b" : "a",
          draftID: kind === "closed" || kind === "discarded" ? "draft" : undefined,
          session: { id: "session", parentID: kind === "child" ? "parent" : null, createdAt: "", updatedAt: "" },
        })
        const accepted = ["local", "worktree", "background"].includes(kind)
        expect(fold.folded()).toBe(accepted)
        expect(posted.filter((message) => message.type === "agentManager.setSplashFolded")).toEqual(
          accepted ? [{ type: "agentManager.setSplashFolded", folded: true }] : [],
        )
        dispose()
      })
    })
  }
})

describe("Agent Manager splash fold", () => {
  const poster = () => {
    const posted: WebviewMessage[] = []
    return { posted, postMessage: (message: WebviewMessage) => posted.push(message) }
  }
  const fold = (value: boolean) => ({ type: "agentManager.setSplashFolded", folded: value })

  it("starts expanded with no preference and posts each explicit change", () => {
    const vscode = poster()
    createRoot((dispose) => {
      const state = createFold(vscode)
      expect(state.folded()).toBe(false)
      state.fold()
      expect(state.folded()).toBe(true)
      state.unfold()
      expect(state.folded()).toBe(false)
      dispose()
    })
    expect(vscode.posted).toEqual([fold(true), fold(false)])
  })

  it("restores a folded preference", () => {
    createRoot((dispose) => {
      expect(createFold(poster(), true).folded()).toBe(true)
      dispose()
    })
  })

  it("folds once on the first session while no preference exists", () => {
    const vscode = poster()
    createRoot((dispose) => {
      const state = createFold(vscode)
      state.started()
      expect(state.folded()).toBe(true)
      state.started()
      state.unfold()
      state.started()
      expect(state.folded()).toBe(false)
      dispose()
    })
    expect(vscode.posted).toEqual([fold(true), fold(false)])
  })

  it("leaves a stored preference alone on session start, across reloads", () => {
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

  it("does not auto-fold after Hide and Show examples before any session", () => {
    const vscode = poster()
    createRoot((dispose) => {
      const state = createFold(vscode)
      state.fold()
      state.unfold()
      state.started()
      expect(state.folded()).toBe(false)
      dispose()
    })
    expect(vscode.posted).toEqual([fold(true), fold(false)])
  })
})
