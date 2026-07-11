import { Flag } from "@/flag/flag"
import { Filesystem } from "@/util/filesystem"
import { which } from "@/util/which"
import path from "path"

export type ShellRoute = "ps" | "cmd" | "bash"

const bash = () => {
  if (Flag.KILO_GIT_BASH_PATH) return Flag.KILO_GIT_BASH_PATH
  const hit = which("bash")
  if (hit) return hit
  if (process.platform === "win32") {
    const git = which("git")
    if (git) {
      const next = path.join(git, "..", "..", "bin", "bash.exe")
      if (Filesystem.stat(next)?.size) return next
    }
  }
  return "bash"
}

export const peel = (command: string): { route?: ShellRoute; command: string } => {
  const next = command.match(/^(ps|cmd|bash):\s*/)
  if (!next) return { command }
  return {
    route: next[1] as ShellRoute,
    command: command.slice(next[0].length),
  }
}

export const resolve = (route: ShellRoute) => {
  if (route === "ps") return { bin: which("pwsh") || "pwsh", args: ["-NoProfile", "-Command"] }
  if (route === "cmd") return { bin: process.env.COMSPEC || "cmd.exe", args: ["/d", "/s", "/c"] }
  return { bin: bash(), args: ["-lc"] }
}
