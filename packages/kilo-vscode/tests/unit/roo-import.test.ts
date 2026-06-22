import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import * as vscode from "vscode"
import { createSessionID } from "../../src/legacy-migration/sessions/lib/ids"
import { parseSession } from "../../src/legacy-migration/sessions/parser"
import { detectRooCodeSessions } from "../../src/roo-import/service"

const enc = new TextEncoder()
const first = "/storage/roovscode.roo-cline/tasks"
const second = "/storage/rooveterinaryinc.roo-cline/tasks"
const customRoot = "/custom/roo/tasks"
const id = "1781613537275"
const other = "1781613537276"
const missing = "1781613537277"
const customId = "1781613537278"
const special = "__proto__"

type Fs = typeof vscode.workspace.fs
const fs = vscode.workspace.fs as Fs
const original = {
  readDirectory: fs.readDirectory,
  readFile: fs.readFile,
  stat: fs.stat,
}

let files: Map<string, { value: string; mtime: number }>
let dirs: Map<string, string[]>

describe("roo import", () => {
  beforeEach(() => {
    files = new Map([
      [
        `${first}/${id}/api_conversation_history.json`,
        { value: JSON.stringify([{ role: "user", content: "First root" }]), mtime: 10 },
      ],
      [
        `${first}/${special}/api_conversation_history.json`,
        { value: JSON.stringify([{ role: "user", content: "Special" }]), mtime: 10 },
      ],
      [
        `${first}/${id}/history_item.json`,
        {
          value: JSON.stringify({ id, ts: Number(id), task: "First root", workspace: "/old", mode: "architect" }),
          mtime: 10,
        },
      ],
      [
        `${first}/_index.json`,
        {
          value: JSON.stringify({
            version: 1,
            entries: [{ id: special, ts: 1, task: "Special", workspace: "/indexed" }],
          }),
          mtime: 10,
        },
      ],
      [
        `${second}/${id}/api_conversation_history.json`,
        { value: JSON.stringify([{ role: "user", content: "New root" }]), mtime: 20 },
      ],
      [
        `${second}/${id}/history_item.json`,
        { value: JSON.stringify({ id, ts: Number(id) + 1, task: "New root", workspace: "/new" }), mtime: 20 },
      ],
      [
        `${second}/_index.json`,
        {
          value: JSON.stringify({
            version: 1,
            entries: [{ id, ts: Number(id), task: "Stale index", workspace: "/stale" }],
          }),
          mtime: 10,
        },
      ],
      [`${second}/${other}/ui_messages.json`, { value: JSON.stringify([{ type: "say", text: "UI only" }]), mtime: 20 }],
      [`${second}/bad/api_conversation_history.json`, { value: "not json", mtime: 20 }],
      [
        `${second}/${missing}/api_conversation_history.json`,
        { value: JSON.stringify([{ role: "user", content: "No workspace" }]), mtime: 20 },
      ],
      [
        `${customRoot}/${customId}/api_conversation_history.json`,
        { value: JSON.stringify([{ role: "user", content: "Custom root" }]), mtime: 30 },
      ],
      [
        `${customRoot}/_index.json`,
        {
          value: JSON.stringify({
            version: 1,
            entries: [{ id: customId, ts: Number(customId), task: "Custom root", workspace: "/custom-repo" }],
          }),
          mtime: 30,
        },
      ],
    ])
    dirs = new Map([
      [first, [id, special]],
      [second, [id, other, "bad", missing]],
      [customRoot, [customId]],
    ])

    fs.readDirectory = async (uri) => {
      const entries = dirs.get(uri.fsPath)
      if (entries) return entries.map((entry) => [entry, vscode.FileType.Directory])
      throw new Error(`missing dir ${uri.fsPath}`)
    }
    fs.stat = async (uri) => {
      const file = files.get(uri.fsPath)
      if (file) return { type: vscode.FileType.File, ctime: 0, mtime: file.mtime, size: file.value.length }
      throw new Error(`missing file ${uri.fsPath}`)
    }
    fs.readFile = async (uri) => {
      const file = files.get(uri.fsPath)
      if (file) return enc.encode(file.value)
      throw new Error(`missing file ${uri.fsPath}`)
    }
  })

  afterEach(() => {
    fs.readDirectory = original.readDirectory
    fs.readFile = original.readFile
    fs.stat = original.stat
  })

  it("recovers indexed metadata, selects the newest duplicate, and diagnoses unusable tasks", async () => {
    const source = await detectRooCodeSessions({ globalStorageUri: { fsPath: "/storage/kilocode.kilo-code" } } as never)

    expect(source?.sessions).toEqual([
      { id, title: "New root", directory: "/new", time: Number(id) + 1 },
      { id: special, title: "Special", directory: "/indexed", time: 1 },
    ])
    expect(source?.catalog.get(id)?.source).toMatchObject({ id, dir: second, namespace: "roo", mtime: 20 })
    expect(source?.catalog.get(special)?.source).toMatchObject({ id: special, dir: first, namespace: "roo" })
    expect(source?.diagnostics.map((item) => [item.id, item.reason])).toEqual([
      [other, "ui-only"],
      [missing, "missing-workspace"],
      ["bad", "malformed"],
    ])
  })

  it("discovers sessions in Roo's configured custom storage path", async () => {
    const source = await detectRooCodeSessions(
      { globalStorageUri: { fsPath: "/storage/kilocode.kilo-code" } } as never,
      "/custom/roo",
    )

    expect(source?.sessions).toContainEqual({
      id: customId,
      title: "Custom root",
      directory: "/custom-repo",
      time: Number(customId),
    })
    expect(source?.catalog.get(customId)?.source.dir).toBe(customRoot)
  })

  it("namespaces generated Roo IDs without changing the visible session slug", async () => {
    const source = await detectRooCodeSessions({ globalStorageUri: { fsPath: "/storage/kilocode.kilo-code" } } as never)
    const entry = source?.catalog.get(id)
    expect(entry).toBeDefined()

    const payload = await parseSession(
      id,
      entry!.source.dir,
      entry!.source.item,
      [{ role: "user", content: "Hi" }],
      `roo:${id}`,
    )

    expect(payload.session.id).toBe(createSessionID(`roo:${id}`))
    expect(payload.session.slug).toBe(id)
    expect(payload.messages[0].sessionID).toBe(createSessionID(`roo:${id}`))
  })
})
