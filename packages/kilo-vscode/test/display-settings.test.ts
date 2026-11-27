import { afterAll, afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { readDisplaySettings } from "../src/display-settings"
import { getWorkStylePreset } from "../src/shared/work-style-presets"

let entries: { type: string; path?: string }[] = []
const server = Bun.serve({
  port: 0,
  fetch() {
    return Response.json(entries)
  },
})

const directories: string[] = []

async function directory() {
  const path = await mkdtemp(join(tmpdir(), "kilo-display-settings-"))
  directories.push(path)
  return path
}

afterEach(async () => {
  entries = []
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })),
  )
})

afterAll(() => server.stop(true))

describe("readDisplaySettings", () => {
  test("reads config documents in priority order and keeps defaults for unset layouts", async () => {
    const root = await directory()
    const global = join(root, "kilo2.json")
    const project = join(root, "project.json")
    await writeFile(global, '{"terminal_command_display": "collapsed"}')
    await writeFile(project, '{"terminal_command_display": "expanded", "code_edit_display": "expanded"}')
    entries = [
      { type: "document", path: global },
      { type: "document", path: project },
      { type: "document", path: join(root, "missing.json") },
      { type: "directory", path: root },
    ]

    expect(
      await readDisplaySettings({
        server: { url: `http://127.0.0.1:${server.port}`, authorization: "test" },
        directory: root,
      }),
    ).toEqual({
      terminalCommandDisplay: "expanded",
      codeEditDisplay: "expanded",
      mcpToolDisplay: "collapsed",
      codeModeDisplay: "expanded",
      reasoningDisplay: "preview",
    })
  })

  test("uses the High autonomy display preset when the server lists no document", async () => {
    const root = await directory()
    entries = []
    const preset = getWorkStylePreset("autonomous").display
    expect(
      await readDisplaySettings({
        server: { url: `http://127.0.0.1:${server.port}`, authorization: "test" },
        directory: root,
      }),
    ).toEqual({
      terminalCommandDisplay: preset.terminal_command_display,
      codeEditDisplay: preset.code_edit_display,
      mcpToolDisplay: preset.mcp_tool_display,
      codeModeDisplay: preset.code_mode_display,
      reasoningDisplay: preset.reasoning_display,
    })
  })

  test("lets the explicit reasoning mode win over the legacy boolean", async () => {
    const root = await directory()
    const global = join(root, "kilo2.json")
    const project = join(root, "project.json")
    await writeFile(global, '{"auto_collapse_reasoning": true}')
    await writeFile(project, '{"reasoning_display": "headline"}')
    entries = [
      { type: "document", path: global },
      { type: "document", path: project },
    ]

    expect(
      (
        await readDisplaySettings({
          server: { url: `http://127.0.0.1:${server.port}`, authorization: "test" },
          directory: root,
        })
      ).reasoningDisplay,
    ).toBe("headline")
  })
})
