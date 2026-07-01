#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: script/dev/mock-legacy-settings.sh seed|clean

Creates or removes mock Kilo Code v5 legacy settings for JetBrains migration testing.
Run from packages/kilo-jetbrains or any directory inside the repo.

Environment overrides:
  KILO_CONFIG_DIR  Config directory to manage. Default: <repo>/.kilo-dev/config/kilo

The default path matches JetBrains dev storage isolation:
  XDG_CONFIG_HOME=<repo>/.kilo-dev/config
  legacy file=<repo>/.kilo-dev/config/kilo/legacy-settings.json
USAGE
}

cmd="${1:-}"
if [[ -z "$cmd" ]]; then
  usage
  exit 2
fi
shift || true

if [[ $# -gt 0 ]]; then
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "unknown argument: $1" >&2
      usage
      exit 2
      ;;
  esac
fi

repo="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
dir="${KILO_CONFIG_DIR:-$repo/.kilo-dev/config/kilo}"
cfg="$dir/kilo.json"
old="$dir/opencode.json"
file="$dir/legacy-settings.json"

seed() {
  mkdir -p "$dir"

  cat > "$file" <<'JSON'
{
  "providerProfiles": "{\"currentApiConfigName\":\"mock-anthropic\",\"apiConfigs\":{\"mock-anthropic\":{\"apiProvider\":\"anthropic\",\"apiKey\":\"sk-ant-mock-v5-key\",\"apiModelId\":\"claude-3-5-sonnet-20241022\"},\"mock-openai\":{\"apiProvider\":\"openai-native\",\"openAiNativeApiKey\":\"sk-mock-v5-key\",\"openAiNativeBaseUrl\":\"https://mock.local/v1\",\"apiModelId\":\"gpt-4o-mini\"},\"mock-kilo\":{\"apiProvider\":\"kilocode\",\"kilocodeToken\":\"kc-mock-v5-token\",\"kilocodeModel\":\"anthropic/claude-sonnet-4\"},\"mock-unsupported\":{\"apiProvider\":\"glama\",\"apiKey\":\"unsupported-mock-key\"}}}",
  "oauth": {
    "openai-codex-oauth-credentials": "{\"access_token\":\"mock-oauth-token\",\"refresh_token\":\"mock-refresh-token\"}"
  },
  "mcpSettings": "{\"mcpServers\":{\"mock-filesystem\":{\"command\":\"node\",\"args\":[\"mock-mcp-server.js\"],\"env\":{\"MOCK\":\"1\"},\"disabled\":false},\"mock-remote\":{\"type\":\"sse\",\"url\":\"https://example.com/mock-mcp\",\"disabled\":true}}}",
  "customModes": "{\"customModes\":[{\"slug\":\"mock-v5-agent\",\"name\":\"Mock V5 Agent\",\"roleDefinition\":\"You are a mock legacy v5 agent used for migration testing.\",\"groups\":[\"read\",\"edit\",\"browser\",\"command\",\"mcp\"]},{\"slug\":\"code\",\"name\":\"Mock Modified Code Mode\",\"roleDefinition\":\"You are a modified native Code mode from legacy settings.\",\"groups\":[\"read\",\"edit\"]}]}",
  "customModePrompts": "{\"mock-v5-agent\":{\"roleDefinition\":\"Prompt component role definition override.\",\"customInstructions\":\"Use mock legacy instructions.\"}}",
  "globalState": {
    "kilo-code.autoApprovalEnabled": true,
    "kilo-code.allowedCommands": ["npm test", "bun test"],
    "kilo-code.deniedCommands": ["rm -rf *"],
    "alwaysAllowReadOnly": true,
    "alwaysAllowReadOnlyOutsideWorkspace": true,
    "alwaysAllowWrite": false,
    "alwaysAllowExecute": false,
    "alwaysAllowMcp": true,
    "alwaysAllowModeSwitch": true,
    "alwaysAllowSubtasks": true,
    "kilo-code.language": "en",
    "ghostServiceSettings": {
      "enableAutoTrigger": true,
      "enableSmartInlineTaskKeybinding": true,
      "enableChatAutocomplete": true
    }
  },
  "taskHistory": "[{\"id\":\"mock-task-1\",\"task\":\"Mock migrated task\",\"workspace\":\"/tmp/mock-v5-workspace\",\"ts\":1700000000000},{\"id\":\"mock-task-2\",\"task\":\"Second mock migrated task\",\"workspace\":\"/tmp/mock-v5-workspace\",\"ts\":1700000001000}]",
  "conversations": {
    "mock-task-1": "[{\"role\":\"user\",\"content\":\"Create a mock migration task\",\"ts\":1700000000000},{\"role\":\"assistant\",\"content\":\"Mock task response from legacy config.\",\"ts\":1700000001000}]",
    "mock-task-2": "[{\"role\":\"user\",\"content\":\"Create another mock migrated task\",\"ts\":1700000001000},{\"role\":\"assistant\",\"content\":\"Second mock response from legacy config.\",\"ts\":1700000002000}]"
  }
}
JSON

  rm -f "$cfg" "$old"
  echo "Seeded mock legacy settings: $file"
  echo "Run JetBrains with -Pkilo.dev.storage.isolated=true to pick up the default path."
}

clean() {
  rm -f "$file"
  echo "Removed mock legacy settings: $file"
}

case "$cmd" in
  seed) seed ;;
  clean) clean ;;
  -h|--help)
    usage
    ;;
  *)
    echo "unknown command: $cmd" >&2
    usage
    exit 2
    ;;
esac
