import { expect, test } from "bun:test"
import { KiloToolRegistry } from "@/kilocode/tool/registry"
import type * as Tool from "@/tool/tool"

// Minimal stub — select() only reads .id from each Tool.Def
const stub = (id: string) => ({ id }) as unknown as Tool.Def

const tools = {
  recall: stub("recall"),
  managerModels: stub("managerModels"),
  memory: stub("memory"),
  save: stub("save"),
  manager: stub("manager"),
  process: stub("process"),
  browser: stub("browser_open"),
  chart: stub("chart"),
  image: stub("image"),
  notify: stub("notify"),
  openPlan: stub("open_plan"),
  send: stub("send_file"),
}

function ids(client: string) {
  const prev = process.env.KILO_CLIENT
  try {
    process.env.KILO_CLIENT = client
    return KiloToolRegistry.extra(tools, {}).map((t) => t.id)
  } finally {
    if (prev === undefined) delete process.env.KILO_CLIENT
    else process.env.KILO_CLIENT = prev
  }
}

test("chart tool is included for vscode", () => {
  expect(ids("vscode")).toContain("chart")
})

test("chart tool is excluded for cli", () => {
  expect(ids("cli")).not.toContain("chart")
})

test("chart tool is excluded for jetbrains", () => {
  expect(ids("jetbrains")).not.toContain("chart")
})

test("browser tool is included only for vscode clients", () => {
  expect(ids("vscode")).toContain("browser_open")
  expect(ids("cli")).not.toContain("browser_open")
  expect(ids("jetbrains")).not.toContain("browser_open")
})

test("open plan tool is included only for vscode clients", () => {
  expect(ids("vscode")).toContain("open_plan")
  expect(ids("cli")).not.toContain("open_plan")
  expect(ids("jetbrains")).not.toContain("open_plan")
})
