import { describe, expect, test } from "bun:test"
import path from "node:path"
import { candidateConfigFiles, chooseConfigFile, configDirectories } from "../src/open-config"

const root = path.join("/", "repo")
const projectDir = path.join(root, ".kilo")
const globalDir = path.join("/", "home", ".config", "kilo")
const systemDir = path.join("/", "Library", "Application Support", "kilo")
const projectJson = path.join(root, "kilo.json")
const projectJsonc = path.join(root, "kilo.jsonc")
const nestedJson = path.join(projectDir, "kilo.json")
const nestedJsonc = path.join(projectDir, "kilo.jsonc")

describe("configDirectories", () => {
  test("splits global roots from project root and .kilo directories", () => {
    const directories = [globalDir, projectDir, systemDir]
    const documents = [path.join(globalDir, "kilo.jsonc"), projectJsonc, nestedJson]

    expect(
      configDirectories({
        scope: "global",
        target: path.join(globalDir, "kilo.jsonc"),
        projectRoot: root,
        directories,
        documents,
      }),
    ).toEqual([globalDir, systemDir])

    expect(
      configDirectories({
        scope: "project",
        target: nestedJson,
        projectRoot: root,
        directories,
        documents,
      }),
    ).toEqual([root, projectDir])
  })
})

describe("candidateConfigFiles", () => {
  test("offers existing files with their loaded status and only the missing target as create", async () => {
    const existing = new Set([projectJsonc, nestedJson])
    const loaded = new Set([projectJsonc, nestedJson])

    const candidates = await candidateConfigFiles({
      target: nestedJsonc,
      directories: [root, projectDir],
      loaded,
      exists: async (file) => existing.has(file),
      resolve: async (file) => file,
    })

    expect(candidates).toEqual([
      { file: projectJsonc, name: "kilo.jsonc", loaded: true, create: false },
      { file: nestedJson, name: "kilo.json", loaded: true, create: false },
      { file: nestedJsonc, name: "kilo.jsonc", loaded: false, create: true },
    ])
  })

  test("marks an existing file that the server does not load as not loaded", async () => {
    const candidates = await candidateConfigFiles({
      target: projectJson,
      directories: [root],
      loaded: new Set(),
      exists: async (file) => file === projectJson,
      resolve: async (file) => file,
    })

    expect(candidates).toEqual([{ file: projectJson, name: "kilo.json", loaded: false, create: false }])
  })

  test("marks a symlinked candidate loaded from its resolved document and lists it once", async () => {
    const realDir = path.join("/", "home", "dotfiles")
    const real = path.join(realDir, "kilo.jsonc")
    const candidates = await candidateConfigFiles({
      target: real,
      directories: [root, realDir],
      loaded: new Set([real]),
      exists: async (file) => file === projectJsonc || file === real,
      resolve: async (file) => (file === projectJsonc ? real : file),
    })

    expect(candidates).toEqual([{ file: projectJsonc, name: "kilo.jsonc", loaded: true, create: false }])
  })
})

describe("chooseConfigFile", () => {
  const one = { file: projectJson, name: "kilo.json", loaded: true, create: false }
  const two = { file: projectJsonc, name: "kilo.jsonc", loaded: false, create: false }

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
