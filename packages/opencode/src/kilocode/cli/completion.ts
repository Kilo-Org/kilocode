import * as Log from "@opencode-ai/core/util/log"

export namespace KiloCompletion {
  const log = Log.create({ service: "kilocode.cli.completion" })

  /**
   * PowerShell hosts export `PSModulePath` to their children (and a pwsh login
   * shell sets `SHELL`), while cmd.exe and Git Bash do not. yargs' built-in
   * `.completion()` only emits bash/zsh/fish scripts, so those hosts need the
   * PowerShell-native script instead.
   */
  export function powerShell(): boolean {
    if (process.env.PSModulePath !== undefined) return true
    return Boolean(process.env["SHELL"]?.includes("pwsh"))
  }

  /**
   * Mirrors the yargs bash script contract: pass every word of the current
   * line (including a trailing empty word, like bash's COMP_WORDS) to
   * `kilo --get-yargs-completions`, then filter its `token:description` lines
   * by the word under the cursor.
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
Register-ArgumentCompleter -CommandName kilo -ScriptBlock {
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
        Where-Object { $_ -like "$wordToComplete*" }

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
