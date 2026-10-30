import { describe, expect, test } from "bun:test"
import { candidateConfigFiles, chooseConfigFile, configDirectories } from "../src/open-config"

describe("configDirectories", () => {
  test("splits global roots from project root and .kilo2 directories", () => {
    const directories = ["/home/.config/kilo2", "/repo/.kilo2", "/Library/Application Support/kilo"]
    const documents = ["/home/.config/kilo2/kilo2.jsonc", "/repo/kilo2.jsonc", "/repo/.kilo2/kilo2.json"]

    expect(
      configDirectories({
        scope: "global",
        target: "/home/.config/kilo2/kilo2.jsonc",
        projectRoot: "/repo",
        directories,
        documents,
      }),
    ).toEqual(["/home/.config/kilo2", "/Library/Application Support/kilo"])

    expect(
      configDirectories({
        scope: "project",
        target: "/repo/.kilo2/kilo2.json",
        projectRoot: "/repo",
        directories,
        documents,
      }),
    ).toEqual(["/repo", "/repo/.kilo2"])
  })
})

describe("candidateConfigFiles", () => {
  test("offers existing files with their loaded status and only the missing target as create", async () => {
    const existing = new Set(["/repo/kilo2.jsonc", "/repo/.kilo2/kilo2.json"])
    const loaded = new Set(["/repo/kilo2.jsonc", "/repo/.kilo2/kilo2.json"])

    const candidates = await candidateConfigFiles({
      target: "/repo/.kilo2/kilo2.jsonc",
      directories: ["/repo", "/repo/.kilo2"],
      loaded,
      exists: async (file) => existing.has(file),
    })

    expect(candidates).toEqual([
      { file: "/repo/kilo2.jsonc", name: "kilo2.jsonc", loaded: true, create: false },
      { file: "/repo/.kilo2/kilo2.json", name: "kilo2.json", loaded: true, create: false },
      { file: "/repo/.kilo2/kilo2.jsonc", name: "kilo2.jsonc", loaded: false, create: true },
    ])
  })

  test("marks an existing file that the server does not load as not loaded", async () => {
    const candidates = await candidateConfigFiles({
      target: "/repo/kilo2.json",
      directories: ["/repo"],
      loaded: new Set(),
      exists: async (file) => file === "/repo/kilo2.json",
    })

    expect(candidates).toEqual([
      { file: "/repo/kilo2.json", name: "kilo2.json", loaded: false, create: false },
    ])
  })
})

describe("chooseConfigFile", () => {
  const one = { file: "/repo/kilo2.json", name: "kilo2.json", loaded: true, create: false }
  const two = { file: "/repo/kilo2.jsonc", name: "kilo2.jsonc", loaded: false, create: false }

  test("opens the only candidate without a quick pick", async () => {
    const chosen = await chooseConfigFile([one], async () => {
      throw new Error("quick pick must not open")
    })
    expect(chosen).toEqual(one)
  })

  test("returns the chosen candidate from the quick pick", async () => {
    const chosen = await chooseConfigFile([one, two], async (items) => {
      expect(items.map((item) => item.description)).toEqual(["Loaded", "Not loaded"])
      return items.find((item) => item.candidate === two)
    })
    expect(chosen).toEqual(two)
  })

  test("returns undefined when the quick pick is dismissed", async () => {
    expect(await chooseConfigFile([one, two], async () => undefined)).toBeUndefined()
  })
})
