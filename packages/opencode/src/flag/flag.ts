// devilcode_change - renamed all OPENCODE_ env vars to DEVIL_
function truthy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "true" || value === "1"
}

function falsy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "false" || value === "0"
}

export namespace Flag {
  export const DEVIL_AUTO_SHARE = truthy("DEVIL_AUTO_SHARE")
  export const DEVIL_GIT_BASH_PATH = process.env["DEVIL_GIT_BASH_PATH"]
  export const DEVIL_CONFIG = process.env["DEVIL_CONFIG"]
  export declare const DEVIL_TUI_CONFIG: string | undefined
  export declare const DEVIL_CONFIG_DIR: string | undefined
  export const DEVIL_CONFIG_CONTENT = process.env["DEVIL_CONFIG_CONTENT"]
  export const DEVIL_DISABLE_AUTOUPDATE = truthy("DEVIL_DISABLE_AUTOUPDATE")
  export const DEVIL_DISABLE_PRUNE = truthy("DEVIL_DISABLE_PRUNE")
  export const DEVIL_DISABLE_TERMINAL_TITLE = truthy("DEVIL_DISABLE_TERMINAL_TITLE")
  export const DEVIL_PERMISSION = process.env["DEVIL_PERMISSION"]
  export const DEVIL_DISABLE_DEFAULT_PLUGINS = truthy("DEVIL_DISABLE_DEFAULT_PLUGINS")
  export const DEVIL_DISABLE_LSP_DOWNLOAD = truthy("DEVIL_DISABLE_LSP_DOWNLOAD")
  export const DEVIL_ENABLE_EXPERIMENTAL_MODELS = truthy("DEVIL_ENABLE_EXPERIMENTAL_MODELS")
  export const DEVIL_DISABLE_AUTOCOMPACT = truthy("DEVIL_DISABLE_AUTOCOMPACT")
  export const DEVIL_DISABLE_MODELS_FETCH = truthy("DEVIL_DISABLE_MODELS_FETCH")
  export const DEVIL_DISABLE_CLAUDE_CODE = truthy("DEVIL_DISABLE_CLAUDE_CODE")
  export const DEVIL_DISABLE_CLAUDE_CODE_PROMPT = DEVIL_DISABLE_CLAUDE_CODE || truthy("DEVIL_DISABLE_CLAUDE_CODE_PROMPT")
  export const DEVIL_DISABLE_CLAUDE_CODE_SKILLS = DEVIL_DISABLE_CLAUDE_CODE || truthy("DEVIL_DISABLE_CLAUDE_CODE_SKILLS")
  export const DEVIL_DISABLE_EXTERNAL_SKILLS = DEVIL_DISABLE_CLAUDE_CODE_SKILLS || truthy("DEVIL_DISABLE_EXTERNAL_SKILLS")
  export declare const DEVIL_DISABLE_PROJECT_CONFIG: boolean
  export const DEVIL_FAKE_VCS = process.env["DEVIL_FAKE_VCS"]
  export declare const DEVIL_CLIENT: string
  export const DEVIL_SERVER_PASSWORD = process.env["DEVIL_SERVER_PASSWORD"]
  export const DEVIL_SERVER_USERNAME = process.env["DEVIL_SERVER_USERNAME"]
  export const DEVIL_ENABLE_QUESTION_TOOL = truthy("DEVIL_ENABLE_QUESTION_TOOL")

  // Experimental
  export const DEVIL_EXPERIMENTAL = truthy("DEVIL_EXPERIMENTAL")
  export const DEVIL_EXPERIMENTAL_FILEWATCHER = truthy("DEVIL_EXPERIMENTAL_FILEWATCHER")
  export const DEVIL_EXPERIMENTAL_DISABLE_FILEWATCHER = truthy("DEVIL_EXPERIMENTAL_DISABLE_FILEWATCHER")
  export const DEVIL_EXPERIMENTAL_ICON_DISCOVERY = DEVIL_EXPERIMENTAL || truthy("DEVIL_EXPERIMENTAL_ICON_DISCOVERY")

