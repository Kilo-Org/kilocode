import { expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import { GoalPrompt } from "@/kilocode/cli/cmd/tui/component/goal"

const theme = {
  text: RGBA.fromHex("#ffffff"),
  textMuted: RGBA.fromHex("#888888"),
  success: RGBA.fromHex("#00ff00"),
}

test("goal metadata requires text and explicit active state", () => {
  for (const goal of [undefined, null, false, "goal", {}, { text: 3 }, { text: " \n " }]) {
    expect(GoalPrompt.read({ "kilo.goal": goal })).toBeUndefined()
  }
  expect(GoalPrompt.read()).toBeUndefined()
  expect(GoalPrompt.read({ "kilo.goal": { text: "Add tests", active: true } })).toEqual({
    text: "Add tests",
    active: true,
  })
  expect(GoalPrompt.read({ "kilo.goal": { text: "Add tests", active: "true" } })).toEqual({
    text: "Add tests",
    active: false,
  })
})

test("goal feedback shows bare status and errors while successful controls stay quiet", () => {
  const notices: { title?: string; message: string; variant: string }[] = []
  const toast = { show: (notice: { title?: string; message: string; variant: string }) => notices.push(notice) }
  const result = {
    data: {
      parts: [
        { type: "text", text: "Goal paused" },
        { type: "reasoning", text: "hidden" },
      ],
    },
  }
  GoalPrompt.feedback("goal", "", result, toast)
  expect(notices).toEqual([{ title: "Goal", message: "Goal paused", variant: "info" }])
  for (const args of ["pause", "clear", "resume", "New goal"]) GoalPrompt.feedback("goal", args, result, toast)
  GoalPrompt.feedback("other", "", result, toast)
  GoalPrompt.feedback("other", "", { error: new Error("ignored") }, toast)
  GoalPrompt.feedback("goal", "", { data: { parts: [] } }, toast)
  expect(notices).toHaveLength(1)
  GoalPrompt.feedback("goal", "resume", { error: new Error("Goal is unavailable") }, toast)
  expect(notices.at(-1)).toEqual({ title: "Goal command failed", message: "Goal is unavailable", variant: "error" })
})

test("goal row updates controls, stays compact, and disappears when cleared", async () => {
  const [goal, setGoal] = createSignal<ReturnType<typeof GoalPrompt.read>>()
  const actions: string[] = []
  const app = await testRender(
    () => <GoalPrompt.Row goal={goal()} theme={theme} run={(action) => actions.push(action)} />,
    { width: 80, height: 3 },
  )

  try {
    await app.renderOnce()
    expect(app.captureCharFrame().trim()).toBe("")
    setGoal({ text: "Add tests\nand fix failures", active: true })
    await app.renderOnce()
    const frame = app.captureCharFrame()
    expect(frame).toContain("Goal active")
    expect(frame).toContain("Add tests and fix failures")
    await app.mockMouse.click(frame.indexOf("/goal pause") + 1, 0)
    expect(actions).toEqual(["pause"])

    setGoal({ text: "Add tests\nand fix failures", active: false })
    await app.renderOnce()
    const paused = app.captureCharFrame()
    expect(paused).toContain("Goal paused")
    expect(paused).not.toContain("/goal pause")
    await app.mockMouse.click(paused.indexOf("/goal resume") + 1, 0)
    await app.mockMouse.click(paused.indexOf("/goal clear") + 1, 0)
    expect(actions).toEqual(["pause", "resume", "clear"])

    app.resize(50, 3)
    await app.renderOnce()
    const narrow = app.captureCharFrame().split("\n")
    expect(narrow.at(0)).toContain("/goal resume")
    expect(narrow.at(0)).toContain("/goal clear")
    expect(narrow.slice(1).join("").trim()).toBe("")

    setGoal(undefined)
    await app.renderOnce()
    expect(app.captureCharFrame().trim()).toBe("")
  } finally {
    app.renderer.destroy()
  }
})
