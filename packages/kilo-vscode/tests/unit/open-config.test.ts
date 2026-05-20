import { afterEach, describe, expect, it, mock, spyOn } from "bun:test"
import { mkdir, mkdtemp, rm, stat, writeFile } from "fs/promises"
import * as os from "os"
import * as path from "path"
import * as vscode from "vscode"
import { globalFiles, localFiles } from "../../src/kilo-provider/config-file"
import { openConfig } from "../../src/kilo-provider/open-config"

type Uri = { fsPath: string }

const dirs: string[] = []

const env = {
  HOME: process.env.HOME,
  KILO_CONFIG: process.env.KILO_CONFIG,
  KILO_CONFIG_CONTENT: process.env.KILO_CONFIG_CONTENT,
  KILO_CONFIG_DIR: process.env.KILO_CONFIG_DIR,
  KILO_DISABLE_PROJECT_CONFIG: process.env.KILO_DISABLE_PROJECT_CONFIG,
  XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
}

const labels = {
  noWorkspace: "No workspace",
  openFailed: "Open failed: {{message}}",
  placeholder: "Choose config",
  scope: "Scope",
  sourceEnvContent: "Env content",
  sourceEnvDir: "Env dir",
  sourceEnvFile: "Env file",
  sourceHomeKilo: "Home Kilo",
  sourceHomeKilocode: "Home Kilocode",
  sourceHomeOpencode: "Home Opencode",
  sourceProjectKilo: "Project Kilo",
  sourceProjectKilocode: "Project Kilocode",
  sourceProjectOpencode: "Project Opencode",
  sourceProjectRoot: "Project root",
  sourceXdg: "XDG",
  statusCreate: "Create",
  statusLoaded: "Loaded",
  statusLoadedLegacy: "Loaded legacy",
  statusNotLoaded: "Not loaded",
  title: "Open config",
}

const win = vscode.window as unknown as {
  showErrorMessage: ReturnType<typeof mock>
  showQuickPick: ReturnType<typeof mock>
  showTextDocument: ReturnType<typeof mock>
  showWarningMessage: ReturnType<typeof mock>
}

const workspace = vscode.workspace as unknown as {
  fs: {
    createDirectory: (uri: Uri) => Promise<void>
    stat: (uri: Uri) => Promise<{ type: number; ctime: number; mtime: number; size: number }>
    writeFile: (uri: Uri, data: Uint8Array) => Promise<void>
  }
  openTextDocument: ReturnType<typeof mock>
}

async function temp() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "kilo-config-"))
  dirs.push(dir)
  return dir
}

async function file(name: string, body = "{}") {
  await mkdir(path.dirname(name), { recursive: true })
  await writeFile(name, body)
}

function restore() {
  for (const key of Object.keys(env) as Array<keyof typeof env>) {
    const value = env[key]
    if (value === undefined) delete process.env[key]
    if (value !== undefined) process.env[key] = value
  }
}

function reset() {
  win.showErrorMessage = mock(async () => undefined)
  win.showQuickPick = mock(async (items: Array<{ item: unknown }>) => items[0])
  win.showTextDocument = mock(async () => undefined)
  win.showWarningMessage = mock(async () => undefined)
  workspace.openTextDocument = mock(async (uri: Uri) => ({ uri }))
  workspace.fs.createDirectory = async (uri) => {
    await mkdir(uri.fsPath, { recursive: true })
  }
  workspace.fs.stat = async (uri) => {
    const meta = await stat(uri.fsPath)
    return { type: 1, ctime: meta.ctimeMs, mtime: meta.mtimeMs, size: meta.size }
  }
  workspace.fs.writeFile = async (uri, data) => {
    await file(uri.fsPath, Buffer.from(data).toString())
  }
}

