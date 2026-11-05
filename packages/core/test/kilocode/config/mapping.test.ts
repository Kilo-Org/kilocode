import { expect, test } from "bun:test"
import { ConfigNormalize } from "@opencode/core/config/normalize"
import { KiloConfigPolicy } from "@opencode/core/kilocode/config/policy"

// Per-key v1 -> v2 mapping for the Kilo configuration surface. This table replaces the deleted
// `config-mapping-v2-gap.md`: every v1 Kilo config key (and the upstream keys v1 relied on) gets a disposition and a
// pinned outcome. `folded` keys are decoded by `KiloConfigPolicy`; `native` keys are handled by the upstream schema
// and normalization with no Kilo code; `native-unsupported` keys upstream normalization refuses with a diagnostic;
// `refused` keys this build accepts from neither and ignores with a diagnostic; `dropped` keys are not carried and
// have no v2 caller; `open` keys belong to another epic and stay undecided here.

interface Base {
  key: string
  input: Record<string, unknown>
  /** Decoded location; defaults to `[key]`. */
  path?: readonly string[]
}

type Case =
  | (Base & { disposition: "folded"; value: unknown })
  | (Base & { disposition: "native"; value: unknown })
  | (Base & { disposition: "native-unsupported" })
  | (Base & { disposition: "refused"; message: string })
  | (Base & { disposition: "dropped" })
  | (Base & { disposition: "open"; note: string })

const unsupported = "omitted unsupported legacy setting"

