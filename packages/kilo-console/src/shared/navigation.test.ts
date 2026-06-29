import { expect, test } from "bun:test"
import { path, settings, strip } from "./navigation"

test("strips the deployed console base from route paths", () => {
  expect(strip("/console/projects/demo/settings/agents", "/console")).toBe("/projects/demo/settings/agents")
  expect(strip("/console", "/console")).toBe("/")
  expect(strip("/consoleish/projects", "/console")).toBe("/consoleish/projects")
})

test("classifies routes after stripping the console base", () => {
  expect(path("/console/projects/demo/settings/agents", "/console")).toBe("/project")
  expect(path("/console/settings/agents", "/console")).toBe("/settings")
  expect(path("/console/profile", "/console")).toBe("/profile")
  expect(path("/console/kilo/login", "/console")).toBe("/profile")
})

test("builds settings roots without preserving the console base", () => {
  expect(settings("/console/projects/demo/settings/agents", "/console")).toBe("/projects/demo/settings")
  expect(settings("/console/settings/agents", "/console")).toBe("/settings")
})
