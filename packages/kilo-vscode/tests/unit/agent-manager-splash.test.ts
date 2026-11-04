import { describe, expect, it } from "bun:test"
import { createRoot } from "solid-js"
import { createFold } from "../../webview-ui/agent-manager/splash/fold"
import { splash } from "../../webview-ui/agent-manager/splash/gate"
import { navigate, start, wrap } from "../../webview-ui/agent-manager/splash/carousel-logic"
import { examples, type Row } from "../../webview-ui/agent-manager/splash/examples"
import { fleet, rowId } from "../../webview-ui/agent-manager/splash/fleet"
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

describe("Agent Manager splash example carousel", () => {
  it("wraps arrow navigation around both ends", () => {
    expect(wrap(0, -1, 5)).toBe(4)
    expect(wrap(4, 1, 5)).toBe(0)
    expect(wrap(2, -1, 5)).toBe(1)
    expect(wrap(2, 1, 5)).toBe(3)
  })

  it("keeps three cards visible with the selected example in the window", () => {
    expect([0, 1, 2, 3, 4].map((index) => start(index, 5))).toEqual([0, 0, 1, 2, 2])
    expect(start(0, 2)).toBe(0)
  })

  it("moves with arrow keys in reading direction and jumps with Home and End", () => {
    expect(navigate("ArrowRight", 4, 5, false)).toBe(0)
    expect(navigate("ArrowLeft", 0, 5, false)).toBe(4)
    expect(navigate("ArrowRight", 1, 5, true)).toBe(0)
    expect(navigate("ArrowLeft", 4, 5, true)).toBe(0)
    expect(navigate("Home", 3, 5, false)).toBe(0)
    expect(navigate("End", 1, 5, true)).toBe(4)
    expect(navigate("ArrowDown", 1, 5, false)).toBeUndefined()
  })
})

describe("Agent Manager splash markers", () => {
  it("resolves every feature row to a sidebar id rendered by its fleet", () => {
    for (const example of examples) {
      const ids = new Set(
        fleet(example).flatMap((row) => [
          row.project.id,
          ...row.state.worktrees.flatMap((wt) => [wt.id, ...(wt.groupId ? [wt.groupId] : [])]),
          ...(row.state.sections ?? []).map((section) => section.id),
        ]),
      )
      for (const feature of example.features) expect(ids.has(rowId(example, feature.row))).toBe(true)
    }
  })

  it("leaves the live sidebar unchanged without a marker and badges it with one", () => fixture("sidebar-marker"))
})

describe("Agent Manager splash feature rows", () => {
  it("keeps the prototype's fixture rows in order", () => {
    expect(
      examples.map((example) =>
        example.fixture.projects.flatMap((project) =>
          project.rows.flatMap((row) =>
            row.kind === "session"
              ? row.session.title
              : row.kind === "section"
                ? [row.section.name, ...row.section.sessions.map((session) => session.title)]
                : row.kind === "versions"
                  ? row.sessions.map((session) => session.title)
                  : row.branch,
          ),
        ),
      ),
    ).toEqual([
      ["Usage billing: metering endpoint", "Usage billing: pricing page", "Usage billing: queue and alarms"],
      [
        "main",
        "ORCHESTRATE",
        "Orchestrator · scheduler latency pass",
        "PATCHES",
        "Reduce run-queue lock contention",
        "Batch io_uring submissions",
        "Pin hot kthreads to isolated cores",
      ],
      [
        "IMPLEMENT",
        "Rate-limit the login endpoint",
        "Paginate the audit log",
        "OPS",
        "Merge Captain",
        "Issue Delegator",
        "Adversarial Reviewer",
      ],
      ["main", "Cut cold start time · Kilo Auto", "Cut cold start time · Claude", "Cut cold start time · GPT"],
      [
        "main",
        "Logo direction · geometric",
        "Logo direction · wordmark",
        "Logo direction · monogram",
        "Color and type tokens",
        "Social card templates",
      ],
    ])
    expect(examples.map((example) => fleet(example).map((row) => row.state.worktrees.length))).toEqual([
      [1, 1, 1],
      [4],
      [5],
      [3],
      [5],
    ])
  })

  it("resolves every feature row to exactly one fixture row", () => {
    for (const example of examples) {
      expect(example.features).toHaveLength(3)
      const resolve = (target: Row) => {
        const projects = example.fixture.projects.filter((project) => project.id === target.project)
        expect(projects).toHaveLength(1)
        const project = projects.at(0)!
        if (target.kind === "project") return projects
        if (target.kind === "section") {
          return project.rows.filter((row) => row.kind === "section" && row.section.id === target.section)
        }
        if (target.kind === "group") {
          return project.rows.filter((row) => row.kind === "versions" && row.id === target.group)
        }
        return project.rows
          .flatMap((row) =>
            row.kind === "session"
              ? [row.session]
              : row.kind === "section"
                ? row.section.sessions
                : row.kind === "versions"
                  ? row.sessions
                  : [],
          )
          .filter((session) => session.id === target.session)
      }
      for (const feature of example.features) expect(resolve(feature.row)).toHaveLength(1)
    }
  })

  it("targets the prototype's project, section, version group and sessions", () => {
    expect(examples.map((example) => example.features.map((feature) => feature.row))).toEqual([
      [
        { kind: "project", project: "billing-api" },
        { kind: "session", project: "billing-api", session: "usage-metering" },
        { kind: "session", project: "web-app", session: "pricing-page" },
      ],
      [
        { kind: "session", project: "kernel-sched", session: "orchestrator" },
        { kind: "session", project: "kernel-sched", session: "rq-lock" },
        { kind: "session", project: "kernel-sched", session: "kthread-pin" },
      ],
      [
        { kind: "session", project: "api", session: "merge-captain" },
        { kind: "section", project: "api", section: "implement" },
        { kind: "session", project: "api", session: "adversarial-reviewer" },
      ],
      [
        { kind: "group", project: "storefront", group: "cold-start" },
        { kind: "session", project: "storefront", session: "cold-start-a" },
        { kind: "session", project: "storefront", session: "cold-start-b" },
      ],
      [
        { kind: "group", project: "brand-kit", group: "logo" },
        { kind: "session", project: "brand-kit", session: "tokens" },
        { kind: "session", project: "brand-kit", session: "social-cards" },
      ],
    ])
  })
})
