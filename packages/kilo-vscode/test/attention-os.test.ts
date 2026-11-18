import { describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { notificationCommand, readAppID, testOSNotification } from "../src/attention/os"

const APPID = "Microsoft.VisualStudioCode"
const notice = { message: "Kilo task completed.", workspace: "kilo-vscode", session: "Add notifications" }

function script(command: { args: string[] } | undefined) {
  return Buffer.from(command?.args.at(-1) ?? "", "base64").toString("utf16le")
}

function xml(command: { env?: Record<string, string> } | undefined) {
  return Buffer.from(command?.env?.KILO_TOAST_XML ?? "", "base64").toString("utf8")
}

describe("OS attention notifications", () => {
  test("macOS shows the message and its context through osascript", () => {
    const command = notificationCommand(notice, "darwin")
    expect(command).toEqual({
      cmd: "osascript",
      args: [
        "-e",
        'display notification "Kilo task completed. Workspace: kilo-vscode Session: Add notifications" with title "Kilo Code"',
      ],
    })
  })

  test("a session title cannot close the AppleScript string", () => {
    const command = notificationCommand({ message: "Done", session: 'x" & (do shell script "id") & "' }, "darwin")
    expect(command?.args[1]).toBe(
      'display notification "Done Session: x\\" & (do shell script \\"id\\") & \\"" with title "Kilo Code"',
    )
  })

  test("Linux escapes the Pango markup of the body", () => {
    const command = notificationCommand({ message: "Done", session: "<b>a & b</b>" }, "linux")
    expect(command?.cmd).toBe("notify-send")
    expect(command?.args.at(-1)).toBe("Done\nSession: &lt;b&gt;a &amp; b&lt;/b&gt;")
  })

  test("Windows passes the toast payload and identity as data, never as script source", () => {
    const attack = "\u2019; Start-Process calc.exe; '"
    const command = notificationCommand({ ...notice, session: attack }, "win32", APPID)
    const text = script(command)
    expect(command?.cmd).toBe("powershell.exe")
    expect(command?.env?.KILO_TOAST_APPID).toBe(APPID)
    expect(text).not.toContain("Start-Process")
    expect(text).not.toContain(APPID)
    expect(text).toContain("$env:KILO_TOAST_XML")
    expect(xml(command)).toContain("Workspace: kilo-vscode")
    expect(xml(command)).toContain("Start-Process calc.exe")
  })

  test("Windows declines without a verified identity, and other platforms have no command", async () => {
    expect(notificationCommand(notice, "win32")).toBeUndefined()
    expect(notificationCommand(notice, "freebsd")).toBeUndefined()
    expect(await testOSNotification("freebsd")).toEqual({
      ok: false,
      error: "OS notifications aren't supported on this platform.",
    })
  })

  test("the Windows identity comes from a valid product.json only", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "kilo-attention-"))
    try {
      expect(await readAppID(undefined)).toBeUndefined()
      expect(await readAppID(dir)).toBeUndefined()
      await writeFile(path.join(dir, "product.json"), "{")
      expect(await readAppID(dir)).toBeUndefined()
      await writeFile(path.join(dir, "product.json"), JSON.stringify({ win32AppUserModelId: "bad\u0007id" }))
      expect(await readAppID(dir)).toBeUndefined()
      await writeFile(path.join(dir, "product.json"), JSON.stringify({ win32AppUserModelId: ` ${APPID} ` }))
      expect(await readAppID(dir)).toBe(APPID)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
