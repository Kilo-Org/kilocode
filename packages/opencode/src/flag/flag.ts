// kilocode_change - renamed all OPENCODE_ env vars to KILO_
function truthy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "true" || value === "1"
}

export namespace Flag {
  export const KILO_AUTO_SHARE = truthy("KILO_AUTO_SHARE")
  export const KILO_GIT_BASH_PATH = process.env["KILO_GIT_BASH_PATH"]
  export const KILO_CONFIG = process.env["KILO_CONFIG"]
  export declare const KILO_CONFIG_DIR: string | undefined
  export const KILO_CONFIG_CONTENT = process.env["KILO_CONFIG_CONTENT"]
  export const KILO_DISABLE_AUTOUPDATE = truthy("KILO_DISABLE_AUTOUPDATE")
  export const KILO_DISABLE_PRUNE = truthy("KILO_DISABLE_PRUNE")
  export const KILO_DISABLE_TERMINAL_TITLE = truthy("KILO_DISABLE_TERMINAL_TITLE")
  export const KILO_PERMISSION = process.env["KILO_PERMISSION"]
  export const KILO_DISABLE_DEFAULT_PLUGINS = truthy("KILO_DISABLE_DEFAULT_PLUGINS")
  export const KILO_DISABLE_LSP_DOWNLOAD = truthy("KILO_DISABLE_LSP_DOWNLOAD")
  export const KILO_ENABLE_EXPERIMENTAL_MODELS = truthy("KILO_ENABLE_EXPERIMENTAL_MODELS")
  export const KILO_DISABLE_AUTOCOMPACT = truthy("KILO_DISABLE_AUTOCOMPACT")
  export const KILO_DISABLE_MODELS_FETCH = truthy("KILO_DISABLE_MODELS_FETCH")
  export const KILO_DISABLE_CLAUDE_CODE = truthy("KILO_DISABLE_CLAUDE_CODE")
  export const KILO_DISABLE_CLAUDE_CODE_PROMPT = KILO_DISABLE_CLAUDE_CODE || truthy("KILO_DISABLE_CLAUDE_CODE_PROMPT")
  export const KILO_DISABLE_CLAUDE_CODE_SKILLS = KILO_DISABLE_CLAUDE_CODE || truthy("KILO_DISABLE_CLAUDE_CODE_SKILLS")
  export const KILO_DISABLE_EXTERNAL_SKILLS = KILO_DISABLE_CLAUDE_CODE_SKILLS || truthy("KILO_DISABLE_EXTERNAL_SKILLS")
  export declare const KILO_DISABLE_PROJECT_CONFIG: boolean
  export const KILO_FAKE_VCS = process.env["KILO_FAKE_VCS"]
  export declare const KILO_CLIENT: string
  export const KILO_SERVER_PASSWORD = process.env["KILO_SERVER_PASSWORD"]
  export const KILO_SERVER_USERNAME = process.env["KILO_SERVER_USERNAME"]

  // Experimental
  export const KILO_EXPERIMENTAL = truthy("KILO_EXPERIMENTAL")
  export const KILO_EXPERIMENTAL_FILEWATCHER = truthy("KILO_EXPERIMENTAL_FILEWATCHER")
  export const KILO_EXPERIMENTAL_DISABLE_FILEWATCHER = truthy("KILO_EXPERIMENTAL_DISABLE_FILEWATCHER")
  export const KILO_EXPERIMENTAL_ICON_DISCOVERY = KILO_EXPERIMENTAL || truthy("KILO_EXPERIMENTAL_ICON_DISCOVERY")

  const copy = process.env["KILO_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"]
  export const KILO_EXPERIMENTAL_DISABLE_COPY_ON_SELECT =
    copy === undefined ? process.platform === "win32" : truthy("KILO_EXPERIMENTAL_DISABLE_COPY_ON_SELECT")
  export const KILO_ENABLE_EXA = truthy("KILO_ENABLE_EXA") || KILO_EXPERIMENTAL || truthy("KILO_EXPERIMENTAL_EXA")
  export const KILO_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS = number("KILO_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS")
  export const KILO_EXPERIMENTAL_OUTPUT_TOKEN_MAX = number("KILO_EXPERIMENTAL_OUTPUT_TOKEN_MAX")
  export const KILO_EXPERIMENTAL_OXFMT = KILO_EXPERIMENTAL || truthy("KILO_EXPERIMENTAL_OXFMT")
  export const KILO_EXPERIMENTAL_LSP_TY = truthy("KILO_EXPERIMENTAL_LSP_TY")
  export const KILO_EXPERIMENTAL_LSP_TOOL = KILO_EXPERIMENTAL || truthy("KILO_EXPERIMENTAL_LSP_TOOL")
  export const KILO_DISABLE_FILETIME_CHECK = truthy("KILO_DISABLE_FILETIME_CHECK")
  export const KILO_EXPERIMENTAL_PLAN_MODE = KILO_EXPERIMENTAL || truthy("KILO_EXPERIMENTAL_PLAN_MODE")
  export const KILO_EXPERIMENTAL_MARKDOWN = truthy("KILO_EXPERIMENTAL_MARKDOWN")
  export const KILO_MODELS_URL = process.env["KILO_MODELS_URL"]
  export const KILO_MODELS_PATH = process.env["KILO_MODELS_PATH"]

  function number(key: string) {
    const value = process.env[key]
    if (!value) return undefined
    const parsed = Number(value)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
  }
}

// Dynamic getter for KILO_DISABLE_PROJECT_CONFIG
// This must be evaluated at access time, not module load time,
// because external tooling may set this env var at runtime
Object.defineProperty(Flag, "KILO_DISABLE_PROJECT_CONFIG", {
  get() {
    return truthy("KILO_DISABLE_PROJECT_CONFIG")
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for KILO_CONFIG_DIR
// This must be evaluated at access time, not module load time,
// because external tooling may set this env var at runtime
Object.defineProperty(Flag, "KILO_CONFIG_DIR", {
  get() {
    return process.env["KILO_CONFIG_DIR"]
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for KILO_CLIENT
// This must be evaluated at access time, not module load time,
// because some commands override the client at runtime
Object.defineProperty(Flag, "KILO_CLIENT", {
  get() {
    return process.env["KILO_CLIENT"] ?? "cli"
  },
  enumerable: true,
  configurable: false,
})