  const copy = process.env["DEVIL_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"]
  export const DEVIL_EXPERIMENTAL_DISABLE_COPY_ON_SELECT =
    copy === undefined ? process.platform === "win32" : truthy("DEVIL_EXPERIMENTAL_DISABLE_COPY_ON_SELECT")
  export const DEVIL_ENABLE_EXA = truthy("DEVIL_ENABLE_EXA") || DEVIL_EXPERIMENTAL || truthy("DEVIL_EXPERIMENTAL_EXA")
  export const DEVIL_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS = number("DEVIL_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS")
  export const DEVIL_EXPERIMENTAL_OUTPUT_TOKEN_MAX = number("DEVIL_EXPERIMENTAL_OUTPUT_TOKEN_MAX")
  export const DEVIL_EXPERIMENTAL_OXFMT = DEVIL_EXPERIMENTAL || truthy("DEVIL_EXPERIMENTAL_OXFMT")
  export const DEVIL_EXPERIMENTAL_LSP_TY = truthy("DEVIL_EXPERIMENTAL_LSP_TY")
  export const DEVIL_EXPERIMENTAL_LSP_TOOL = DEVIL_EXPERIMENTAL || truthy("DEVIL_EXPERIMENTAL_LSP_TOOL")
  export const DEVIL_DISABLE_FILETIME_CHECK = truthy("DEVIL_DISABLE_FILETIME_CHECK")
  export const DEVIL_EXPERIMENTAL_PLAN_MODE = DEVIL_EXPERIMENTAL || truthy("DEVIL_EXPERIMENTAL_PLAN_MODE")
  export const DEVIL_EXPERIMENTAL_WORKSPACES_TUI = DEVIL_EXPERIMENTAL || truthy("DEVIL_EXPERIMENTAL_WORKSPACES_TUI")
  export const DEVIL_EXPERIMENTAL_MARKDOWN = !falsy("DEVIL_EXPERIMENTAL_MARKDOWN")
  export const DEVIL_MODELS_URL = process.env["DEVIL_MODELS_URL"]
  export const DEVIL_MODELS_PATH = process.env["DEVIL_MODELS_PATH"]
  export const DEVIL_SKIP_MIGRATIONS = truthy("DEVIL_SKIP_MIGRATIONS")

  function number(key: string) {
    const value = process.env[key]
    if (!value) return undefined
    const parsed = Number(value)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
  }

  export declare const DEVIL_SESSION_RETRY_LIMIT: number | undefined
}

// Dynamic getter for DEVIL_SESSION_RETRY_LIMIT
// This must be evaluated at access time, not module load time,
// because tests and external tooling may set this env var at runtime
Object.defineProperty(Flag, "DEVIL_SESSION_RETRY_LIMIT", {
  get() {
    const value = process.env["DEVIL_SESSION_RETRY_LIMIT"]
    if (!value) return undefined
    const parsed = Number(value)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for DEVIL_DISABLE_PROJECT_CONFIG
// This must be evaluated at access time, not module load time,
// because external tooling may set this env var at runtime
Object.defineProperty(Flag, "DEVIL_DISABLE_PROJECT_CONFIG", {
  get() {
    return truthy("DEVIL_DISABLE_PROJECT_CONFIG")
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for DEVIL_TUI_CONFIG
// This must be evaluated at access time, not module load time,
// because tests and external tooling may set this env var at runtime
Object.defineProperty(Flag, "DEVIL_TUI_CONFIG", {
  get() {
    return process.env["DEVIL_TUI_CONFIG"]
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for DEVIL_CONFIG_DIR
// This must be evaluated at access time, not module load time,
// because external tooling may set this env var at runtime
Object.defineProperty(Flag, "DEVIL_CONFIG_DIR", {
  get() {
    return process.env["DEVIL_CONFIG_DIR"]
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for DEVIL_CLIENT
// This must be evaluated at access time, not module load time,
// because some commands override the client at runtime
Object.defineProperty(Flag, "DEVIL_CLIENT", {
  get() {
    return process.env["DEVIL_CLIENT"] ?? "cli"
  },
  enumerable: true,
  configurable: false,
})
