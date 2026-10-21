import { expect, test } from "bun:test"
import { KiloMarketplaceRpc } from "@opencode/schema/kilocode/marketplace"
import { Option } from "effect"
import { UserError } from "../src/error"
import { selectUninstall } from "../src/marketplace/handlers/uninstall"

const input = { kind: "skill" as const, id: "theme-factory", project: false, global: false, registry: Option.none<string>() }
const project: KiloMarketplaceRpc.Installed = {
  kind: "skill",
  id: "theme-factory",
  registry: "kilo",
  scope: "project",
  project: "/project",
  paths: ["/project/.kilo2/skills/theme-factory"],
  installedAt: 1,
}
const global: KiloMarketplaceRpc.Installed = { ...project, scope: "global", project: undefined }

test("infers the only installed scope without a flag", () => {
  expect(selectUninstall([project], input)).toBe(project)
  expect(selectUninstall([global], input)).toBe(global)
})

test("does not guess when the item is installed in both scopes", () => {
  expect(() => selectUninstall([project, global], input)).toThrow("pass --project or --global")
  expect(selectUninstall([project, global], { ...input, project: true })).toBe(project)
  expect(selectUninstall([project, global], { ...input, global: true })).toBe(global)
})

test("explicit scope flags never fall back to another scope", () => {
  expect(() => selectUninstall([project], { ...input, global: true })).toThrow("rerun with --project")
  expect(() => selectUninstall([global], { ...input, project: true })).toThrow("rerun with --global")
  expect(() => selectUninstall([project], { ...input, project: true, global: true })).toThrow("Pass only one")
})

test("filters the requested item and registry before inferring scope", () => {
  const other = { ...global, registry: "other" }
  expect(() => selectUninstall([project, other], input)).toThrow("pass --project or --global")
  expect(selectUninstall([project, other], { ...input, registry: Option.some("kilo") })).toBe(project)
  expect(selectUninstall([project, { ...global, id: "other" }, { ...global, kind: "mcp" }], input)).toBe(project)
  expect(() => selectUninstall([project, { ...project, registry: "other" }], input)).toThrow("pass --registry")
})

test("missing installations produce expected user errors", () => {
  expect(() => selectUninstall([], input)).toThrow("not installed from a marketplace")
  expect(() => selectUninstall([], input)).toThrow(UserError)
})