afterEach(async () => {
  restore()
  reset()
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("config file discovery", () => {
  it("discovers global, env, legacy, and virtual config sources", async () => {
    reset()
    const root = await temp()
    const home = path.join(root, "home")
    const xdg = path.join(root, "xdg")
    const extra = path.join(root, "extra")
    const envfile = path.join(root, "env.jsonc")
    const spy = spyOn(os, "homedir").mockReturnValue(home)
    process.env.HOME = home
    process.env.XDG_CONFIG_HOME = xdg
    process.env.KILO_CONFIG = envfile
    process.env.KILO_CONFIG_DIR = extra
    process.env.KILO_CONFIG_CONTENT = "{}"
    await file(path.join(xdg, "kilo", "kilo.json"))
    await file(path.join(home, ".kilocode", "opencode.json"))
    await file(path.join(home, ".opencode", "kilo.jsonc"))
    await file(envfile)

    const list = globalFiles()
    const sources = list.map((item) => item.source)

    expect(sources).toContain("sourceXdg")
    expect(sources).toContain("sourceHomeKilocode")
    expect(sources).toContain("sourceHomeOpencode")
    expect(sources).toContain("sourceEnvFile")
    expect(sources).toContain("sourceEnvDir")
    expect(sources).toContain("sourceEnvContent")
    expect(list.find((item) => item.source === "sourceEnvDir")?.recommended).toBe(true)
    expect(list.find((item) => item.source === "sourceEnvContent")?.virtual).toBe(true)
    spy.mockRestore()
  })

  it("marks project files unloaded when project config is disabled", async () => {
    reset()
    const root = await temp()
    process.env.KILO_DISABLE_PROJECT_CONFIG = "1"
    await file(path.join(root, "kilo.json"))
    await file(path.join(root, ".opencode", "opencode.json"))

    const list = localFiles(root)

    expect(list.every((item) => !item.loaded)).toBe(true)
    expect(list.some((item) => item.source === "sourceProjectRoot" && item.exists)).toBe(true)
    expect(list.some((item) => item.source === "sourceProjectOpencode" && item.legacy)).toBe(true)
    expect(list.find((item) => item.recommended)?.file).toBe(path.join(root, ".kilo", "kilo.jsonc"))
  })
})

describe("openConfig", () => {
  it("reports local config requests without a workspace", async () => {
    reset()

    await openConfig("local", labels)

    expect(win.showWarningMessage).toHaveBeenCalledWith("No workspace")
    expect(win.showQuickPick).not.toHaveBeenCalled()
  })

  it("opens the only editable config without showing the picker", async () => {
    reset()
    const root = await temp()
    const cfg = path.join(root, ".kilo", "kilo.jsonc")
    await file(cfg)

    await openConfig("local", labels, root)

    expect(win.showQuickPick).not.toHaveBeenCalled()
    expect(workspace.openTextDocument).toHaveBeenCalledWith(expect.objectContaining({ fsPath: cfg }))
    expect(win.showTextDocument).toHaveBeenCalledWith(
      expect.objectContaining({ uri: expect.objectContaining({ fsPath: cfg }) }),
      {
        preview: false,
      },
    )
  })

  it("uses the picker for multiple editable configs and creates the selected recommended file", async () => {
    reset()
    const root = await temp()
    const cfg = path.join(root, ".kilo", "kilo.jsonc")
    await file(path.join(root, ".opencode", "opencode.json"))
    win.showQuickPick = mock(async (items: Array<{ item: { recommended?: boolean } }>) =>
      items.find((item) => item.item.recommended),
    )

    await openConfig("local", labels, root)

    expect(win.showQuickPick).toHaveBeenCalled()
    expect(await Bun.file(cfg).text()).toBe(`{
  "$schema": "https://app.kilo.ai/config.json"
}
`)
    expect(workspace.openTextDocument).toHaveBeenCalledWith(expect.objectContaining({ fsPath: cfg }))
  })

  it("shows a localized error when opening the selected config fails", async () => {
    reset()
    const root = await temp()
    const cfg = path.join(root, ".kilo", "kilo.jsonc")
    const spy = spyOn(console, "error").mockImplementation(() => {})
    await file(cfg)
    workspace.openTextDocument = mock(async () => {
      throw new Error("disk denied")
    })

    await openConfig("local", labels, root)

    expect(win.showErrorMessage).toHaveBeenCalledWith("Open failed: disk denied")
    spy.mockRestore()
  })
})
