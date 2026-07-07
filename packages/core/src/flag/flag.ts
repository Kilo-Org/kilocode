import { Config } from "effect"

export function truthy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "true" || value === "1"
}

const copy = process.env["KILO_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"]

function enabledByExperimental(key: string) {
  return process.env[key] === undefined ? truthy("KILO_EXPERIMENTAL") : truthy(key)
}

export const Flag = {
  OTEL_EXPORTER_OTLP_ENDPOINT: process.env["OTEL_EXPORTER_OTLP_ENDPOINT"],
  OTEL_EXPORTER_OTLP_HEADERS: process.env["OTEL_EXPORTER_OTLP_HEADERS"],

  KILO_AUTO_HEAP_SNAPSHOT: truthy("KILO_AUTO_HEAP_SNAPSHOT"),
  KILO_GIT_BASH_PATH: process.env["KILO_GIT_BASH_PATH"],
  KILO_CONFIG: process.env["KILO_CONFIG"],
  KILO_CONFIG_CONTENT: process.env["KILO_CONFIG_CONTENT"],
  KILO_DISABLE_AUTOUPDATE: truthy("KILO_DISABLE_AUTOUPDATE"),
  KILO_ALWAYS_NOTIFY_UPDATE: truthy("KILO_ALWAYS_NOTIFY_UPDATE"),
  KILO_DISABLE_PRUNE: truthy("KILO_DISABLE_PRUNE"),
  KILO_DISABLE_TERMINAL_TITLE: truthy("KILO_DISABLE_TERMINAL_TITLE"),
  KILO_SHOW_TTFD: truthy("KILO_SHOW_TTFD"),
  KILO_DISABLE_AUTOCOMPACT: truthy("KILO_DISABLE_AUTOCOMPACT"),
  KILO_DISABLE_MODELS_FETCH: truthy("KILO_DISABLE_MODELS_FETCH"),
  KILO_DISABLE_MOUSE: truthy("KILO_DISABLE_MOUSE"),
  KILO_FAKE_VCS: process.env["KILO_FAKE_VCS"],
  KILO_SERVER_PASSWORD: process.env["KILO_SERVER_PASSWORD"],
  KILO_SERVER_USERNAME: process.env["KILO_SERVER_USERNAME"],

  // Experimental
  KILO_EXPERIMENTAL_FILEWATCHER: Config.boolean("KILO_EXPERIMENTAL_FILEWATCHER").pipe(
    Config.withDefault(false),
  ),
  KILO_EXPERIMENTAL_DISABLE_FILEWATCHER: Config.boolean("KILO_EXPERIMENTAL_DISABLE_FILEWATCHER").pipe(
    Config.withDefault(false),
  ),
  KILO_EXPERIMENTAL_DISABLE_COPY_ON_SELECT:
    copy === undefined ? process.platform === "win32" : truthy("KILO_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"),
  KILO_MODELS_URL: process.env["KILO_MODELS_URL"],
  KILO_MODELS_PATH: process.env["KILO_MODELS_PATH"],
  KILO_DB: process.env["KILO_DB"],

  KILO_WORKSPACE_ID: process.env["KILO_WORKSPACE_ID"],
  KILO_EXPERIMENTAL_WORKSPACES: enabledByExperimental("KILO_EXPERIMENTAL_WORKSPACES"),
  KILO_EXPERIMENTAL_SESSION_SWITCHER: enabledByExperimental("KILO_EXPERIMENTAL_SESSION_SWITCHER"),

  // Evaluated at access time (not module load) because tests, the CLI, and
  // external tooling set these env vars at runtime.
  get KILO_DISABLE_PROJECT_CONFIG() {
    return truthy("KILO_DISABLE_PROJECT_CONFIG")
  },
  get KILO_EXPERIMENTAL_REFERENCES() {
    return enabledByExperimental("KILO_EXPERIMENTAL_REFERENCES")
  },
  get KILO_TUI_CONFIG() {
    return process.env["KILO_TUI_CONFIG"]
  },
  get KILO_CONFIG_DIR() {
    return process.env["KILO_CONFIG_DIR"]
  },
  get KILO_PURE() {
    return truthy("KILO_PURE")
  },
  get KILO_PERMISSION() {
    return process.env["KILO_PERMISSION"]
  },
  get KILO_PLUGIN_META_FILE() {
    return process.env["KILO_PLUGIN_META_FILE"]
  },
  get KILO_CLIENT() {
    return process.env["KILO_CLIENT"] ?? "cli"
  },
}
