import { homedir } from "node:os"
import { join } from "node:path"

export namespace Conda {
  export async function clientToken(): Promise<string | undefined> {
    try {
      // Avoid starting conda (or creating an AAU token) for users who have never used it.
      const home = (process.platform === "win32" ? process.env.USERPROFILE : process.env.HOME) || homedir()
      if (!(await Bun.file(join(home, ".conda", "aau_token")).exists())) return undefined

      // JSON retains the actual user agent; the human-readable `conda info` output redacts it.
      // Reading conda's effective user agent also respects `anaconda_anon_usage: false`.
      const proc = Bun.spawn([process.env.CONDA_EXE || "conda", "info", "--json", "--offline"], {
        stdout: "pipe",
        stderr: "ignore",
        windowsHide: true,
      })
      const reader = proc.stdout.getReader()
      const timer = setTimeout(() => {
        proc.kill()
        void reader.cancel().catch(() => undefined)
      }, 2000)
      try {
        const chunks: Uint8Array[] = []
        let size = 0
        while (true) {
          const part = await reader.read()
          if (part.done) break
          size += part.value.byteLength
          if (size > 262_144) {
            proc.kill()
            await reader.cancel()
            return undefined
          }
          chunks.push(part.value)
        }
        if ((await proc.exited) !== 0) return undefined
        const info: unknown = JSON.parse(Buffer.concat(chunks).toString())
        if (!info || typeof info !== "object" || !("user_agent" in info)) return undefined
        if (typeof info.user_agent !== "string") return undefined
        return /(?:^|\s)c\/([A-Za-z0-9_-]{22})(?=\s|$)/.exec(info.user_agent)?.[1]
      } finally {
        clearTimeout(timer)
        if (proc.exitCode === null) proc.kill()
        reader.releaseLock()
      }
    } catch {
      // Conda is optional; missing or broken installations simply have no join key.
      return undefined
    }
  }
}
