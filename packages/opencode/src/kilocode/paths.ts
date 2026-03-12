import * as path from "path"
import os from "os"
import { Filesystem } from "../util/filesystem"

export namespace KilocodePaths {
  const home = () => process.env.HOME || process.env.USERPROFILE || os.homedir()

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

  /** Global Kilo directories in user home: ~/.kilocode and ~/.kilo (legacy first, .kilo wins later) */
  export function globalDirs(): string[] {
    return [path.join(home(), ".kilocode"), path.join(home(), ".kilo")]
  }

  /**
   * Discover Kilo directories containing skills.
   * Returns parent directories (.kilocode/ and .kilo/) for glob pattern "skills/[*]/SKILL.md".
   *
   * - Walks up from projectDir to worktreeRoot for .kilocode/ and .kilo/
   * - Includes global ~/.kilocode/ and ~/.kilo/
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

    // 1. Walk up from project dir to worktree root for .kilocode/ and .kilo/
    // Returns parent directories (not skills/) because
    // the glob pattern "skills/[*]/SKILL.md" is applied from the parent
    for (const target of [".kilocode", ".kilo"] as const) {
      const projectDirs = await Array.fromAsync(
        Filesystem.up({
          targets: [target],
          start: opts.projectDir,
          stop: opts.worktreeRoot,
        }),
      )
      for (const dir of projectDirs) {
        const skillsDir = path.join(dir, "skills")
        if ((await Filesystem.isDir(skillsDir)) && !directories.includes(dir)) {
          directories.push(dir)
        }
      }
    }

    if (!opts.skipGlobalPaths) {
      // 2. Global ~/.kilocode/ and ~/.kilo/
      for (const global of globalDirs()) {
        const globalSkills = path.join(global, "skills")
        if (!(await Filesystem.isDir(globalSkills))) continue
        directories.push(global) // Return parent, not skills/
      }

      // 3. VSCode extension global storage (marketplace-installed skills)
      const vscode = vscodeGlobalStorage()
      const vscodeSkills = path.join(vscode, "skills")
      if (await Filesystem.isDir(vscodeSkills)) {
        directories.push(vscode) // Return parent, not skills/
      }
    }

    return directories
  }
}
