// Baseline allowlist for the branding audit (branding-audit.ts).
//
// Keyed by repo-relative path under `packages/`. An entry is the reason the
// user-visible OpenCode text there is deliberately NOT Kilo-branded: a
// Kilo-replaced code path whose upstream strings are unreachable, an upstream
// SaaS product name, or a schema/provider/wire identity. Reviewed at every
// upstream sync. Two forms:
//
//   - a string suppresses the audit's findings for that whole file. A NEW
//     OpenCode string in that file is then suppressed too, so use it only for
//     a file whose OpenCode is uniformly non-branding;
//   - a list of `[snippet, reason]` suppresses only those identities. A snippet
//     is exact source text, and may include the code around a string to pin
//     which string is meant (`"HTTP-Referer": "https://opencode.ai/"`). Only
//     the text a snippet covers is ignored: every other string of the file is
//     still audited, so new product text there fails.
//
// The audit fails on a stale entry: a file with no findings, or a snippet that
// no longer accounts for a finding because upstream moved or reworded it.

/** A reviewed identity in an otherwise audited file: the exact source text, and why it is not Kilo branding. */
export type Identity = readonly [snippet: string, reason: string]

const CONSOLE = "OpenCode Console is an upstream SaaS product name, not host branding."
const GO = "OpenCode Go is an upstream SaaS product name, not host branding."
// packages/kilo-plugin/src/request-identity.ts recognises these upstream defaults by value to put Kilo's in their place.
const REFERER: Identity = [
  '"HTTP-Referer": "https://opencode.ai/"',
  "Referer sent to the provider. A third-party identity: KiloRequestIdentity replaces this exact upstream default, and what each provider is sent is tracked in #16219.",
]

