import fs from "fs"
import os from "os"
import path from "path"

export namespace KiloCliSmoke {
  export async function pty(binary: string) {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "kilo-pty-"))
    const env = { ...process.env }
    delete env.KILO_MODELS_PATH
    delete env.KILO_MODELS_URL
    delete env.KILO_CONFIG
    delete env.KILO_CONFIG_DIR

    try {
      const proc = Bun.spawn([binary, "--pure", "__pty-smoke"], {
        env: {
          ...env,
          HOME: root,
          XDG_DATA_HOME: path.join(root, "data"),
          XDG_CACHE_HOME: path.join(root, "cache"),
          XDG_CONFIG_HOME: path.join(root, "config"),
          XDG_STATE_HOME: path.join(root, "state"),
          KILO_PTY_SMOKE: "1",
          KILO_NO_DAEMON: "1",
          KILO_DISABLE_MODELS_FETCH: "1",
          KILO_DISABLE_PROJECT_CONFIG: "1",
          KILO_CONFIG_CONTENT: "{}",
          KILO_AUTH_CONTENT: "{}",
        },
        stdout: "inherit",
        stderr: "inherit",
        windowsHide: true,
      })
      const code = await proc.exited
      if (code !== 0) throw new Error(`Compiled TUI smoke test exited with code ${code}`)
    } finally {
      await fs.promises.rm(root, { recursive: true, force: true })
    }
  }
}