const cases: Case[] = [
  // --- Folded: decoded by KiloConfigPolicy (schema field + parse). ---
  { key: "hide_prompt_training_models", disposition: "folded", input: { hide_prompt_training_models: true }, value: true },
  { key: "privacy_mode", disposition: "folded", input: { privacy_mode: true }, value: true },
  { key: "terminal_command_display", disposition: "folded", input: { terminal_command_display: "collapsed" }, value: "collapsed" },
  { key: "code_edit_display", disposition: "folded", input: { code_edit_display: "expanded" }, value: "expanded" },
  { key: "mcp_tool_display", disposition: "folded", input: { mcp_tool_display: "collapsed" }, value: "collapsed" },
  { key: "commit_message", disposition: "folded", input: { commit_message: { prompt: "Write a message" } }, value: { prompt: "Write a message" } },
  { key: "remote_control", disposition: "folded", input: { remote_control: true }, value: true },
  { key: "auto_collapse_reasoning", disposition: "folded", input: { auto_collapse_reasoning: true }, value: true },
  { key: "reasoning_display", disposition: "folded", input: { reasoning_display: "preview" }, value: "preview" },
  { key: "shared_agent_board", disposition: "folded", input: { shared_agent_board: true }, value: true },
  {
    key: "sandbox",
    disposition: "folded",
    input: { sandbox: { enabled: true, network: "allow", writable_paths: ["/tmp"], allowed_hosts: ["api.github.com"] } },
    value: { enabled: true, network: "allow", writable_paths: ["/tmp"], allowed_hosts: ["api.github.com"] },
  },
  { key: "subagent_model", disposition: "folded", input: { subagent_model: "anthropic/claude-haiku" }, value: "anthropic/claude-haiku" },
  { key: "subagent_variant", disposition: "folded", input: { subagent_variant: "high" }, value: "high" },
  {
    key: "subagent_variant_overrides",
    disposition: "folded",
    input: { subagent_variant_overrides: { "anthropic/claude-haiku": "high", "openai/gpt": null } },
    value: { "anthropic/claude-haiku": "high", "openai/gpt": null },
  },
  { key: "memory_model", disposition: "folded", input: { memory_model: "anthropic/claude-haiku" }, value: "anthropic/claude-haiku" },
  { key: "web_search", disposition: "folded", input: { web_search: true }, value: true },
  { key: "retention", disposition: "folded", input: { retention: { enabled: true, maxAgeDays: 7 } }, value: { enabled: true, maxAgeDays: 7 } },

  // --- Native: upstream v2 maps the key, no Kilo code. ---
  { key: "model", disposition: "native", input: { model: "anthropic/claude-sonnet-4" }, path: ["model"], value: { providerID: "anthropic", model: "claude-sonnet-4" } },
  { key: "small_model", disposition: "native", input: { small_model: "anthropic/claude-haiku" }, path: ["agents", "title", "model"], value: { providerID: "anthropic", model: "claude-haiku" } },
  { key: "snapshot", disposition: "native", input: { snapshot: false }, path: ["snapshots"], value: false },
  { key: "share", disposition: "native", input: { share: "auto" }, path: ["share"], value: "auto" },
  { key: "autoupdate", disposition: "native", input: { autoupdate: "notify" }, path: ["update"], value: "notify" },
  { key: "update", disposition: "native", input: { update: "auto" }, path: ["update"], value: "auto" },
  { key: "disabled_providers", disposition: "native", input: { disabled_providers: ["openai"] }, path: ["policies"], value: [{ action: "provider.use", resource: "openai", effect: "deny" }] },
  {
    key: "enabled_providers",
    disposition: "native",
    input: { enabled_providers: ["anthropic"] },
    path: ["policies"],
    value: [
      { action: "provider.use", resource: "*", effect: "deny" },
      { action: "provider.use", resource: "anthropic", effect: "allow" },
    ],
  },
  { key: "watcher", disposition: "native", input: { watcher: { ignore: ["node_modules"] } }, path: ["watcher"], value: { ignore: ["node_modules"] } },
  { key: "instructions", disposition: "native", input: { instructions: ["AGENTS.md"] }, path: ["instructions"], value: ["AGENTS.md"] },
  { key: "command", disposition: "native", input: { command: { foo: { template: "hi" } } }, path: ["commands"], value: { foo: { template: "hi" } } },
  { key: "provider", disposition: "native", input: { provider: { anthropic: { options: { apiKey: "x" } } } }, path: ["providers"], value: { anthropic: { settings: { apiKey: "x" } } } },
  { key: "agent", disposition: "native", input: { agent: { build: { model: "anthropic/x", prompt: "hi" } } }, path: ["agents"], value: { build: { model: { providerID: "anthropic", model: "x" }, system: "hi" } } },
  { key: "mode", disposition: "native", input: { mode: { plan: { model: "anthropic/x" } } }, path: ["agents"], value: { plan: { model: { providerID: "anthropic", model: "x" }, mode: "primary" } } },
  { key: "permission", disposition: "native", input: { permission: { bash: "allow" } }, path: ["permissions"], value: [{ action: "shell", resource: "*", effect: "allow" }] },
  { key: "tools", disposition: "native", input: { tools: { write: false } }, path: ["permissions"], value: [{ action: "edit", resource: "*", effect: "deny" }] },
  { key: "plugin", disposition: "native", input: { plugin: ["foo"] }, path: ["plugins"], value: ["foo"] },
  { key: "skills", disposition: "native", input: { skills: { paths: ["s"], urls: ["u"] } }, path: ["skills"], value: ["s", "u"] },
  { key: "references", disposition: "native", input: { references: { docs: { path: "d" } } }, path: ["references"], value: { docs: { path: "d" } } },
  { key: "attachment", disposition: "native", input: { attachment: { image: { max_width: 100 } } }, path: ["media"], value: { image: { max_width: 100 } } },
  { key: "username", disposition: "native", input: { username: "bob" }, path: ["username"], value: "bob" },
  { key: "enterprise", disposition: "native", input: { enterprise: { url: "https://x" } }, path: ["enterprise"], value: { url: "https://x" } },
  { key: "default_agent", disposition: "native", input: { default_agent: "plan" }, path: ["default_agent"], value: "plan" },
  { key: "websearch", disposition: "native", input: { websearch: { provider: "random" } }, path: ["websearch"], value: { provider: "random" } },
  { key: "experimental.mcp_timeout", disposition: "native", input: { experimental: { mcp_timeout: 5 } }, path: ["mcp", "timeout"], value: { catalog: 5, execution: 5 } },
  { key: "experimental.policies", disposition: "native", input: { experimental: { policies: [{ effect: "deny", action: "provider.use", resource: "openai" }] } }, path: ["policies"], value: [{ action: "provider.use", resource: "openai", effect: "deny" }] },
  { key: "experimental.image_generate", disposition: "native", input: { experimental: { image_generate: true } }, path: ["experimental", "image_generate"], value: true },

  // --- Native-unsupported: upstream v2 refuses the key with a diagnostic, no Kilo code. ---
  { key: "server", disposition: "native-unsupported", input: { server: { port: 1 } }, path: ["server"] },
  { key: "logLevel", disposition: "native-unsupported", input: { logLevel: "INFO" }, path: ["logLevel"] },
  { key: "layout", disposition: "native-unsupported", input: { layout: "stretch" }, path: ["layout"] },
  { key: "subagent_depth", disposition: "native-unsupported", input: { subagent_depth: 2 }, path: ["subagent_depth"] },
  { key: "compaction.prune", disposition: "native-unsupported", input: { compaction: { prune: false } }, path: ["compaction", "prune"] },
  { key: "compaction.tail_turns", disposition: "native-unsupported", input: { compaction: { tail_turns: 3 } }, path: ["compaction", "tail_turns"] },
  { key: "experimental.openTelemetry", disposition: "native-unsupported", input: { experimental: { openTelemetry: false } }, path: ["experimental", "openTelemetry"] },
  { key: "experimental.batch_tool", disposition: "native-unsupported", input: { experimental: { batch_tool: true } }, path: ["experimental", "batch_tool"] },
  { key: "experimental.disable_paste_summary", disposition: "native-unsupported", input: { experimental: { disable_paste_summary: true } }, path: ["experimental", "disable_paste_summary"] },
  { key: "experimental.primary_tools", disposition: "native-unsupported", input: { experimental: { primary_tools: true } }, path: ["experimental", "primary_tools"] },
  { key: "experimental.continue_loop_on_deny", disposition: "native-unsupported", input: { experimental: { continue_loop_on_deny: true } }, path: ["experimental", "continue_loop_on_deny"] },

  // --- Refused: accepted by neither schema; ignored with a configuration normalization diagnostic. ---
  { key: "console", disposition: "refused", input: { console: { diff_style: "split" } }, path: ["console"], message: "ignored console; Kilo Console settings are not carried on this build" },
  { key: "experimental.semantic_indexing", disposition: "refused", input: { experimental: { semantic_indexing: true } }, path: ["experimental", "semantic_indexing"], message: "ignored retired experimental.semantic_indexing; use indexing.enabled instead" },
  { key: "experimental.codebase_search", disposition: "refused", input: { experimental: { codebase_search: true } }, path: ["experimental", "codebase_search"], message: "ignored retired experimental.codebase_search" },
  { key: "experimental.shared_agent_board", disposition: "refused", input: { experimental: { shared_agent_board: true } }, path: ["experimental", "shared_agent_board"], message: "ignored retired experimental.shared_agent_board; use the top-level shared_agent_board key instead" },

  // --- Dropped: no v2 caller or out of scope, not carried. ---
  { key: "experimental.sandbox", disposition: "dropped", input: { experimental: { sandbox: true } }, path: ["experimental", "sandbox"] },
  { key: "experimental.sandbox_restrict_network", disposition: "dropped", input: { experimental: { sandbox_restrict_network: true } }, path: ["experimental", "sandbox_restrict_network"] },
  { key: "experimental.sandbox_writable_paths", disposition: "dropped", input: { experimental: { sandbox_writable_paths: ["/tmp"] } }, path: ["experimental", "sandbox_writable_paths"] },
  { key: "experimental.image_generation", disposition: "dropped", input: { experimental: { image_generation: true } }, path: ["experimental", "image_generation"] },
  { key: "experimental.image_generation_model", disposition: "dropped", input: { experimental: { image_generation_model: "openrouter/auto" } }, path: ["experimental", "image_generation_model"] },
  { key: "experimental.speech_to_text_model", disposition: "dropped", input: { experimental: { speech_to_text_model: "x" } }, path: ["experimental", "speech_to_text_model"] },
  { key: "experimental.speech_to_text_base_url", disposition: "dropped", input: { experimental: { speech_to_text_base_url: "https://x" } }, path: ["experimental", "speech_to_text_base_url"] },
  { key: "experimental.speech_to_text_api_key", disposition: "dropped", input: { experimental: { speech_to_text_api_key: "k" } }, path: ["experimental", "speech_to_text_api_key"] },

  // --- Open: owned by another epic, undecided here. Reported in the PR. ---
  { key: "indexing", disposition: "open", input: { indexing: { enabled: true } }, note: "#15308 memory and indexing (M2)" },
  { key: "compaction.threshold_percent", disposition: "open", input: { compaction: { threshold_percent: 80 } }, path: ["compaction", "threshold_percent"], note: "#15300 session policy maps it to compaction.buffer" },
  { key: "experimental.native_notebook_tools", disposition: "open", input: { experimental: { native_notebook_tools: true } }, path: ["experimental", "native_notebook_tools"], note: "#15302 tools" },
  { key: "experimental.code_mode", disposition: "open", input: { experimental: { code_mode: true } }, path: ["experimental", "code_mode"], note: "#15302 tools" },
]

