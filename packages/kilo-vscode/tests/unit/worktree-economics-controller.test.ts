import { describe, expect, it } from "bun:test"
import path from "node:path"

// The controller's request-once behavior is driven entirely by `createEffect`. Under plain
// `bun test`, "solid-js" resolves to its server (SSR) build, where `createEffect` is a no-op
// stub — so a normal bun:test import of the controller would never actually exercise the
// reactive code path this test guards. Following the pattern in
// transcript-rows-reactivity.test.ts, run against the real client build via
// `--conditions=browser` in a subprocess so the effects genuinely run.
const WEBVIEW = path.resolve(import.meta.dir, "../../webview-ui")
const PASS = "WORKTREE_ECONOMICS_CONTROLLER_PASS"
const FAIL = "WORKTREE_ECONOMICS_CONTROLLER_FAIL:"

const SCRIPT = `
  const { createSignal } = await import("solid-js")
  const { createWorktreeEconomics } = await import("./agent-manager/worktree-economics-controller.ts")
  const { SidePanel } = await import("./agent-manager/side-panel-layout.ts")
  const { LOCAL } = await import("./agent-manager/navigate.ts")

  const fail = (reason) => {
    console.log("${FAIL}" + reason)
    process.exit(2)
  }

  const worktree = (id) => ({
    id,
    branch: \`branch-\${id}\`,
    path: \`/tmp/\${id}\`,
    parentBranch: "main",
    createdAt: "2026-09-01T00:00:00.000Z",
  })

  const usageRequests = (posted) => posted.filter((m) => m.type === "agentManager.requestWorktreeUsage")
  const summaryRequests = (posted) => posted.filter((m) => m.type === "agentManager.requestWorktreeUsageSummaries")

  // 1) Requests retained usage once per open and does not loop on the response. This is the
  //    regression guard: the original effect read the \`details()\` signal that \`request()\`
  //    itself writes, so handling the response retriggered the effect and produced an
  //    unbounded fetch loop that tore down the hovered rows and made the info overlay and
  //    tooltip flicker.
  {
    const posted = []
    const [project] = createSignal(undefined)
    const [selection] = createSignal("wt-1")
    const [loaded] = createSignal(true)
    const [worktrees] = createSignal([worktree("wt-1")])
    const [panel] = createSignal(SidePanel.Economics)

    const controller = createWorktreeEconomics({
      project, selection, loaded, worktrees, panel,
      post: (m) => posted.push(m),
      closeHistory: () => {},
      setReviewActive: () => {},
      togglePanel: () => {},
    })

    if (usageRequests(posted).length !== 1) fail("expected exactly one initial usage request")
    if (controller.selected()?.loading !== true) fail("expected the initial request to mark loading")

    controller.handle({ type: "agentManager.worktreeUsage", worktreeId: "wt-1", detail: undefined, timeline: undefined })

    if (usageRequests(posted).length !== 1) fail("handling the response must not trigger another request (loop)")
    if (controller.selected()?.loading !== false) fail("expected loading to clear after the response")
  }

  // 2) Refetches after the panel closes and reopens.
  {
    const posted = []
    const [project] = createSignal(undefined)
    const [selection] = createSignal("wt-1")
    const [loaded] = createSignal(true)
    const [worktrees] = createSignal([worktree("wt-1")])
    const [panel, setPanel] = createSignal(SidePanel.Economics)

    createWorktreeEconomics({
      project, selection, loaded, worktrees, panel,
      post: (m) => posted.push(m),
      closeHistory: () => {},
      setReviewActive: () => {},
      togglePanel: () => {},
    })

    if (usageRequests(posted).length !== 1) fail("expected one request on initial open")
    setPanel(null)
    if (usageRequests(posted).length !== 1) fail("closing the panel must not request usage")
    setPanel(SidePanel.Economics)
    if (usageRequests(posted).length !== 2) fail("reopening the panel must refetch")
  }

  // 3) Refetches when the selected worktree changes while the panel stays open, and never
  //    requests usage for the local (non-worktree) pseudo-entry.
  {
    const posted = []
    const [project] = createSignal(undefined)
    const [selection, setSelection] = createSignal("wt-1")
    const [loaded] = createSignal(true)
    const [worktrees] = createSignal([worktree("wt-1"), worktree("wt-2")])
    const [panel] = createSignal(SidePanel.Economics)

    createWorktreeEconomics({
      project, selection, loaded, worktrees, panel,
      post: (m) => posted.push(m),
      closeHistory: () => {},
      setReviewActive: () => {},
      togglePanel: () => {},
    })

    if (usageRequests(posted).length !== 1) fail("expected one request on initial open")
    setSelection("wt-2")
    const afterSwitch = usageRequests(posted)
    if (afterSwitch.length !== 2) fail("switching worktree while open must refetch")
    if (afterSwitch.at(-1)?.worktreeId !== "wt-2") fail("refetch must target the newly selected worktree")
    setSelection(LOCAL)
    if (usageRequests(posted).length !== 2) fail("selecting the local pseudo-entry must not request usage")
  }

  // 4) Requests summaries once per distinct worktree id set, not on every equal re-render.
  {
    const posted = []
    const [project] = createSignal(undefined)
    const [selection] = createSignal(null)
    const [loaded] = createSignal(true)
    const [worktrees, setWorktrees] = createSignal([worktree("wt-1")])
    const [panel] = createSignal(null)

    createWorktreeEconomics({
      project, selection, loaded, worktrees, panel,
      post: (m) => posted.push(m),
      closeHistory: () => {},
      setReviewActive: () => {},
      togglePanel: () => {},
    })

    if (summaryRequests(posted).length !== 1) fail("expected one initial summaries request")
    setWorktrees([worktree("wt-1")])
    if (summaryRequests(posted).length !== 1) fail("an equal id set must not refetch summaries")
    setWorktrees([worktree("wt-1"), worktree("wt-2")])
    if (summaryRequests(posted).length !== 2) fail("a changed id set must refetch summaries")
  }

  console.log("${PASS}")
`

describe("worktree economics controller", () => {
  it("requests retained usage exactly once per open, without looping on the response", () => {
    const result = Bun.spawnSync([process.execPath, "--conditions=browser", "-e", SCRIPT], {
      cwd: WEBVIEW,
      stdout: "pipe",
      stderr: "pipe",
    })
    const output = result.stdout.toString() + result.stderr.toString()

    if (result.exitCode === 0 && output.includes(PASS)) return
    const index = output.indexOf(FAIL)
    if (index !== -1) {
      expect.unreachable(
        output
          .slice(index + FAIL.length)
          .split("\n")[0]
          ?.trim(),
      )
    }
    expect.unreachable(`worktree economics controller test exited ${result.exitCode}: ${output.trim()}`)
  })
})
