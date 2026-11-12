import { expect, test } from "bun:test"
import path from "path"
import { pathToFileURL } from "url"

const module = pathToFileURL(path.join(import.meta.dir, "../../src/kilocode/config/files.ts")).href

// The names are fixed when the module loads, so each variant runs in a child process.
async function load(value: string | undefined) {
  const child = Bun.spawn(
    [
      process.execPath,
      "-e",
      `const { KiloConfigFiles: f } = await import(${JSON.stringify(module)});
       process.stdout.write(JSON.stringify({ releaseNames: f.releaseNames, names: f.names, directoryFiles: f.directoryFiles,
         directories: f.directories, newFile: f.newFile, managedFiles: f.managedFiles,
         project: f.writeCandidates("/repo", false), global: f.writeCandidates("/global", true) }))`,
    ],
    {
      env: { ...process.env, KILO_USE_RELEASE_CONFIG: value },
      stdout: "pipe",
      stderr: "pipe",
    },
  )
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  expect(code, stderr).toBe(0)
  return JSON.parse(stdout)
}

test("without KILO_USE_RELEASE_CONFIG the internal kilo2 names apply", async () => {
  expect(await load(undefined)).toEqual({
    releaseNames: false,
    names: ["kilo2.json", "kilo2.jsonc"],
    directoryFiles: ["kilo2.jsonc", "kilo2.json"],
    directories: [".kilo2"],
    newFile: "kilo2.json",
    managedFiles: ["kilo.jsonc", "kilo.json"],
    project: [
      path.join("/repo", ".kilo2", "kilo2.json"),
      path.join("/repo", ".kilo2", "kilo2.jsonc"),
      path.join("/repo", "kilo2.jsonc"),
      path.join("/repo", "kilo2.json"),
    ],
    global: [path.join("/global", "kilo2.jsonc"), path.join("/global", "kilo2.json")],
  })
}, 30_000)

test("KILO_USE_RELEASE_CONFIG=1 switches to the release kilo names", async () => {
  expect(await load("1")).toEqual({
    releaseNames: true,
    names: ["kilo.json", "kilo.jsonc"],
    directoryFiles: ["kilo.jsonc", "kilo.json"],
    directories: [".kilo"],
    newFile: "kilo.json",
    managedFiles: ["kilo.jsonc", "kilo.json"],
    project: [
      path.join("/repo", ".kilo", "kilo.json"),
      path.join("/repo", ".kilo", "kilo.jsonc"),
      path.join("/repo", "kilo.jsonc"),
      path.join("/repo", "kilo.json"),
    ],
    global: [path.join("/global", "kilo.jsonc"), path.join("/global", "kilo.json")],
  })
}, 30_000)

test("only the value 1 enables the release names", async () => {
  expect((await load("true")).releaseNames).toBe(false)
  expect((await load("0")).releaseNames).toBe(false)
}, 30_000)
