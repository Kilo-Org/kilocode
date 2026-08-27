import * as fs from "node:fs"
import * as path from "node:path"
import { KILO_DIR } from "../constants"

const RUN_SCRIPT_FILENAME = "run-script"
const RUN_SCRIPT_SHELL_FILENAME = "run-script.sh"
const RUN_SCRIPT_POWERSHELL_FILENAME = "run-script.ps1"
const RUN_SCRIPT_CMD_FILENAME = "run-script.cmd"
const RUN_SCRIPT_BAT_FILENAME = "run-script.bat"

/** Only these filenames are valid run-script names. Prevents directory traversal. */
const ALLOWED = new Set([
  RUN_SCRIPT_FILENAME,
  RUN_SCRIPT_SHELL_FILENAME,
  RUN_SCRIPT_POWERSHELL_FILENAME,
  RUN_SCRIPT_CMD_FILENAME,
  RUN_SCRIPT_BAT_FILENAME,
])

const TEMPLATE = `#!/bin/sh
# Run script for Agent Manager.
# Runs in the selected worktree (or repo root for local).
# Add the commands to start your project:

# npm run dev
# bun run dev
# cargo run
# python manage.py runserver
`

const TEMPLATE_POWERSHELL = `# Run script for Agent Manager.
# Runs in the selected worktree (or repo root for local).
# Add the commands to start your project:

# npm run dev
# bun run dev
# cargo run
# python manage.py runserver
`

export type RunScriptKind = "posix" | "powershell" | "cmd"
type DefaultKind = Exclude<RunScriptKind, "cmd">

export interface RunScriptInfo {
  path: string
  kind: RunScriptKind
}

export interface RunScript extends RunScriptInfo {
  command: string
  args: string[]
}

interface Candidate {
  name: string
  kind: RunScriptKind
}

interface DefaultCandidate {
  name: string
  kind: DefaultKind
}

/**
 * Validate that a resolved script file is safe to execute:
 * - Real path must resolve to a regular file (not a directory, device, etc.)
 * - If the entry is a symlink, the resolved target must live inside the .kilo directory
 */
function validated(file: string, dir: string): boolean {
  try {
    const lstat = fs.lstatSync(file)
    if (lstat.isSymbolicLink()) {
      const real = fs.realpathSync(file)
      const expected = fs.realpathSync(dir)
      if (!real.startsWith(expected + path.sep)) return false
      const target = fs.statSync(real)
      return target.isFile()
    }
    return lstat.isFile()
  } catch {
    return false
  }
}

export function buildRunTaskCommand(script: RunScriptInfo): { command: string; args: string[] } {
  if (script.kind === "powershell") {
    return {
      command: "powershell.exe",
      args: ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script.path],
    }
  }
  if (script.kind === "cmd") {
    // Use -File semantics via cmd /c with the path as a single argument.
    // The path is double-quoted; cmd.exe treats the first and last quotes
    // as delimiters when /s is used, executing the inner string literally.
    return {
      command: "cmd.exe",
      args: ["/d", "/s", "/c", `"${script.path}"`],
    }
  }
  return {
    command: "sh",
    args: [script.path],
  }
}

export class RunScriptService {
  private readonly dir: string

  constructor(root: string) {
    this.dir = path.join(root, KILO_DIR)
  }

  resolveScript(platform: NodeJS.Platform = process.platform): RunScriptInfo | undefined {
    for (const candidate of this.candidates(platform)) {
      if (!ALLOWED.has(candidate.name)) continue
      const file = path.join(this.dir, candidate.name)
      if (!validated(file, this.dir)) continue
      return { path: file, kind: candidate.kind }
    }
    return undefined
  }

  resolveTask(platform: NodeJS.Platform = process.platform): RunScript | undefined {
    const script = this.resolveScript(platform)
    if (!script) return undefined
    const cmd = buildRunTaskCommand(script)
    return { ...script, command: cmd.command, args: cmd.args }
  }

  getScriptPath(platform: NodeJS.Platform = process.platform): string {
    return this.resolveScript(platform)?.path ?? path.join(this.dir, this.defaultCandidate(platform).name)
  }

  hasScript(platform: NodeJS.Platform = process.platform): boolean {
    return this.resolveScript(platform) !== undefined
  }

  async createDefaultScript(platform: NodeJS.Platform = process.platform): Promise<void> {
    if (!fs.existsSync(this.dir)) await fs.promises.mkdir(this.dir, { recursive: true })
    const script = this.defaultCandidate(platform)
    const file = path.join(this.dir, script.name)
    if (fs.existsSync(file)) return
    await fs.promises.writeFile(file, this.template(script.kind), { encoding: "utf-8", mode: 0o644 })
  }

  private candidates(platform: NodeJS.Platform): Candidate[] {
    if (platform === "win32") {
      return [
        { name: RUN_SCRIPT_POWERSHELL_FILENAME, kind: "powershell" },
        { name: RUN_SCRIPT_CMD_FILENAME, kind: "cmd" },
        { name: RUN_SCRIPT_BAT_FILENAME, kind: "cmd" },
      ]
    }
    return [
      { name: RUN_SCRIPT_FILENAME, kind: "posix" },
      { name: RUN_SCRIPT_SHELL_FILENAME, kind: "posix" },
    ]
  }

  private defaultCandidate(platform: NodeJS.Platform): DefaultCandidate {
    if (platform === "win32") return { name: RUN_SCRIPT_POWERSHELL_FILENAME, kind: "powershell" }
    return { name: RUN_SCRIPT_FILENAME, kind: "posix" }
  }

  private template(kind: DefaultKind): string {
    if (kind === "powershell") return TEMPLATE_POWERSHELL
    return TEMPLATE
  }
}
