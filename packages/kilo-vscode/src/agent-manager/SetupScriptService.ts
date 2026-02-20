/**
 * SetupScriptService - Manages worktree setup scripts
 *
 * Handles reading, creating, and checking for setup scripts stored in .kilocode/setup-script.
 * Setup scripts run before an agent starts in a worktree (new sessions only).
 */

import * as vscode from "vscode"
import * as fs from "node:fs"
import * as path from "node:path"
import { SETUP_SCRIPT_TEMPLATE } from "./setup-script-template"

const SETUP_SCRIPT_FILENAME = "setup-script"
const KILOCODE_DIR = ".kilocode"

export class SetupScriptService {
  private readonly root: string
  private readonly script: string

  constructor(root: string) {
    this.root = root
    this.script = path.join(root, KILOCODE_DIR, SETUP_SCRIPT_FILENAME)
  }

  /** Get the path to the setup script */
  getScriptPath(): string {
    return this.script
  }

  /** Check if a setup script exists */
  hasScript(): boolean {
    return fs.existsSync(this.script)
  }

  /** Read the setup script content. Returns null if not found or read fails. */
  async getScript(): Promise<string | null> {
    if (!this.hasScript()) return null
    try {
      return await fs.promises.readFile(this.script, "utf-8")
    } catch (error) {
      this.log(`Failed to read setup script: ${error}`)
      return null
    }
  }

  /** Create a default setup script with helpful comments */
  async createDefaultScript(): Promise<void> {
    const dir = path.join(this.root, KILOCODE_DIR)
    if (!fs.existsSync(dir)) {
      await fs.promises.mkdir(dir, { recursive: true })
    }
    await fs.promises.writeFile(this.script, SETUP_SCRIPT_TEMPLATE, "utf-8")
  }

  /** Open the setup script in VS Code editor. Creates the default script if it doesn't exist. */
  async openInEditor(): Promise<void> {
    if (!this.hasScript()) {
      await this.createDefaultScript()
    }
    const document = await vscode.workspace.openTextDocument(this.script)
    await vscode.window.showTextDocument(document)
  }

  private log(message: string): void {
    // Log to console since we don't have an OutputChannel here
    console.log(`[SetupScriptService] ${message}`)
  }
}
