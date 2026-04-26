import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import type * as vscode from "vscode"

type Disposable = { dispose(): unknown }
type Secrets = Pick<vscode.SecretStorage, "get" | "store" | "delete">
type AuthMirrorContext = {
  readonly secrets: Secrets
}

type WatchAuthFile = (onChange: () => void, onDelete: () => void) => Disposable

type AuthMirrorOptions = {
  debounceMs?: number
  watchAuthFile?: WatchAuthFile
}

const DEFAULT_DEBOUNCE_MS = 500

export function getAuthJsonPath(env: NodeJS.ProcessEnv = process.env, home = os.homedir()): string {
  const dataHome = (env.XDG_DATA_HOME || path.join(home, ".local", "share")).trim()
  return path.join(dataHome, "kilo", "auth.json")
}

async function readNonEmptyFile(filePath: string): Promise<string | undefined> {
  const content = await fs.readFile(filePath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined
    throw error
  })
  if (content === undefined) return undefined
  return content.trim() === "" ? undefined : content
}

function createDefaultWatcher(authFilePath: string, onChange: () => void, onDelete: () => void): Disposable {
  const vscodeApi = require("vscode") as typeof vscode
  const pattern = new vscodeApi.RelativePattern(path.dirname(authFilePath), path.basename(authFilePath))
  const watcher = vscodeApi.workspace.createFileSystemWatcher(pattern)
  const disposables = [
    watcher,
    watcher.onDidCreate(onChange),
    watcher.onDidChange(onChange),
    watcher.onDidDelete(onDelete),
  ]
  return {
    dispose() {
      for (const disposable of disposables) disposable.dispose()
    },
  }
}

export class AuthMirrorService {
  static readonly SECRET_KEY = "kilo.auth.v1"

  private readonly debounceMs: number
  private readonly watchAuthFile?: WatchAuthFile

  constructor(
    private readonly context: AuthMirrorContext,
    private readonly authFilePath: string,
    options: AuthMirrorOptions = {},
  ) {
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS
    this.watchAuthFile = options.watchAuthFile
  }

  // Return value MUST NOT be forwarded to a webview. Webview gets booleans / sanitized profile only.
  async readSecret(): Promise<string | undefined> {
    const content = await this.context.secrets.get(AuthMirrorService.SECRET_KEY)
    return content && content.trim() !== "" ? content : undefined
  }

  async writeSecret(content: string): Promise<void> {
    if (content.trim() === "") {
      await this.deleteSecret()
      return
    }
    await this.context.secrets.store(AuthMirrorService.SECRET_KEY, content)
  }

  async deleteSecret(): Promise<void> {
    await this.context.secrets.delete(AuthMirrorService.SECRET_KEY)
  }

  async migrateFileToSecretIfNeeded(): Promise<void> {
    if (await this.readSecret()) return

    const content = await readNonEmptyFile(this.authFilePath)
    if (!content) return
    await this.writeSecret(content)
  }

  async seedFileFromSecretIfNeeded(): Promise<void> {
    if (await readNonEmptyFile(this.authFilePath)) return

    const content = await this.readSecret()
    if (!content) return

    await fs.mkdir(path.dirname(this.authFilePath), { recursive: true })
    await fs.writeFile(this.authFilePath, content, { encoding: "utf8", mode: 0o600 })
  }

  async getCliEnvSeed(): Promise<NodeJS.ProcessEnv> {
    if (await readNonEmptyFile(this.authFilePath)) return {}

    const content = await this.readSecret()
    return content ? { KILO_AUTH_CONTENT: content } : {}
  }

  startFileWatcher(): vscode.Disposable {
    let timer: ReturnType<typeof setTimeout> | undefined

    const scheduleSync = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = undefined
        void this.syncFileToSecret()
      }, this.debounceMs)
    }

    const watcher = (
      this.watchAuthFile ?? ((onChange, onDelete) => createDefaultWatcher(this.authFilePath, onChange, onDelete))
    )(scheduleSync, () => {
      if (timer) {
        clearTimeout(timer)
        timer = undefined
      }
      void this.deleteSecret()
    })

    return {
      dispose() {
        if (timer) clearTimeout(timer)
        watcher.dispose()
      },
    } as vscode.Disposable
  }

  private async syncFileToSecret(): Promise<void> {
    let content: string
    try {
      content = await fs.readFile(this.authFilePath, "utf8")
    } catch (error) {
      console.warn("[Kilo New] AuthMirrorService: failed to read auth.json for SecretStorage sync:", error)
      return
    }

    if (content.trim() === "") {
      await this.deleteSecret()
      return
    }

    await this.writeSecret(content)
  }
}
