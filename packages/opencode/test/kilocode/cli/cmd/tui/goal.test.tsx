import { expect, test } from "bun:test"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { testRender, useRenderer } from "@opentui/solid"
import { createSignal, onCleanup } from "solid-js"
import { GoalPrompt } from "@/kilocode/cli/cmd/tui/component/goal"
import { resolve, TuiConfigProvider } from "@tui/config"
import { KVProvider } from "@tui/context/kv"
import { ThemeProvider } from "@tui/context/theme"
import { OpencodeKeymapProvider, registerOpencodeKeymap } from "@tui/keymap"
import { DialogProvider } from "@tui/ui/dialog"
import { ToastProvider } from "@tui/ui/toast"
import { tmpdir } from "../../../../fixture/fixture"
import { TestTuiContexts } from "../../../../fixture/tui-environment"

test("goal metadata requires text and explicit active state", () => {
  for (const goal of [undefined, null, false, "goal", {}, { text: 3 }, { text: " \n " }]) {
    expect(GoalPrompt.read({ "kilo.goal": goal })).toBeUndefined()
  }
  expect(GoalPrompt.read()).toBeUndefined()
  expect(GoalPrompt.read({ "kilo.goal": { text: "Add tests", active: true } })).toEqual({
    text: "Add tests",
    active: true,
    status: "active",
  })
  expect(GoalPrompt.read({ "kilo.goal": { text: "Add tests", active: "true" } })).toEqual({
    text: "Add tests",
    active: false,
    status: "paused",
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

test("small goal trigger opens native actions above the prompt or blocker", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const [goal, setGoal] = createSignal<ReturnType<typeof GoalPrompt.read>>()
  const [content, setContent] = createSignal("Message prompt")
  const actions: string[] = []
  const ready = Promise.withResolvers<void>()
  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    const config = resolve({}, { terminalSuspend: false })
    onCleanup(registerOpencodeKeymap(keymap, renderer, config))
    return (
      <TestTuiContexts paths={{ state: tmp.path }}>
        <OpencodeKeymapProvider keymap={keymap}>
          <TuiConfigProvider config={config}>
            <KVProvider>
              <ThemeProvider mode="dark" source={{ discover: async () => ({}) }}>
                <ToastProvider>
                  <DialogProvider>
                    <box ref={() => ready.resolve()}>
                      <GoalPrompt.Row goal={goal()} run={(action) => actions.push(action)} />
                      <text>{content()}</text>
                    </box>
                  </DialogProvider>
                </ToastProvider>
              </ThemeProvider>
            </KVProvider>
          </TuiConfigProvider>
        </OpencodeKeymapProvider>
      </TestTuiContexts>
    )
  }
  const app = await testRender(() => <Harness />, { width: 80, height: 24, kittyKeyboard: true })
  async function click(label: string) {
    const lines = app.captureCharFrame().split("\n")
    const y = lines.findIndex((line) => line.includes(label))
    expect(y).toBeGreaterThanOrEqual(0)
    await app.mockMouse.click(lines.at(y)!.indexOf(label) + 1, y)
    await app.renderOnce()
  }

  const frame = () =>
    app
      .captureCharFrame()
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
  try {
    await ready.promise
    await app.renderOnce()
    expect(frame()).toEqual(["Message prompt"])
    setGoal({ text: "Add tests\nand fix failures", active: true, status: "active" })
    await app.renderOnce()
    expect(frame()).toEqual(["Goal active ▾", "Message prompt"])
    await app.mockMouse.click(70, 0)
    await app.renderOnce()
    expect(frame()).toEqual(["Goal active ▾", "Message prompt"])
    await click("Goal active")
    expect(app.captureCharFrame()).toContain("Pause")
    expect(app.captureCharFrame()).toContain("Add tests and fix failures")
    expect(app.captureCharFrame()).toContain("Clear")
    expect(app.captureCharFrame()).not.toContain("Resume")
    expect(app.captureCharFrame()).not.toContain("Search")
    app.mockInput.pressEscape()
    await app.renderOnce()
    expect(actions).toEqual([])
    expect(frame()).toEqual(["Goal active ▾", "Message prompt"])

    setContent("Permission required")
    await app.renderOnce()
    expect(frame()).toEqual(["Goal active ▾", "Permission required"])
    await click("Goal active")
    app.mockInput.pressEnter()
    await app.renderOnce()
    expect(actions).toEqual(["pause"])
    setGoal({ text: "Add tests\nand fix failures", active: false, status: "paused" })
    app.resize(50, 24)
    setContent("Question requires an answer")
    await app.renderOnce()
    expect(frame()).toEqual(["Goal paused ▾", "Question requires an answer"])
    await click("Goal paused")
    expect(app.captureCharFrame()).not.toContain("Pause")
    await click("Resume")
    expect(actions).toEqual(["pause", "resume"])
    setGoal({ text: "Add tests", active: false, status: "complete", reason: "Model reported passing tests" })
    await app.renderOnce()
    await click("Goal complete")
    expect(app.captureCharFrame()).toContain("Restart goal")
    expect(app.captureCharFrame()).toContain("Model reported passing tests")
    app.mockInput.pressEscape()
    await app.renderOnce()
    setGoal({ text: "Add tests", active: false, status: "blocked", reason: "Permission rejected" })
    await app.renderOnce()
    await click("Goal blocked")
    expect(app.captureCharFrame()).toContain("Permission rejected")
    app.mockInput.pressEscape()
    await app.renderOnce()
    setGoal({ text: "Add tests", active: false, status: "paused" })
    await app.renderOnce()
    await click("Goal paused")
    await click("Clear")
    expect(actions).toEqual(["pause", "resume", "clear"])
    setGoal(undefined)
    await app.renderOnce()
    expect(frame()).toEqual(["Question requires an answer"])
  } finally {
    app.renderer.destroy()
  }
})
