import { afterEach, describe, expect, mock, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

let entries: { type: string; path?: string }[] = []
mock.module("../src/local", () => ({
  local: async () => new Response(JSON.stringify(entries)),
}))

const { readDisplaySettings } = await import("../src/display-settings")

const directories: string[] = []

async function directory() {
  const path = await mkdtemp(join(tmpdir(), "kilo-display-settings-"))
  directories.push(path)
  return path
}

afterEach(async () => {
  entries = []
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

const server = { url: "http://127.0.0.1:1", authorization: "test" }

describe("readDisplaySettings", () => {
  test("reads every config document in priority order and keeps the v1 defaults", async () => {
    const root = await directory()
    const global = join(root, "kilo2.json")
    const project = join(root, "project.json")
    await writeFile(global, '{"terminal_command_display": "collapsed"}')
    await writeFile(project, '{"code_edit_display": "expanded"}')
    entries = [
      { type: "document", path: global },
      { type: "document", path: project },
      { type: "document", path: join(root, "missing.json") },
      { type: "directory", path: root },
    ]

    expect(await readDisplaySettings({ server, directory: root })).toEqual({
      terminalCommandDisplay: "collapsed",
      codeEditDisplay: "expanded",
      mcpToolDisplay: "collapsed",
    })
  })

  test("returns the defaults when the server lists no document", async () => {
    const root = await directory()
    entries = []
    expect(await readDisplaySettings({ server, directory: root })).toEqual({
      terminalCommandDisplay: "expanded",
      codeEditDisplay: "collapsed",
      mcpToolDisplay: "collapsed",
    })
  })
})
