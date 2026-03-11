import { spawn, type SpawnOptions } from "node:child_process"
import { type Config } from "./gen/types.gen.js"

// kilocode_change start - Merge existing KILO_CONFIG_CONTENT with new config
// This preserves Kilocode-injected modes when spawning nested CLI instances
function mergeConfig(existing: Config | undefined, incoming: Config | undefined): Config {
  const base = existing ?? {}
  const override = incoming ?? {}
  return {
    ...base,
    ...override,
    agent: { ...base.agent, ...override.agent },
    command: { ...base.command, ...override.command },
    mcp: { ...base.mcp, ...override.mcp },
    mode: { ...base.mode, ...override.mode },
    plugin: [...(base.plugin ?? []), ...(override.plugin ?? [])],
    instructions: [...(base.instructions ?? []), ...(override.instructions ?? [])],
  }
}

function parseExistingConfig(): Config | undefined {
  const content = process.env.KILO_CONFIG_CONTENT
  if (!content) return undefined
  try {
    return JSON.parse(content)
  } catch {
    return undefined
  }
}

export function buildConfigEnv(config?: Config): string {
  const merged = mergeConfig(parseExistingConfig(), config)
  return JSON.stringify(merged)
}
// kilocode_change end

export type ServerOptions = {
  hostname?: string
  port?: number
  signal?: AbortSignal
  timeout?: number
  config?: Config
  /** Path to the CLI binary. Defaults to "kilo" (resolved via PATH). */ // kilocode_change
  command?: string // kilocode_change
  /** Additional environment variables merged on top of process.env. */ // kilocode_change
  env?: Record<string, string | undefined> // kilocode_change
  /** Extra options forwarded to child_process.spawn (e.g. detached, windowsHide). */ // kilocode_change
  spawnOptions?: Pick<SpawnOptions, "detached" | "windowsHide"> // kilocode_change
}

// kilocode_change start
export type ServerResult = {
  /** Full URL the server is listening on (e.g. "http://127.0.0.1:12345"). */
  url: string
  /** Port extracted from the URL. */
  port: number
  /** PID of the spawned process (undefined if the process failed to spawn). */
  pid: number | undefined
  /** Collected stderr output up to the point the server started (or failed). */
  stderr: string
  /** Kill the server process. */
  close(): void
}
// kilocode_change end

export type TuiOptions = {
  project?: string
  model?: string
  session?: string
  agent?: string
  signal?: AbortSignal
  config?: Config
}

export async function createKiloServer(options?: ServerOptions): Promise<ServerResult> {
  options = Object.assign(
    {
      hostname: "127.0.0.1",
      port: 4096,
      timeout: 5000,
    },
    options ?? {},
  )

  const args = [`serve`, `--hostname=${options.hostname}`, `--port=${options.port}`]
  if (options.config?.logLevel) args.push(`--log-level=${options.config.logLevel}`)

  // kilocode_change start
  const proc = spawn(options.command ?? `kilo`, args, {
    // kilocode_change end
    signal: options.signal,
    env: {
      ...process.env,
      ...options.env, // kilocode_change
      KILO_CONFIG_CONTENT: buildConfigEnv(options.config), // kilocode_change
    },
    stdio: ["ignore", "pipe", "pipe"], // kilocode_change
    ...options.spawnOptions, // kilocode_change
  })

  // kilocode_change start
  const stderrLines: string[] = []
  // kilocode_change end

  const url = await new Promise<string>((resolve, reject) => {
    const id = setTimeout(() => {
      reject(new Error(`Timeout waiting for server to start after ${options.timeout}ms`))
    }, options.timeout)
    let output = ""
    proc.stdout?.on("data", (chunk) => {
      output += chunk.toString()
      const lines = output.split("\n")
      for (const line of lines) {
        // kilocode_change start
        if (line.startsWith("kilo server listening")) {
          // kilocode_change end
          const match = line.match(/on\s+(https?:\/\/[^\s]+)/)
          if (!match) {
            throw new Error(`Failed to parse server url from output: ${line}`)
          }
          clearTimeout(id)
          resolve(match[1]!)
          return
        }
      }
    })
    proc.stderr?.on("data", (chunk) => {
      const text = chunk.toString()
      output += text
      stderrLines.push(text) // kilocode_change
    })
    proc.on("exit", (code) => {
      clearTimeout(id)
      let msg = `Server exited with code ${code}`
      if (output.trim()) {
        msg += `\nServer output: ${output}`
      }
      reject(new Error(msg))
    })
    proc.on("error", (error) => {
      clearTimeout(id)
      reject(error)
    })
    if (options.signal) {
      options.signal.addEventListener("abort", () => {
        clearTimeout(id)
        reject(new Error("Aborted"))
      })
    }
  })

  // kilocode_change start
  const parsed = new URL(url)
  // kilocode_change end

  return {
    url,
    port: parseInt(parsed.port, 10), // kilocode_change
    pid: proc.pid, // kilocode_change
    stderr: stderrLines.join(""), // kilocode_change
    close() {
      proc.kill()
    },
  }
}

export function createKiloTui(options?: TuiOptions) {
  const args = []

  if (options?.project) {
    args.push(`--project=${options.project}`)
  }
  if (options?.model) {
    args.push(`--model=${options.model}`)
  }
  if (options?.session) {
    args.push(`--session=${options.session}`)
  }
  if (options?.agent) {
    args.push(`--agent=${options.agent}`)
  }

  // kilocode_change start
  const proc = spawn(`kilo`, args, {
    // kilocode_change end
    signal: options?.signal,
    stdio: "inherit",
    env: {
      ...process.env,
      KILO_CONFIG_CONTENT: buildConfigEnv(options?.config), // kilocode_change
    },
  })

  return {
    close() {
      proc.kill()
    },
  }
}
