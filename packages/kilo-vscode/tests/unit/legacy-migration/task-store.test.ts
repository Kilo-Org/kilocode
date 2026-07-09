import { afterEach, describe, expect, it } from "bun:test"
import * as vscode from "vscode"
import { listSessions, resolveSession, scanTaskStore } from "../../../src/legacy-migration/task-store"

type Fs = typeof vscode.workspace.fs
const fs = vscode.workspace.fs as Fs
const original = { readDirectory: fs.readDirectory, readFile: fs.readFile, stat: fs.stat }
const dir = "/storage/kilocode.kilo-code/tasks"
const api = (id: string) => `${dir}/${id}/api_conversation_history.json`

describe("task store history scan", () => {
  afterEach(() => {
    fs.readDirectory = original.readDirectory
    fs.readFile = original.readFile
    fs.stat = original.stat
  })

  it("includes only history items whose conversation file exists, without scanning or parsing disk", async () => {
    let listed = false
    let read = false
    fs.readDirectory = async () => {
      listed = true
      return []
    }
    fs.readFile = async () => {
      read = true
      throw new Error("history scan must not read files")
    }
    fs.stat = async (uri) => {
      if (uri.fsPath === api("keep")) return { type: vscode.FileType.File, ctime: 0, mtime: 0, size: 1 }
      throw new Error(`missing ${uri.fsPath}`)
    }

    const items = [
      { id: "keep", task: "Keep me", workspace: "/repo", ts: 1700000000000 },
      { id: "gone", task: "Deleted on disk", workspace: "/repo", ts: 1700000000001 },
    ]
    const scan = await scanTaskStore(dir, items, { mode: "history" })

    // "gone" is dropped (no file) and on-disk orphans are never considered (no enumeration).
    expect(listSessions(scan.catalog)).toEqual([
      { id: "keep", title: "Keep me", directory: "/repo", time: 1700000000000 },
    ])
    expect(resolveSession(scan.catalog, "keep")).toMatchObject({ id: "keep", dir })
    expect(scan.diagnostics).toEqual([])
    expect(listed).toBe(false)
    expect(read).toBe(false)
  })
})
