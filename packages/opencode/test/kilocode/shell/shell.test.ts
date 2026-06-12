import { describe, expect, test } from "bun:test"
import { Buffer } from "node:buffer"
import * as PowerShell from "@/kilocode/shell/shell"
import { Shell } from "@/shell/shell"

const command = `Write-Output "こんにちは 😀"; Write-Output '$value'; Write-Output \`tick\`
Write-Output "done"`

function script(args: string[]) {
  return Buffer.from(args[4], "base64").toString("utf16le")
}

describe("PowerShell arguments", () => {
  test("transports commands through UTF-8 inside EncodedCommand", () => {
    const args = PowerShell.args(command)
    const value = script(args)
    const payload = value.match(/FromBase64String\('([^']+)'\)/)?.[1]

    expect(args.slice(0, 4)).toEqual(["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand"])
    expect(args).toHaveLength(5)
    expect(value).toContain("[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)")
    expect(value).toContain("[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)")
    expect(value).toContain("$OutputEncoding = [Console]::OutputEncoding")
    expect(payload).toBeDefined()
    expect(Buffer.from(payload!, "base64").toString("utf8")).toBe(command)
  })

  test.each(["powershell", "pwsh"])("routes %s through the Kilo argument builder", (shell) => {
    expect(Shell.args(shell, command, "/tmp")).toEqual(PowerShell.args(command))
  })
})
