import { expect, test } from "bun:test"
import { KiloSteer } from "../../src/kilocode/steer"

const child = {
  parentID: "ses_parent",
  agent: "explore",
  model: { id: "sub-model", providerID: "sub", variant: "high" },
}
const root = { agent: "code", model: { id: "main-model", providerID: "main" } }

test("a steering prompt keeps the child's agent, model, and variant", () => {
  expect(KiloSteer.prompt(child)).toEqual({
    agent: "explore",
    model: { providerID: "sub", modelID: "sub-model" },
    variant: "high",
  })
})

test("primary sessions keep the current selection", () => {
  for (const session of [root, undefined]) {
    expect(KiloSteer.prompt(session)).toEqual({})
    expect(KiloSteer.mark(session)).toEqual({})
    expect(KiloSteer.steering(session)).toBe(false)
  }
})

test("a default child variant clears the primary variant instead of inheriting it", () => {
  const plain = { ...child, model: { ...child.model, variant: "default" } }
  expect(KiloSteer.prompt(plain)).toEqual({
    agent: "explore",
    model: { providerID: "sub", modelID: "sub-model" },
    variant: undefined,
  })
})

test("only subagent text is marked as a human steer", () => {
  expect(KiloSteer.mark(child)).toEqual({ metadata: { kind: "subagent_steer" } })
  expect(KiloSteer.steering(child)).toBe(true)
})

test("subagent views accept input only while the child is running", () => {
  expect(KiloSteer.open(child, "busy")).toBe(true)
  expect(KiloSteer.open(child, "retry")).toBe(true)
  expect(KiloSteer.open(child, "idle")).toBe(false)
  expect(KiloSteer.open(child, undefined)).toBe(false)
  expect(KiloSteer.open(root, "idle")).toBe(true)
})

test("subagent-view keys yield only once the focused prompt has text", () => {
  expect(KiloSteer.idle(undefined)).toBe(true)
  expect(KiloSteer.idle({ focused: false, current: { input: "draft" } })).toBe(true)
  expect(KiloSteer.idle({ focused: true, current: { input: "" } })).toBe(true)
  expect(KiloSteer.idle({ focused: true, current: { input: "draft" } })).toBe(false)
})

test("the steered agent comes from the session, then its latest reply, then the task title", () => {
  const title = "inspect bug (@explore subagent)"
  expect(KiloSteer.agent({ agent: "general", title }, "build")).toBe("general")
  expect(KiloSteer.agent({ title }, "build")).toBe("build")
  expect(KiloSteer.agent({ title })).toBe("explore")
  expect(KiloSteer.agent({ title: "untitled" })).toBeUndefined()
  expect(KiloSteer.agent(undefined)).toBeUndefined()
})

test("the steered model shows display names and falls back to raw ids", () => {
  const providers = [{ id: "sub", name: "Sub Provider", models: { "sub-model": { name: "Sub Model" } } }]
  expect(KiloSteer.model({ id: "sub-model", providerID: "sub" }, providers)).toEqual({
    name: "Sub Model",
    provider: "Sub Provider",
  })
  expect(KiloSteer.model({ id: "gone", providerID: "missing" }, providers)).toEqual({
    name: "gone",
    provider: "missing",
  })
  expect(KiloSteer.model(undefined, providers)).toBeUndefined()
})
