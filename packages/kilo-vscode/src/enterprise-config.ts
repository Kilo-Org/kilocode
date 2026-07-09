import * as fs from "fs"
import * as path from "path"
import * as vscode from "vscode"
import { globalConfigDir } from "./shared/global-config-dir"

const CONFIG_KEY = "kilo-code.new.customApi"
const ENV_KEY = "KILO_CUSTOM_API_KEY"
const ENV_URL = "KILO_CUSTOM_API_BASE_URL"

type ModelSpec = {
  name: string
  tool_call: boolean
  limit: { context: number; output: number }
}

type ApiSettings = {
  enabled: boolean
  providerId: string
  baseUrl: string
  apiKey: string
  defaultModel: string
  smallModel: string
  overwrite: boolean
}

type OpencodeConfig = {
  $schema?: string
  model?: string
  small_model?: string
  enabled_providers?: string[]
  disabled_providers?: string[]
  provider?: Record<
    string,
    {
      name?: string
      npm?: string
      api?: string
      options?: { apiKey?: string; baseURL?: string }
      models?: Record<string, ModelSpec>
    }
  >
}

const defaultModels: Record<string, ModelSpec> = {
  "glm-5": { name: "GLM-5", tool_call: true, limit: { context: 128000, output: 8192 } },
  "glm-5.1": { name: "GLM-5.1", tool_call: true, limit: { context: 128000, output: 8192 } },
  "MiniMax-M2.7": { name: "MiniMax-M2.7", tool_call: true, limit: { context: 128000, output: 8192 } },
  "deepseek-v4-pro": { name: "DeepSeek V4 Pro", tool_call: true, limit: { context: 128000, output: 8192 } },
}

let ready: Promise<void> | null = null
let wrote = false

export function enterpriseConfigWritten() {
  return wrote
}

export function resolveGlobalConfigDir(): string {
  return globalConfigDir()
}

function readSettings(): ApiSettings {
  const cfg = vscode.workspace.getConfiguration(CONFIG_KEY)
  return {
    enabled: cfg.get<boolean>("enabled", false),
    providerId: cfg.get<string>("providerId", "ruiyumaas"),
    baseUrl: cfg.get<string>("baseUrl", "https://ruiyumaas.com/v1"),
    apiKey: cfg.get<string>("apiKey", ""),
    defaultModel: cfg.get<string>("defaultModel", "glm-5.1"),
    smallModel: cfg.get<string>("smallModel", "glm-5"),
    overwrite: cfg.get<boolean>("overwriteOnStartup", true),
  }
}

function loadTemplate(extensionPath: string): OpencodeConfig | null {
  const file = path.join(extensionPath, "default-opencode.json")
  if (!fs.existsSync(file)) return null
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as OpencodeConfig
  } catch (err) {
    console.error("[Kilo New] Failed to parse default-opencode.json:", err)
    return null
  }
}

function buildConfig(settings: ApiSettings, template: OpencodeConfig | null): OpencodeConfig {
  const id = settings.providerId
  const base = template?.provider?.[id]?.models ?? defaultModels
  const url = settings.baseUrl.replace(/\/+$/, "")
  const key = settings.apiKey || `{env:${ENV_KEY}}`
  return {
    $schema: "https://app.kilo.ai/config.json",
    model: `${id}/${settings.defaultModel}`,
    small_model: `${id}/${settings.smallModel}`,
    enabled_providers: [id],
    disabled_providers: ["kilo"],
    provider: {
      [id]: {
        name: template?.provider?.[id]?.name ?? "Custom API",
        npm: "@ai-sdk/openai-compatible",
        api: url,
        options: {
          apiKey: key,
          baseURL: url,
        },
        models: base,
      },
    },
  }
}

function writeConfig(configPath: string, config: OpencodeConfig) {
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8")
}

async function ensure(context: vscode.ExtensionContext): Promise<void> {
  const settings = readSettings()
  if (!settings.enabled) return

  const configDir = globalConfigDir()
  const primary = path.join(configDir, "kilo.jsonc")
  const legacy = path.join(configDir, "opencode.json")
  const exists = fs.existsSync(primary) || fs.existsSync(legacy)

  if (exists && !settings.overwrite) {
    console.log("[Kilo New] Custom API config exists, skipping (overwriteOnStartup=false)")
    return
  }

  const template = loadTemplate(context.extensionPath)
  const config = buildConfig(settings, template)

  try {
    fs.mkdirSync(configDir, { recursive: true })
    writeConfig(primary, config)
    writeConfig(legacy, config)
    wrote = true
    console.log("[Kilo New] Custom API config written to", primary)
  } catch (err) {
    console.error("[Kilo New] Failed to write custom API config:", err)
  }
}

export function startEnterpriseConfig(context: vscode.ExtensionContext): Promise<void> {
  if (!ready) ready = ensure(context)
  return ready
}

export async function whenEnterpriseConfigReady(): Promise<void> {
  if (ready) await ready
}

export function customApiEnv(): Record<string, string> {
  const settings = readSettings()
  if (!settings.enabled) return {}

  const env: Record<string, string> = {}
  const key = settings.apiKey || process.env[ENV_KEY]
  const url = settings.baseUrl || process.env[ENV_URL]
  if (key) env[ENV_KEY] = key
  if (url) env[ENV_URL] = url.replace(/\/+$/, "")
  return env
}
