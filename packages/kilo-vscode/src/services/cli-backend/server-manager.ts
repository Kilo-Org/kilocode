import type { ExtensionContext } from "vscode"
import { workspace } from "vscode"
import type { OpenCodeClient } from "@opencode-ai/client/promise"
import { startLocalServer } from "../../local-server"

export type ServerInstance = { port: number; password: string; client: OpenCodeClient }

/** All original Kilo panels share the elected v2 daemon; closing a panel does not stop it. */
export class ServerManager {
  private startup?: Promise<ServerInstance>
  private readonly controller = new AbortController()

  constructor(private readonly context: ExtensionContext) {}

  getServer(): Promise<ServerInstance> {
    if (this.startup) return this.startup
    this.startup = startLocalServer({
      extensionRoot: this.context.extensionUri.fsPath,
      cliPath: workspace.getConfiguration("kilo2").get<string>("cliPath"),
      directory: workspace.workspaceFolders?.[0]?.uri.fsPath ?? this.context.globalStorageUri.fsPath,
      signal: this.controller.signal,
    }).then((server) => ({ port: Number(new URL(server.url).port), password: server.password, client: server.client })).catch((error: unknown) => {
      this.startup = undefined
      throw error
    })
    return this.startup
  }

  dispose() {
    this.controller.abort()
    this.startup = undefined
  }
}

export class ServerStartupError extends Error {
  constructor(readonly userMessage: string, readonly userDetails: string) {
    super(userDetails)
    this.name = "ServerStartupError"
  }
}
