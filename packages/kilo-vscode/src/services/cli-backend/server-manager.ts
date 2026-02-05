import { spawn, ChildProcess } from "child_process";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

export interface ServerInstance {
  port: number
  password: string
  process: ChildProcess
}

export class ServerManager {
  private instance: ServerInstance | null = null;
  private startupPromise: Promise<ServerInstance> | null = null;

  constructor(private readonly context: vscode.ExtensionContext) {}

  /**
   * Get or start the server instance
   */
  async getServer(): Promise<ServerInstance> {
    console.log('[Kilo New] ServerManager: 🔍 getServer called');
    if (this.instance) {
      console.log('[Kilo New] ServerManager: ♻️ Returning existing instance:', { port: this.instance.port });
      return this.instance;
    }

    if (this.startupPromise) {
      console.log('[Kilo New] ServerManager: ⏳ Startup already in progress, waiting...');
      return this.startupPromise;
    }

    console.log('[Kilo New] ServerManager: 🚀 Starting new server instance...');
    this.startupPromise = this.startServer();
    try {
      this.instance = await this.startupPromise;
      console.log('[Kilo New] ServerManager: ✅ Server started successfully:', { port: this.instance.port });
      return this.instance;
    } finally {
      this.startupPromise = null;
    }
  }

  private async startServer(): Promise<ServerInstance> {
    const password = crypto.randomBytes(32).toString("hex");
    const cliPath = this.getCliPath();
    console.log('[Kilo New] ServerManager: 📍 CLI path:', cliPath);
    console.log('[Kilo New] ServerManager: 🔐 Generated password (length):', password.length);

    // Verify the CLI binary exists
    if (!fs.existsSync(cliPath)) {
      throw new Error(`CLI binary not found at expected path: ${cliPath}. Please ensure the CLI is built and bundled with the extension.`);
    }

    const stat = fs.statSync(cliPath);
    console.log('[Kilo New] ServerManager: 📄 CLI isFile:', stat.isFile());
    console.log('[Kilo New] ServerManager: 📄 CLI mode (octal):', (stat.mode & 0o777).toString(8));

    return new Promise((resolve, reject) => {
      console.log('[Kilo New] ServerManager: 🎬 Spawning CLI process:', cliPath, ['serve', '--port', '0']);
      const serverProcess = spawn(cliPath, ["serve", "--port", "0"], {
        env: {
          ...process.env,
          OPENCODE_SERVER_PASSWORD: password,
          OPENCODE_CLIENT: "vscode",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      console.log('[Kilo New] ServerManager: 📦 Process spawned with PID:', serverProcess.pid);

      let resolved = false;

      serverProcess.stdout?.on("data", (data: Buffer) => {
        const output = data.toString();
        console.log("[Kilo New] ServerManager: 📥 CLI Server stdout:", output);

        // Parse: "kilo server listening on http://127.0.0.1:12345"
        const match = output.match(/listening on http:\/\/[\w.]+:(\d+)/);
        if (match && !resolved) {
          resolved = true;
          const port = parseInt(match[1], 10);
          console.log('[Kilo New] ServerManager: 🎯 Port detected:', port);
          resolve({ port, password, process: serverProcess });
        }
      });

      serverProcess.stderr?.on("data", (data: Buffer) => {
        const errorOutput = data.toString();
        console.error("[Kilo New] ServerManager: ⚠️ CLI Server stderr:", errorOutput);
      });

      serverProcess.on("error", (error) => {
        console.error('[Kilo New] ServerManager: ❌ Process error:', error);
        if (!resolved) {
          reject(error);
        }
      });

      serverProcess.on("exit", (code) => {
        console.log("[Kilo New] ServerManager: 🛑 Process exited with code:", code);
        if (this.instance?.process === serverProcess) {
          this.instance = null;
        }
        if (!resolved) {
          reject(new Error(`CLI process exited with code ${code} before server started`));
        }
      });

      // Timeout after 30 seconds
      setTimeout(() => {
        if (!resolved) {
          console.error('[Kilo New] ServerManager: ⏰ Server startup timeout (30s)');
          serverProcess.kill();
          reject(new Error("Server startup timeout"));
        }
      }, 30000);
    });
  }

  private getCliPath(): string {
    // Always use the bundled binary from the extension directory
    const cliPath = path.join(this.context.extensionPath, "bin", "kilo");
    console.log('[Kilo New] ServerManager: 📦 Using CLI path:', cliPath);
    return cliPath;
  }

  dispose(): void {
    if (this.instance) {
      this.instance.process.kill("SIGTERM");
      this.instance = null;
    }
  }
}