function leaf(value: unknown, path: readonly string[]) {
  let node: unknown = value
  for (const key of path) {
    if (!node || typeof node !== "object") return undefined
    node = (node as Record<string, unknown>)[key]
  }
  return node
}

for (const c of cases) {
  test(`${c.disposition}: ${c.key}`, () => {
    const path = c.path ?? [c.key]
    const normalized = ConfigNormalize.normalize(c.input)
    expect(normalized.type).toBe("normalized")
    if (normalized.type !== "normalized") return
    const diagnostics = [...normalized.diagnostics]
    const parsed = KiloConfigPolicy.parse(c.input, normalized.encoded, (diagnostic) => diagnostics.push(diagnostic))
    const at = (diagnostics: readonly ConfigNormalize.Diagnostic[]) =>
      diagnostics.filter((diagnostic) => diagnostic.path.join(".") === path.join("."))
    switch (c.disposition) {
      case "folded":
        expect(leaf(parsed, path)).toEqual(c.value)
        break
      case "native":
        expect(leaf(normalized.encoded, path)).toEqual(c.value)
        break
      case "native-unsupported":
        expect(at(diagnostics)).toContainEqual({ kind: "unsupported", path, message: unsupported })
        break
      case "refused":
        expect(at(diagnostics)).toContainEqual({ kind: "unsupported", path, message: c.message })
        break
      case "dropped":
      case "open":
        expect(leaf(parsed, path)).toBeUndefined()
        expect(leaf(normalized.encoded, path)).toBeUndefined()
        expect(at(diagnostics)).toHaveLength(0)
        break
    }
  })
}

test("every v1 Kilo key has a decided disposition", () => {
  const keys = cases.map((c) => c.key)
  expect(new Set(keys).size).toBe(keys.length)
  expect(cases.every((c) => c.disposition !== "open" || c.note)).toBe(true)
})
