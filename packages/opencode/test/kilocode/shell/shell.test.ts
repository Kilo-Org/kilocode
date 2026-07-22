import { describe, expect, test } from "bun:test"
import * as PowerShell from "@/kilocode/shell/shell"
import { Shell } from "@opencode-ai/core/shell"

const command = `Write-Output "こんにちは 😀"; Write-Output '$value'; Write-Output \`tick\`
Write-Output "done"`

describe("PowerShell arguments", () => {
  test("transports commands in plaintext with UTF-8 console setup", () => {
    const args = PowerShell.args(command)
    const value = args[4]

    expect(args.slice(0, 4)).toEqual(["-NoLogo", "-NoProfile", "-NonInteractive", "-Command"])
    expect(args).toHaveLength(5)
    expect(value).toContain("[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)")
    expect(value).toContain("[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)")
    expect(value).toContain("$OutputEncoding = [Console]::OutputEncoding")
    expect(value).toContain(command)
    expect(args).not.toContain("-EncodedCommand")
    expect(value).not.toContain("FromBase64String")
  })

  test.each(["powershell", "pwsh"])("routes %s through the Kilo argument builder", (shell) => {
    expect(Shell.args(shell, command, "/tmp")).toEqual(PowerShell.args(command))
  })

  test("keeps script-level prologue before the UTF-8 console setup", () => {
    const input = `#requires -Version 5.1
using namespace System.Text
<#
Block comment before attributes.
#>
[CmdletBinding()]
[OutputType([string])]
param(
  [string]$Name
)
Write-Output $Name`
    const value = PowerShell.args(input)[4]
    const setup = value.indexOf("[Console]::InputEncoding")

    expect(value.startsWith("#requires -Version 5.1")).toBe(true)
    expect(value.slice(0, setup)).toContain("[CmdletBinding()]")
    expect(value.slice(0, setup)).toContain("[OutputType([string])]")
    expect(value.slice(0, setup)).toContain("param(")
    expect(setup).toBeLessThan(value.indexOf("Write-Output"))
  })
})
