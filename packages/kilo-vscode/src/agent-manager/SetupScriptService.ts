/**
 * SetupScriptService - Manages worktree setup scripts
 *
 * Handles reading, creating, and checking for setup scripts stored in .kilo/.
 * Setup scripts run before an agent starts in a worktree (new sessions only).
 */

import * as fs from "node:fs"
import * as path from "node:path"
import { SETUP_SCRIPT_TEMPLATE, SETUP_SCRIPT_TEMPLATE_POWERSHELL } from "./setup-script-template"
import { KILO_DIR } from "./constants"

const SETUP_SCRIPT_FILENAME = "setup-script"
const SETUP_SCRIPT_SHELL_FILENAME = "setup-script.sh"
const SETUP_SCRIPT_POWERSHELL_FILENAME = "setup-script.ps1"
const SETUP_SCRIPT_CMD_FILENAME = "setup-script.cmd"
const SETUP_SCRIPT_BAT_FILENAME = "setup-script.bat"

export type SetupScriptKind = "posix" | "powershell" | "cmd"
type SetupScriptDefaultKind = Exclude<SetupScriptKind, "cmd">

export interface SetupScriptInfo {
  path: string
  kind: SetupScriptKind
}

interface SetupScriptCandidate {
  name: string
  kind: SetupScriptKind
}

interface SetupScriptDefaultCandidate {
  name: string
  kind: SetupScriptDefaultKind
}

export class SetupScriptService {
  private readonly dir: string

  constructor(root: string) {
    this.dir = path.join(root, KILO_DIR)
  }

  /** Resolve the setup script path and interpreter type for the current platform. */
  resolveScript(platform: NodeJS.Platform = process.platform): SetupScriptInfo | undefined {
    for (const candidate of this.candidates(platform)) {
      const scriptPath = path.join(this.dir, candidate.name)
      if (!fs.existsSync(scriptPath)) continue
      return {
        path: scriptPath,
        kind: candidate.kind,
      }
    }
    return undefined
  }

  /** Get the script path if configured, otherwise return the default path for this platform. */
  getScriptPath(platform: NodeJS.Platform = process.platform): string {
    const resolved = this.resolveScript(platform)
    if (resolved) return resolved.path
    return path.join(this.dir, this.defaultCandidate(platform).name)
  }

  /** Check if a setup script exists */
  hasScript(platform: NodeJS.Platform = process.platform): boolean {
    return this.resolveScript(platform) !== undefined
  }

  /** Read the setup script content. Returns null if not found or read fails. */
  async getScript(platform: NodeJS.Platform = process.platform): Promise<string | null> {
    const script = this.resolveScript(platform)
    if (!script) return null
    try {
      return await fs.promises.readFile(script.path, "utf-8")
    } catch (error) {
      this.log(`Failed to read setup script: ${error}`)
      return null
    }
  }

  /** Create a default setup script with helpful comments for the current platform. */
  async createDefaultScript(platform: NodeJS.Platform = process.platform): Promise<void> {
    if (!fs.existsSync(this.dir)) {
      await fs.promises.mkdir(this.dir, { recursive: true })
    }
    const script = this.defaultCandidate(platform)
    const scriptPath = path.join(this.dir, script.name)
    const content = this.defaultTemplate(script.kind)
    await fs.promises.writeFile(scriptPath, content, "utf-8")
  }

  private candidates(platform: NodeJS.Platform): SetupScriptCandidate[] {
    if (platform === "win32") {
      return [
        { name: SETUP_SCRIPT_POWERSHELL_FILENAME, kind: "powershell" },
        { name: SETUP_SCRIPT_CMD_FILENAME, kind: "cmd" },
        { name: SETUP_SCRIPT_BAT_FILENAME, kind: "cmd" },
      ]
    }
    return [
      { name: SETUP_SCRIPT_FILENAME, kind: "posix" },
      { name: SETUP_SCRIPT_SHELL_FILENAME, kind: "posix" },
    ]
  }

  private defaultCandidate(platform: NodeJS.Platform): SetupScriptDefaultCandidate {
    if (platform === "win32") {
      return { name: SETUP_SCRIPT_POWERSHELL_FILENAME, kind: "powershell" }
    }
    return { name: SETUP_SCRIPT_FILENAME, kind: "posix" }
  }

  private defaultTemplate(kind: SetupScriptDefaultKind): string {
    if (kind === "powershell") return SETUP_SCRIPT_TEMPLATE_POWERSHELL
    return SETUP_SCRIPT_TEMPLATE
  }

  private log(message: string): void {
    // Log to console since we don't have an OutputChannel here
    console.log(`[SetupScriptService] ${message}`)
  }
}
