import * as Log from "@opencode-ai/core/util/log"

export namespace KiloCompletion {
  const log = Log.create({ service: "kilocode.cli.completion" })

  /**
   * PowerShell hosts export `PSModulePath` to their children (and a pwsh login
   * shell sets `SHELL`), but on Windows the machine-wide legacy value is
   * inherited by cmd.exe and Git Bash too. Only pwsh-specific entries — module
   * directories outside the system32 `WindowsPowerShell` tree — indicate an
   * actual PowerShell parent; legacy Windows PowerShell 5.1 keeps the yargs
   * path, since its module list is the machine default itself.
   */
  export function powerShell(): boolean {
    if (process.env["SHELL"]?.includes("pwsh")) return true
    const modules = process.env["PSModulePath"]?.split(";") ?? []
    return modules.some(
      (entry) =>
        /powershell/i.test(entry) && !/[\\/]Windows[\\/]system32/i.test(entry) && !/windowspowershell/i.test(entry),
    )
  }

  /**
   * Mirrors the yargs bash script contract: pass every word of the current
   * line (including a trailing empty word, like bash's COMP_WORDS) to
   * `kilo --get-yargs-completions`, then filter its `token:description` lines
   * by the word under the cursor. Prefix filtering is case-sensitive and
   * literal, like bash's compgen; `-Native` is what makes the completer run
   * for an external command at all.
   */
  export function script(): string {
    return `#compdef kilo
###-begin-kilo-completions-###
#
# yargs command completion script for PowerShell
#
# Installation: kilo completion >> $PROFILE
#    (or: kilo completion | Add-Content $PROFILE -Encoding UTF8)
#
Register-ArgumentCompleter -CommandName kilo -Native -ScriptBlock {
    param($wordToComplete, $commandAst, $cursorPosition)

    $raw = $commandAst.ToString()
    $words = @($raw -split ' +' | Where-Object { $_ -ne '' })
    if ($raw -match '\\s$') { $words += '' }
    if ($words.Count -eq 0) { return }

    # ask yargs to generate completions.
    $reply = @(kilo --get-yargs-completions @words 2>$null)
    if ($LASTEXITCODE -ne 0) { return }

    $reply |
        Select-Object -Unique |
        ForEach-Object { $_.TrimEnd() } |
        Where-Object { $_.StartsWith($wordToComplete, [System.StringComparison]::Ordinal) }

    return
}
###-end-kilo-completions-###
`
  }

  /** Serve the PowerShell script for `kilo completion` when running under PowerShell. */
  export function intercept(args: string[]): boolean {
    if (args[0] !== "completion") return false
    if (!powerShell()) return false
    log.debug("emitting PowerShell completion script")
    process.stdout.write(script())
    process.exit(0)
  }
}
