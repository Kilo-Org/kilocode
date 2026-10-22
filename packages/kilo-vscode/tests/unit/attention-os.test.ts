import { describe, expect, it } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { notificationCommand, readAppID, testOSNotification } from "../../src/services/attention/os"

const APPID = "Microsoft.VisualStudioCode"

function script(command: { args: string[] } | undefined) {
  return Buffer.from(command?.args.at(-1) ?? "", "base64").toString("utf16le")
}

function xml(command: { env?: Record<string, string> } | undefined) {
  return Buffer.from(command?.env?.KILO_TOAST_XML ?? "", "base64").toString("utf8")
}

describe("OS attention notifications", () => {
  const notice = {
    message: "Kilo task completed.",
    workspace: "kilo-vscode",
    session: "Add notifications",
  }

  it("builds a Windows WinRT notification command", () => {
    const command = notificationCommand(notice, "win32", APPID)

    expect(command?.cmd).toBe("powershell.exe")
    expect(command?.args.slice(0, 3)).toEqual(["-NoProfile", "-NonInteractive", "-EncodedCommand"])
    expect(command?.env?.KILO_TOAST_APPID).toBe(APPID)
    expect(xml(command)).toContain("Workspace: kilo-vscode")
    expect(xml(command)).toContain("Session: Add notifications")
  })

  it("passes the toast payload and identity as data, never as script source", () => {
    const command = notificationCommand(notice, "win32", APPID)
    const text = script(command)

    // The script must be a fixed program: no notice content and no identity in it.
    expect(text).not.toContain("kilo-vscode")
    expect(text).not.toContain("Add notifications")
    expect(text).not.toContain(APPID)
    expect(text).toContain("$env:KILO_TOAST_XML")
    expect(text).toContain("$env:KILO_TOAST_APPID")
  })

  it("cannot be escaped by Unicode smart quotes in a session title", () => {
    // XML escaping does not touch U+2018/U+2019, which PowerShell also accepts
    // as string delimiters. If the payload were interpolated into the script,
    // this title would close the literal and run the trailing command.
    const attack = "\u2019; Start-Process calc.exe; '"
    const command = notificationCommand({ message: "Kilo task completed.", session: attack }, "win32", APPID)
    const text = script(command)

    expect(text).not.toContain("Start-Process")
    expect(text).not.toContain("\u2019")
    // It survives intact as inert data instead.
    expect(xml(command)).toContain("Start-Process calc.exe")
  })

  it("declines to build a Windows command without a verified identity", () => {
    // Guessing would attribute the toast to the wrong editor.
    expect(notificationCommand(notice, "win32")).toBeUndefined()
    expect(notificationCommand(notice, "win32", "")).toBeUndefined()
  })

  it("builds an escaped macOS osascript command", () => {
    const command = notificationCommand(
      { message: 'Kilo said "done"', workspace: "repo", session: "path\\name" },
      "darwin",
    )

    expect(command).toEqual({
      cmd: "osascript",
      args: [
        "-e",
        'display notification "Kilo said \\"done\\" Workspace: repo Session: path\\\\name" with title "Kilo Code"',
      ],
    })
  })

  it("builds a Linux notify-send command", () => {
    expect(notificationCommand(notice, "linux")).toEqual({
      cmd: "notify-send",
      args: [
        "--app-name=Kilo Code",
        "--urgency=normal",
        "Kilo Code",
        "Kilo task completed.\nWorkspace: kilo-vscode\nSession: Add notifications",
      ],
    })
  })

  it("escapes Pango markup in the Linux body so the toast is not dropped", () => {
    // libnotify parses the body as markup: a raw `<` or `&` from a workspace or
    // session name can make the daemon reject the notification outright.
    const command = notificationCommand(
      { message: "Kilo task completed.", workspace: "foo & bar", session: "<b>fix</b>" },
      "linux",
    )

    expect(command?.args.at(-1)).toBe("Kilo task completed.\nWorkspace: foo &amp; bar\nSession: &lt;b&gt;fix&lt;/b&gt;")
    // Quotes and apostrophes are not markup, so they stay readable.
    expect(notificationCommand({ message: `it's "done"` }, "linux")?.args.at(-1)).toBe(`it's "done"`)
  })

  it("does not build a command for unsupported platforms", () => {
    expect(notificationCommand(notice, "freebsd")).toBeUndefined()
  })
})

describe("readAppID", () => {
  async function withProduct(content: string | undefined) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-appid-"))
    if (content !== undefined) await fs.writeFile(path.join(dir, "product.json"), content, "utf8")
    const result = await readAppID(dir)
    await fs.rm(dir, { recursive: true, force: true })
    return result
  }

  it("reads the running host's identity instead of assuming VS Code", async () => {
    // A fork such as Cursor or Antigravity ships its own identity here.
    expect(await withProduct(JSON.stringify({ win32AppUserModelId: "Anysphere.Cursor" }))).toBe("Anysphere.Cursor")
  })

  it("returns undefined when product.json is missing, malformed, or lacks the field", async () => {
    expect(await withProduct(undefined)).toBeUndefined()
    expect(await withProduct("{ not json")).toBeUndefined()
    expect(await withProduct(JSON.stringify({ nameLong: "Some Editor" }))).toBeUndefined()
  })

  it("returns undefined without throwing when the host reports no appRoot", async () => {
    expect(await readAppID(undefined)).toBeUndefined()
    expect(await readAppID("")).toBeUndefined()
  })

  it("rejects values that are not usable identities", async () => {
    expect(await withProduct(JSON.stringify({ win32AppUserModelId: "   " }))).toBeUndefined()
    expect(await withProduct(JSON.stringify({ win32AppUserModelId: 42 }))).toBeUndefined()
    expect(await withProduct(JSON.stringify({ win32AppUserModelId: "Bad\u0000Id" }))).toBeUndefined()
    expect(await withProduct(JSON.stringify({ win32AppUserModelId: "x".repeat(300) }))).toBeUndefined()
  })
})

describe("testOSNotification", () => {
  it("reports an explicit error for unsupported platforms without spawning anything", async () => {
    const result = await testOSNotification("freebsd")
    expect(result).toEqual({ ok: false, error: "OS notifications aren't supported on this platform." })
  })

  it("reports a real failure when the native command binary is absent on this host", async () => {
    // Pick a supported platform other than the one running these tests, so its
    // binary is guaranteed missing — a genuine failure from the real exec()
    // path, not a mocked one. Deliberately never win32: that path needs an app
    // identity first and would report the identity error instead of an exec
    // failure, which is not what this test is about.
    const foreign = process.platform === "darwin" ? "linux" : "darwin"
    const result = await testOSNotification(foreign)
    expect(result.ok).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it("reports the identity error on Windows when the host identity is unavailable", async () => {
    // `vscode.env.appRoot` is not set in this harness, so this exercises the
    // fail-safe path: no command is spawned and the reason is explicit.
    const result = await testOSNotification("win32")
    expect(result).toEqual({
      ok: false,
      error:
        "Could not determine this editor's notification identity, so native notifications are unavailable. VS Code notifications still work.",
    })
  })
})
