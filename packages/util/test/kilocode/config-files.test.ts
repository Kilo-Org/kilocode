import { expect, test } from "bun:test"
import path from "node:path"
import { KiloConfigFiles } from "../../src/kilocode/config/files.js"

test("CLI and editor share the stable read/write precedence", () => {
  expect({
    names: KiloConfigFiles.names,
    directoryFiles: KiloConfigFiles.directoryFiles,
    directories: KiloConfigFiles.directories,
    newFile: KiloConfigFiles.newFile,
    managedFiles: KiloConfigFiles.managedFiles,
    project: KiloConfigFiles.writeCandidates("/repo", false),
    global: KiloConfigFiles.writeCandidates("/global", true),
  }).toEqual({
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
})
