import { afterAll, beforeAll, expect, spyOn, test } from "bun:test"
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { OpenCode } from "@opencode/client"
import { Session } from "@opencode/schema/session"
import { SessionMessage } from "@opencode/schema/session-message"
import { Uri, window, workspace } from "vscode"
import { exportTranscript } from "../src/kilo-provider/export-transcript"
import { command, manager, type Manager, type Server } from "../src/server"

let root: string
let directory: string
let server: Manager
let target: Server | undefined
let sessionID: string
const texts = Array.from({ length: 205 }, (_, index) => `Message ${index + 1}: café 🌱`)

beforeAll(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), "kilo-transcript-")))
  directory = path.join(root, "worktree")
  await mkdir(directory)
  server = manager({
    command: () => command({ extension: path.resolve(import.meta.dir, ".."), storage: root, env: {} }),
    cwd: root,
    env: process.env,
  })
  target = await server.get()
  const client = OpenCode.make({ baseUrl: target.url, headers: { authorization: target.authorization } })
  const time = Date.now()
  const info = await client.experimental.session.import({
    location: { directory },
    info: {
      id: Session.ID.create(),
      title: "Transcript export fixture",
      projectID: "global",
      location: { directory },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: time, updated: time },
    },
    messages: texts.map((text, index) => ({
      id: SessionMessage.ID.create(),
      type: "user",
      text,
      time: { created: time + index },
    })),
  })
  sessionID = info.id
})

afterAll(async () => {
  // `stop` closes stdin and resolves before the child exits, so the profile and database it holds stay open.
  const exited = new Promise<void>((resolve) => {
    if (!target || target.process.exitCode !== null) {
      resolve()
      return
    }
    target.process.once("exit", () => resolve())
  })
  await server?.stop()
  await exited
  if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

test("exports all pages in server order to the chosen Markdown path as UTF-8", async () => {
  const destination = Uri.file(path.join(root, "chosen.markdown"))
  const save = spyOn(window, "showSaveDialog").mockResolvedValue(destination)
  const write = spyOn(workspace.fs, "writeFile").mockImplementation((uri, content) => writeFile(uri.fsPath, content))
  const success = spyOn(window, "showInformationMessage")
  try {
    await exportTranscript(server, sessionID)

    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith({
      defaultUri: Uri.file(path.join(directory, `session-${sessionID.slice(0, 8)}.md`)),
      filters: { Markdown: ["md", "markdown"] },
      saveLabel: "Export",
    })
    const saved = await readFile(destination.fsPath, "utf8")
    expect(saved).toStartWith("# Transcript export fixture\n")
    expect(saved.split("\n").filter((line) => line.startsWith("Message "))).toEqual(texts)
    expect(success).toHaveBeenCalledTimes(1)
    expect(success).toHaveBeenCalledWith("Session transcript exported as Markdown.")
  } finally {
    save.mockRestore()
    write.mockRestore()
    success.mockRestore()
  }
})

test("closing the save dialog writes nothing and has no notification", async () => {
  const save = spyOn(window, "showSaveDialog").mockResolvedValue(undefined)
  const write = spyOn(workspace.fs, "writeFile")
  const success = spyOn(window, "showInformationMessage")
  const error = spyOn(window, "showErrorMessage")
  try {
    await exportTranscript(server, sessionID)

    expect(save).toHaveBeenCalledTimes(1)
    expect(write).not.toHaveBeenCalled()
    expect(success).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
  } finally {
    save.mockRestore()
    write.mockRestore()
    success.mockRestore()
    error.mockRestore()
  }
})

test("a missing session reports an error without opening the save dialog", async () => {
  const save = spyOn(window, "showSaveDialog")
  const error = spyOn(window, "showErrorMessage")
  try {
    await exportTranscript(server, Session.ID.create())

    expect(save).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledWith(expect.stringContaining("Failed to export session transcript"))
  } finally {
    save.mockRestore()
    error.mockRestore()
  }
})
