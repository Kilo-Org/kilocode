import * as path from "path"
import os from "os"
import { Filesystem } from "../util/filesystem"

export namespace KilocodePaths {
  /**
   * Get the platform-specific VSCode global storage path for Kilocode extension.
   * - macOS: ~/Library/Application Support/Code/User/globalStorage/kilocode.kilo-code
   * - Windows: %APPDATA%/Code/User/globalStorage/kilocode.kilo-code
   * - Linux: ~/.config/Code/User/globalStorage/kilocode.kilo-code
   */
  export function vscodeGlobalStorage(): string {
    const home = os.homedir()
    switch (process.platform) {
      case "darwin":
        return path.join(home, "Library", "Application Support", "Code", "User", "globalStorage", "kilocode.kilo-code")
      case "win32":
        return path.join(
          process.env.APPDATA || path.join(home, "AppData", "Roaming"),
          "Code",
          "User",
          "globalStorage",
          "kilocode.kilo-code",
        )
      default:
        return path.join(home, ".config", "Code", "User", "globalStorage", "kilocode.kilo-code")
    }
  }

  /** Global Kilocode directory in user home: ~/.kilocode */
  export function globalDir(): string {
    return path.join(os.homedir(), ".kilocode")
  }

  /**
   * Discover Kilocode directories containing skills.
   * Returns parent directories (.kilocode/) for glob pattern "skills/[*]/SKILL.md".
   *
   * - Walks up from projectDir to worktreeRoot for .kilocode/
   * - Includes global ~/.kilocode/
   * - Includes VSCode extension global storage
   *
   * Does NOT copy/migrate skills - just provides paths for discovery.
   * Skills remain in their original locations and can be managed independently
   * by the Kilo VSCode extension.
   */
  export async function skillDirectories(opts: {
    projectDir: string
    worktreeRoot: string
    skipGlobalPaths?: boolean
  }): Promise<string[]> {
    const directories: string[] = []

    // 1. Walk up from project dir to worktree root for .kilocode/
    // Returns .kilocode/ directories (not .kilocode/skills/) because
    // the glob pattern "skills/[*]/SKILL.md" is applied from the parent
    const projectDirs = await Array.fromAsync(
      Filesystem.up({
        targets: [".kilocode"],
        start: opts.projectDir,
        stop: opts.worktreeRoot,
      }),
    )
    for (const dir of projectDirs) {
      const skillsDir = Filesystem.join(dir, "skills")
      if (await Filesystem.isDir(skillsDir)) {
        directories.push(dir) // Return parent (.kilocode/), not skills/
      }
    }

    if (!opts.skipGlobalPaths) {
      // 2. Global ~/.kilocode/
      const global = globalDir()
      const globalSkills = Filesystem.join(global, "skills")
      if (await Filesystem.isDir(globalSkills)) {
        directories.push(global) // Return parent, not skills/
      }

      // 3. VSCode extension global storage (marketplace-installed skills)
      const vscode = vscodeGlobalStorage()
      const vscodeSkills = Filesystem.join(vscode, "skills")
      if (await Filesystem.isDir(vscodeSkills)) {
        directories.push(vscode) // Return parent, not skills/
      }
    }

    return directories
  }
}
