import launch from "cross-spawn"
import { type Config } from "./gen/types.gen.js"
import { stop, bindAbort } from "./process.js"

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
}

export type TuiOptions = {
  project?: string
  model?: string
  session?: string
  agent?: string
  signal?: AbortSignal
  config?: Config
}

export async function createKiloServer(options?: ServerOptions) {
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

  const proc = launch(`kilo`, args, {
    // kilocode_change
    env: {
      ...process.env,
      KILO_CONFIG_CONTENT: buildConfigEnv(options.config), // kilocode_change
    },
  })
  let clear = () => {}

  const url = await new Promise<string>((resolve, reject) => {
    const id = setTimeout(() => {
      clear()
      stop(proc)
      reject(new Error(`Timeout waiting for server to start after ${options.timeout}ms`))
    }, options.timeout)
    let output = ""
    let resolved = false
    proc.stdout?.on("data", (chunk) => {
      if (resolved) return
      output += chunk.toString()
      const lines = output.split("\n")
      for (const line of lines) {
        // kilocode_change start
        if (line.startsWith("kilo server listening")) {
          // kilocode_change end
          const match = line.match(/on\s+(https?:\/\/[^\s]+)/)
          if (!match) {
            clear()
            stop(proc)
            clearTimeout(id)
            reject(new Error(`Failed to parse server url from output: ${line}`))
            return
          }
          clearTimeout(id)
          resolved = true
          resolve(match[1]!)
          return
        }
      }
    })
    proc.stderr?.on("data", (chunk) => {
      output += chunk.toString()
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
    clear = bindAbort(proc, options.signal, () => {
      clearTimeout(id)
      reject(options.signal?.reason)
    })
  })

  return {
    url,
    close() {
      clear()
      stop(proc)
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

  const proc = launch(`kilo`, args, {
    // kilocode_change
    stdio: "inherit",
    windowsHide: true,
    env: {
      ...process.env,
      KILO_CONFIG_CONTENT: buildConfigEnv(options?.config), // kilocode_change
    },
  })

  const clear = bindAbort(proc, options?.signal)

  return {
    close() {
      clear()
      stop(proc)
    },
  }
}
