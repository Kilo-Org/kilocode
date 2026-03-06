import { spawn, ChildProcess } from "child_process"
import * as crypto from "crypto"
import * as fs from "fs"
import * as path from "path"
import * as vscode from "vscode"
import { parseServerPort } from "./server-utils"

export interface ServerInstance {
  port: number
  password: string
  process: ChildProcess
}

export class ServerManager {
  private instance: ServerInstance | null = null
  private startupPromise: Promise<ServerInstance> | null = null
  private _output: vscode.OutputChannel | undefined

  private get output(): vscode.OutputChannel {
    if (!this._output) {
      this._output = vscode.window.createOutputChannel("Kilo CLI")
    }
    return this._output
  }

  constructor(private readonly context: vscode.ExtensionContext) {}

  /**
   * Get or start the server instance
   */
  async getServer(): Promise<ServerInstance> {
    console.log("[Kilo New] ServerManager: 🔍 getServer called")
    if (this.instance) {
      console.log("[Kilo New] ServerManager: ♻️ Returning existing instance:", { port: this.instance.port })
      return this.instance
    }

    if (this.startupPromise) {
      console.log("[Kilo New] ServerManager: ⏳ Startup already in progress, waiting...")
      return this.startupPromise
    }

    console.log("[Kilo New] ServerManager: 🚀 Starting new server instance...")
    this.startupPromise = this.startServer()
    try {
      this.instance = await this.startupPromise
      console.log("[Kilo New] ServerManager: ✅ Server started successfully:", { port: this.instance.port })
      return this.instance
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error)
      const summary = (raw.length > 200 ? `${raw.slice(0, 200)}…` : raw).replace(/\n/g, " ")
      this.output.appendLine(`[ERROR] CLI failed to start: ${raw}`)
      void Promise.resolve(vscode.window.showErrorMessage(`Kilo: CLI failed to start. ${summary}`, "Show Output"))
        .then((action) => {
          if (action === "Show Output") {
            this.output.show()
          }
        })
        .catch((e: unknown) => console.error("[Kilo New] ServerManager: showErrorMessage failed:", e))
      throw error
    } finally {
      this.startupPromise = null
    }
  }

  private async startServer(): Promise<ServerInstance> {
    const password = crypto.randomBytes(32).toString("hex")
    const cliPath = this.getCliPath()
    console.log("[Kilo New] ServerManager: 📍 CLI path:", cliPath)
    console.log("[Kilo New] ServerManager: 🔐 Generated password (length):", password.length)

    // Verify the CLI binary exists
    if (!fs.existsSync(cliPath)) {
      throw new Error(
        `CLI binary not found at expected path: ${cliPath}. Please ensure the CLI is built and bundled with the extension.`,
      )
    }

    const stat = fs.statSync(cliPath)
    console.log("[Kilo New] ServerManager: 📄 CLI isFile:", stat.isFile())
    console.log("[Kilo New] ServerManager: 📄 CLI mode (octal):", (stat.mode & 0o777).toString(8))

    return new Promise((resolve, reject) => {
      console.log("[Kilo New] ServerManager: 🎬 Spawning CLI process:", cliPath, ["serve", "--port", "0"])
      const serverProcess = spawn(cliPath, ["serve", "--port", "0"], {
        env: {
          ...process.env,
          KILO_SERVER_PASSWORD: password,
          KILO_CLIENT: "vscode",
          KILO_ENABLE_QUESTION_TOOL: "true",
          KILOCODE_FEATURE: "vscode-extension",
          KILO_TELEMETRY_LEVEL: vscode.env.isTelemetryEnabled ? "all" : "off",
          KILO_APP_NAME: "kilo-code",
          KILO_EDITOR_NAME: vscode.env.appName,
          KILO_PLATFORM: "vscode",
          KILO_MACHINE_ID: vscode.env.machineId,
          KILO_APP_VERSION: this.context.extension.packageJSON.version,
          KILO_VSCODE_VERSION: vscode.version,
        },
        stdio: ["ignore", "pipe", "pipe"],
      })
      console.log("[Kilo New] ServerManager: 📦 Process spawned with PID:", serverProcess.pid)

      let resolved = false
      const errors: string[] = []
      let stderrChars = 0
      const MAX_STDERR_CHARS = 65536

      serverProcess.stdout?.on("data", (data: Buffer) => {
        const output = data.toString()
        console.log("[Kilo New] ServerManager: 📥 CLI Server stdout:", output)
        this.output.append(output)

        const port = parseServerPort(output)
        if (port !== null && !resolved) {
          resolved = true
          console.log("[Kilo New] ServerManager: 🎯 Port detected:", port)
          resolve({ port, password, process: serverProcess })
        }
      })

      serverProcess.stderr?.on("data", (data: Buffer) => {
        const errorOutput = data.toString()
        console.error("[Kilo New] ServerManager: ⚠️ CLI Server stderr:", errorOutput)
        if (stderrChars < MAX_STDERR_CHARS) {
          errors.push(errorOutput)
          stderrChars += errorOutput.length
        }
        this.output.append(`[stderr] ${errorOutput}`)
      })

      serverProcess.on("error", (error) => {
        console.error("[Kilo New] ServerManager: ❌ Process error:", error)
        if (!resolved) {
          resolved = true
          reject(error)
        }
      })

      serverProcess.on("exit", (code) => {
        console.log("[Kilo New] ServerManager: 🛑 Process exited with code:", code)
        if (this.instance?.process === serverProcess) {
          this.instance = null
        }
        if (!resolved) {
          resolved = true
          const stderr = errors.join("").trim()
          const detail = stderr ? `\n${stderr}` : ""
          reject(new Error(`CLI process exited with code ${code} before server started${detail}`))
        }
      })

      // Timeout after 30 seconds
      setTimeout(() => {
        if (!resolved) {
          resolved = true
          console.error("[Kilo New] ServerManager: ⏰ Server startup timeout (30s)")
          serverProcess.kill()
          const stderr = errors.join("").trim()
          const detail = stderr ? `\n${stderr}` : ""
          reject(new Error(`Server startup timeout${detail}`))
        }
      }, 30000)
    })
  }

  private getCliPath(): string {
    // Always use the bundled binary from the extension directory
    const binName = process.platform === "win32" ? "kilo.exe" : "kilo"
    const cliPath = path.join(this.context.extensionPath, "bin", binName)
    console.log("[Kilo New] ServerManager: 📦 Using CLI path:", cliPath)
    return cliPath
  }

  dispose(): void {
    if (this.instance) {
      this.instance.process.kill("SIGTERM")
      this.instance = null
    }
    this._output?.dispose()
    this._output = undefined
  }
}
