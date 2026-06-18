import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import * as vscode from "vscode"
import { detectRooCodeSessions, readRooUiConversation } from "../../src/roo-import/service"

const enc = new TextEncoder()

const task = "/storage/rooveterinaryinc.roo-cline/tasks/019ed071-27f3-741d-b58f-f4d97b7148e2"
const hist = `${task}/history_item.json`
const ui = `${task}/ui_messages.json`

type Fs = typeof vscode.workspace.fs

const fs = vscode.workspace.fs as Fs
const original = {
  readDirectory: fs.readDirectory,
  readFile: fs.readFile,
  stat: fs.stat,
}

describe("roo import", () => {
  beforeEach(() => {
    const files = new Map([
      [
        hist,
        JSON.stringify({
          id: "019ed071-27f3-741d-b58f-f4d97b7148e2",
          ts: 1781613537275,
          task: "Wat is de coolste dinosaurus",
          workspace: "/repo",
          mode: "architect",
        }),
      ],
      [
        ui,
        JSON.stringify([
          { ts: 1781613537275, type: "say", say: "text", text: "Wat is de coolste dinosaurus" },
          { ts: 1781613570989, type: "ask", ask: "resume_task" },
        ]),
      ],
    ])

    fs.readDirectory = async (uri) => {
      if (uri.fsPath === "/storage/rooveterinaryinc.roo-cline/tasks") {
        return [["019ed071-27f3-741d-b58f-f4d97b7148e2", vscode.FileType.Directory]]
      }
      throw new Error(`missing dir ${uri.fsPath}`)
    }

    fs.stat = async (uri) => {
      if (files.has(uri.fsPath)) return { type: vscode.FileType.File, ctime: 0, mtime: 0, size: 1 }
      throw new Error(`missing file ${uri.fsPath}`)
    }

    fs.readFile = async (uri) => {
      const value = files.get(uri.fsPath)
      if (value) return enc.encode(value)
      throw new Error(`missing file ${uri.fsPath}`)
    }
  })

  afterEach(() => {
    fs.readDirectory = original.readDirectory
    fs.readFile = original.readFile
    fs.stat = original.stat
  })

  it("detects rooveterinaryinc.roo-cline sessions that only have UI messages", async () => {
    const source = await detectRooCodeSessions({ globalStorageUri: { fsPath: "/storage/kilocode.kilo-code" } } as never)

    expect(source?.dir).toBe("/storage/rooveterinaryinc.roo-cline/tasks")
    expect(source?.formats["019ed071-27f3-741d-b58f-f4d97b7148e2"]).toBe("ui")
    expect(source?.sessions).toEqual([
      {
        id: "019ed071-27f3-741d-b58f-f4d97b7148e2",
        title: "Wat is de coolste dinosaurus",
        directory: "/repo",
        time: 1781613537275,
      },
    ])
    expect(source?.items[0]).toMatchObject({ mode: "architect" })
  })

  it("converts visible Roo UI text into importable conversation messages", async () => {
    const conversation = await readRooUiConversation(task, "019ed071-27f3-741d-b58f-f4d97b7148e2")

    expect(conversation).toEqual([
      {
        role: "user",
        content: "Wat is de coolste dinosaurus",
        ts: 1781613537275,
      },
    ])
  })
})