export const allow: ReadonlyMap<string, string | readonly Identity[]> = new Map<string, string | readonly Identity[]>([
  [
    "cli/src/commands/handlers/upgrade.ts",
    "Upgrade command replaced by packages/kilo-cli/src/upgrade.ts; the upstream handler is unreachable in Kilo.",
  ],
  [
    "cli/src/services/updater.ts",
    "Updater service fully replaced by KiloUpdater.layer (packages/kilo-cli/src/updater.ts); the upstream method bodies and their strings are unreachable in Kilo.",
  ],
  ["cli/src/config/schema.ts", "The config JSON $schema URL is a schema identifier, not host branding."],
  [
    "tui/src/component/dialog-go-upsell.tsx",
    "OpenCode Go/Console are upstream SaaS product names, not host branding; whether this upsell appears in Kilo is a separate product decision.",
  ],
  ["tui/src/component/usage.tsx", "OpenCode Go/Console are upstream SaaS product names, not host branding."],
  ["tui/src/routes/session/index.tsx", "OpenCode Go is an upstream SaaS product name in an upsell, not host branding."],
  ["tui/src/util/usage-limits.ts", "OpenCode Console SaaS URLs, not host branding."],
  ["tui/src/mini/demo.ts", "Canned demo transcript content (an example config), not product UI branding."],
  [
    "core/src/models-dev/snapshot.txt",
    "The models.dev snapshot is provider and model data, not a prompt; OpenCode there is a provider identity.",
  ],
  [
    "core/src/plugin/skill/opencode.md",
    "Upstream OpenCode guide skill; KiloSkillConfigPlugin (packages/kilo-plugin/src/skill/config.ts) removes it and registers kilo-config instead, so its tools.opencode.* guidance never reaches the model in Kilo.",
  ],
  [
    "tui/src/util/tool-display.ts",
    "OpenCode is a provider/tool identity here; renaming it would break provider identity (see branding.test 'does not rename provider identities').",
  ],
  [
    "core/src/plugin/skill.ts",
    "Registers only the upstream `opencode` and `report` built-in skills; KiloSkillConfigPlugin (packages/kilo-plugin/src/skill/config.ts) removes both, so their names, descriptions and diagnostics never reach the model in Kilo. packages/kilo-plugin/test/skill-config.test.ts pins that upstream registers exactly these two.",
  ],
  [
    "core/src/config.ts",
    [
      [
        '?? "opencode.jsonc"',
        "Fallback name of the global config write target for a layout without names. Unreachable in Kilo: the host replaces the layout with KiloConfigDiscovery.layout (packages/kilo-cli/src/host.ts), whose names are KiloConfigFiles.names.",
      ],
    ],
  ],
  [
    "core/src/config/discovery.ts",
    [
      [
        'export const names = ["opencode.json", "opencode.jsonc"]',
        "Upstream's default config file names, read only by the default layout. Unreachable in Kilo: the host replaces ConfigDiscovery.node with KiloConfigDiscovery.layout (packages/kilo-cli/src/host.ts).",
      ],
    ],
  ],
  [
    "core/src/console-access.ts",
    [
      [
        'export const defaultServer = "https://opencode.ai/console"',
        "Endpoint of the OpenCode Console SaaS, a service address rather than host branding.",
      ],
    ],
  ],
  [
    "core/src/models-dev.ts",
    [
      [
        'const defaultSource = "https://models.opencode.ai"',
        "Endpoint of the models.dev catalog, a service address rather than host branding.",
      ],
    ],
  ],
  [
    "core/src/mcp/oauth.ts",
    [
      [
        'export const CLIENT_METADATA_URL = "https://opencode.ai/oauth/opencode/client.json"',
        "Upstream's OAuth client document, sent to MCP servers as the client ID. A third-party identity: the Kilo host supplies its own document through McpClientMetadata (#15307), so this one is not sent.",
      ],
      [
        'client_uri: options.clientMetadata?.uri ?? "https://opencode.ai"',
        "Upstream's default OAuth client URI. A third-party identity: the Kilo host supplies its own through McpClientMetadata (#15307).",
      ],
      [
        'logo_uri: "https://opencode.ai/web-app-manifest-512x512.png"',
        "OAuth client logo sent to MCP servers at registration. A third-party identity with no host knob yet, tracked in #16219.",
      ],
    ],
  ],
  [
    "core/src/tool/plugin/webfetch.ts",
    [
      [
        "OpenCode-User/1.0; +https://opencode.ai",
        "User agent the webfetch tool sends to the fetched site. A third-party identity, tracked in #16219.",
      ],
    ],
  ],
  [
    "core/src/plugin/provider/chatgpt.ts",
    [
      [
        'const agentName = "OpenCode"',
        "Agent name sent to OpenAI when the ChatGPT token-sharing client registers. A third-party identity, tracked in #16219.",
      ],
    ],
  ],
  ["core/src/plugin/provider/kilo.ts", [REFERER]],
  ["core/src/plugin/provider/llmgateway.ts", [REFERER]],
  ["core/src/plugin/provider/openrouter.ts", [REFERER]],
  ["core/src/plugin/provider/zenmux.ts", [REFERER]],
  [
    "core/src/plugin/provider/nvidia.ts",
    [
      REFERER,
      [
        '"X-BILLING-INVOKE-ORIGIN": provider.headers?.["X-BILLING-INVOKE-ORIGIN"] ?? "OpenCode"',
        "Billing origin sent to NVIDIA. A third-party identity, tracked in #16219.",
      ],
    ],
  ],
  [
    "core/src/plugin/provider/opencode.ts",
    [
      ["OpenCode Console", CONSOLE],
      ["OpenCode Web Search", "Display name of the web search provider the OpenCode Console serves."],
      ["OpenCode web search", "Errors of the web search request to the OpenCode Console."],
      ["failed to load OpenCode provider config", "Log line about the `opencode` provider's Console config."],
      ["Invalid OpenCode server URL", "The server meant is the OpenCode Console a credential signed in to."],
      ["OpenCode organization not found", "The organization meant is an OpenCode Console organization."],
    ],
  ],
  ["core/src/plugin/provider/opencode-watches.ts", [["OpenCode Console", CONSOLE]]],
  [
    "core/src/session/to-session-error.ts",
    [
      ["OpenCode Go", GO],
      ["OpenCode Console", CONSOLE],
    ],
  ],
  [
    "core/src/usage-limits.ts",
    [
      ["OpenCode Console", CONSOLE],
      ["OpenCode Go", GO],
    ],
  ],
  [
    "core/src/voice.ts",
    [
      [
        'baseURL: "https://opencode.ai/inference/openai/v1"',
        "Endpoint of the GPT-Live inference OpenCode hosts, a service address rather than host branding.",
      ],
      ["OpenCode Console", CONSOLE],
    ],
  ],
])
