import { expect, test } from "bun:test"
import { ModeSwitch } from "@/kilocode/cli/cmd/tui/routes/session/mode-switch"

test("formats mode switch approval choices", () => {
  expect(
    ModeSwitch.prompt({
      source: "code",
      target: "debug",
      reason: "Investigate the failure.",
    }),
  ).toEqual({
    heading: "Agent requests a mode change",
    title: "code → debug",
    reason: "Investigate the failure.",
    options: { once: "Switch to debug", reject: "Stay in code" },
  })
})

test("formats pending, switched, and continued transitions", () => {
  const input = { target: "debug", reason: "Investigate the failure." }
  expect(ModeSwitch.event(input, {})).toEqual({
    title: "Switching to debug…",
    reason: "Investigate the failure.",
  })
  expect(
    ModeSwitch.event(input, {
      status: "switched",
      source: "code",
      target: "debug",
      reason: "Investigate the failure.",
    }),
  ).toEqual({
    title: "Mode switched: code → debug",
    reason: "Investigate the failure.",
  })
  expect(
    ModeSwitch.event(input, {
      status: "continued",
      source: "code",
      target: "debug",
      reason: "Investigate the failure.",
    }),
  ).toEqual({
    title: "Continued in code",
    reason: "Investigate the failure.",
  })
})

test("updates only the visible session mode", () => {
  const event = { properties: { sessionID: "ses_mode", agent: "debug" } }
  expect(ModeSwitch.switched("ses_mode", event)).toBe("debug")
  expect(ModeSwitch.switched("ses_other", event)).toBeUndefined()
})
