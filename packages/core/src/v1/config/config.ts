export * as ConfigV1 from "./config"

import { Effect, Schema } from "effect"
import { NonNegativeInt, PositiveInt, type DeepMutable } from "../../schema"
import { ConfigExperimental } from "../../config/experimental"
import { ConfigAgentV1 } from "./agent"
import { ConfigAttachmentV1 } from "./attachment"
import { ConfigCommandV1 } from "./command"
import { ConfigFormatterV1 } from "./formatter"
import { ConfigLayoutV1 } from "./layout"
import { ConfigLSPV1 } from "./lsp"
import { ConfigMCPV1 } from "./mcp"
import { ConfigPermissionV1 } from "./permission"
import { ConfigPluginV1 } from "./plugin"
import { ConfigProviderV1 } from "./provider"
import { ConfigReferenceV1 } from "./reference"
import { ConfigServerV1 } from "./server"
import { ConfigSkillsV1 } from "./skills"
// kilocode_change start
import { ZodOverride } from "../../effect-zod"
import { IndexingConfig as KiloIndexingConfig, IndexingSchema as KiloIndexingSchema } from "@kilocode/kilo-indexing/config"
import z from "zod"
// kilocode_change end

export type Layout = ConfigLayoutV1.Layout

export const WellKnown = Schema.Struct({
  config: Schema.optional(Schema.Json),
  remote_config: Schema.optional(Schema.Json),
})

// kilocode_change start - indexing configuration
export const Indexing = KiloIndexingConfig
export type Indexing = z.infer<typeof Indexing>
// kilocode_change end

const LogLevelRef = Schema.Literals(["DEBUG", "INFO", "WARN", "ERROR"]).annotate({
  identifier: "LogLevel",
  description: "Log level",
})
const Percent = Schema.Number.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(100)) // kilocode_change

const IndexingRef = KiloIndexingSchema.annotate({ [ZodOverride]: KiloIndexingConfig }) // kilocode_change

// kilocode_change start
/** Schema for AI-generated commit message configuration. */
const CommitMessageSchema = Schema.optional(
  Schema.Struct({
    prompt: Schema.optional(Schema.String).annotate({
      description:
        "Custom system prompt for AI commit message generation. When set, replaces the default conventional commits prompt entirely.",
    }),
  }),
).annotate({ description: "Configuration for AI-generated commit messages" })
// kilocode_change end

export const Info = Schema.Struct({
  $schema: Schema.optional(Schema.String).annotate({
    description: "JSON schema reference for configuration validation",
  }),
  shell: Schema.optional(Schema.String).annotate({ description: "Default shell to use for terminal and bash tool" }),
  logLevel: Schema.optional(LogLevelRef).annotate({ description: "Log level" }),
  server: Schema.optional(ConfigServerV1.Server).annotate({
    description: "Server configuration for the kilo serve command", // kilocode_change
  }),
  command: Schema.optional(Schema.Record(Schema.String, ConfigCommandV1.Info)).annotate({
    description: "Command configuration, see https://kilo.ai/docs/customize/workflows", // kilocode_change
  }),
  skills: Schema.optional(ConfigSkillsV1.Info).annotate({ description: "Additional skill folder paths" }),
  reference: Schema.optional(ConfigReferenceV1.Info).annotate({
    description: "Named git or local directory references that can be mentioned as @alias or @alias/path",
  }),
  watcher: Schema.optional(Schema.Struct({ ignore: Schema.optional(Schema.mutable(Schema.Array(Schema.String))) })),
  snapshot: Schema.optional(Schema.Boolean).annotate({
    description:
      "Enable or disable snapshot tracking. When false, filesystem snapshots are not recorded and undoing or reverting will not undo/redo file changes. Defaults to true.",
  }),
  plugin: Schema.optional(Schema.mutable(Schema.Array(ConfigPluginV1.Spec))),
  share: Schema.optional(Schema.Literals(["manual", "auto", "disabled"])).annotate({
    description:
      "Control sharing behavior:'manual' allows manual sharing via commands, 'auto' enables automatic sharing, 'disabled' disables all sharing",
  }),
  autoshare: Schema.optional(Schema.Boolean).annotate({
    description: "@deprecated Use 'share' field instead. Share newly created sessions automatically",
  }),
  autoupdate: Schema.optional(Schema.Union([Schema.Boolean, Schema.Literal("notify")])).annotate({
    description:
      "Automatically update to the latest version. Set to true to auto-update, false to disable, or 'notify' to show update notifications",
  }),
  disabled_providers: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description: "Disable providers that are loaded automatically",
  }),
  enabled_providers: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description: "When set, ONLY these providers will be enabled. All other providers will be ignored",
  }),
  // kilocode_change start
  // NOTE: Any new kilocode_change key added to Config.Info must also be mirrored in
  // apps/web/src/app/config.json/extras.ts in the cloud repo, otherwise
  // $schema: https://app.kilo.ai/config.json will not recognize it.
  remote_control: Schema.optional(Schema.Boolean).annotate({
    description: "Enable remote control of sessions via Kilo Cloud. Equivalent to running /remote on startup.",
  }),
  auto_collapse_reasoning: Schema.optional(Schema.Boolean).annotate({
    description: "Automatically collapse reasoning blocks after the agent finishes writing them",
  }),
  indexing: Schema.optional(IndexingRef).annotate({ description: "Codebase indexing configuration" }),
  console: Schema.optional(
    Schema.Struct({
      context_sidebar_width: Schema.optional(
        Schema.Int.check(Schema.isBetween({ minimum: 250, maximum: 800 })).annotate({
          description: "Width of the Kilo Console project context sidebar in pixels",
        }),
      ),
      diff_style: Schema.optional(Schema.Literals(["unified", "split"])).annotate({
        description: "Default diff layout in Kilo Console project reviews",
      }),
    }),
  ).annotate({ description: "Kilo Console user interface configuration" }),
  terminal_command_display: Schema.optional(Schema.Literals(["expanded", "collapsed"])).annotate({
    description: "Controls whether terminal command blocks are expanded or collapsed by default in the VS Code chat UI",
  }),
  code_edit_display: Schema.optional(Schema.Literals(["expanded", "collapsed"])).annotate({
    description:
      "Controls whether code edit and diff blocks are expanded or collapsed by default in the VS Code chat UI",
  }),
  hide_prompt_training_models: Schema.optional(Schema.Boolean).annotate({
    description: "Hide Kilo Gateway models that may train on your prompts from model listings",
  }),
  sandbox: Schema.optional(
    Schema.Struct({
      enabled: Schema.optional(
        Schema.Boolean.annotate({ description: "Enable sandbox confinement for new sessions (default: false)" }),
      ),
      network: Schema.optional(
        Schema.Literals(["allow", "deny"]).annotate({
          description: "Control outbound network access from sandboxed tools (default: deny)",
        }),
      ),
      writable_paths: Schema.optional(
        Schema.mutable(Schema.Array(Schema.String)).annotate({
          description: "Additional filesystem paths that sandboxed tools may write to",
        }),
      ),
      allowed_hosts: Schema.optional(
        Schema.mutable(Schema.Array(Schema.String)).annotate({
          description: "Exact network destinations sandboxed tools may access while network restriction is enabled",
        }),
      ),
    }).annotate({ description: "Sandbox configuration for agent tools" }),
  ),
  model: Schema.optional(Schema.NullOr(Schema.String)).annotate({
    description: "Model to use in the format of provider/model, eg anthropic/claude-2",
  }),
  small_model: Schema.optional(Schema.NullOr(Schema.String)).annotate({
    description: "Small model to use for tasks like title generation in the format of provider/model",
  }),
  subagent_model: Schema.optional(Schema.NullOr(Schema.String)).annotate({
    description:
      "Default model for task-tool subagents in the format of provider/model. If unset or unavailable, subagents inherit the calling agent model.",
  }),
  subagent_variant: Schema.optional(Schema.NullOr(Schema.String)).annotate({
    description: "Default model variant for task-tool subagents when subagent_model is configured.",
  }),
  subagent_variant_overrides: Schema.optional(
    Schema.NullOr(Schema.Record(Schema.String, Schema.NullOr(Schema.String))),
  ).annotate({
    description:
      "Model-specific variant overrides for task-tool subagents, keyed by provider/model. Valid overrides take precedence over saved, agent-specific, and inherited variants.",
  }),
  default_agent: Schema.optional(Schema.NullOr(Schema.String)).annotate({
    description:
      "Default agent to use when none is specified. Must be a primary agent. Falls back to 'code' if not set or if the specified agent is invalid.",
  }),
  // kilocode_change end
  username: Schema.optional(Schema.String).annotate({
    description: "Custom username to display in conversations instead of system username",
  }),
  mode: Schema.optional(
    Schema.StructWithRest(
      Schema.Struct({ build: Schema.optional(ConfigAgentV1.Info), plan: Schema.optional(ConfigAgentV1.Info) }),
      [Schema.Record(Schema.String, ConfigAgentV1.Info)],
    ),
  ).annotate({ description: "@deprecated Use `agent` field instead." }),
  agent: Schema.optional(
    Schema.StructWithRest(
      Schema.Struct({
        // primary
        plan: Schema.optional(ConfigAgentV1.Info),
        build: Schema.optional(ConfigAgentV1.Info),
        // kilocode_change start
        debug: Schema.optional(ConfigAgentV1.Info),
        orchestrator: Schema.optional(ConfigAgentV1.Info),
        ask: Schema.optional(ConfigAgentV1.Info),
        // kilocode_change end
        // subagent
        general: Schema.optional(ConfigAgentV1.Info),
        explore: Schema.optional(ConfigAgentV1.Info),
        scout: Schema.optional(ConfigAgentV1.Info),
        // specialized
        title: Schema.optional(ConfigAgentV1.Info),
        summary: Schema.optional(ConfigAgentV1.Info),
        compaction: Schema.optional(ConfigAgentV1.Info),
      }),
      [Schema.Record(Schema.String, ConfigAgentV1.Info)],
    ),
    // kilocode_change start
  ).annotate({ description: "Agent configuration, see https://kilo.ai/docs/customize/custom-subagents" }), // kilocode_change
  provider: Schema.optional(Schema.Record(Schema.String, Schema.NullOr(ConfigProviderV1.Info))).annotate({
    // kilocode_change end
    description: "Custom provider configurations and model overrides",
  }),
  mcp: Schema.optional(
    Schema.Record(Schema.String, Schema.Union([ConfigMCPV1.Info, Schema.Struct({ enabled: Schema.Boolean })])),
  ).annotate({ description: "MCP (Model Context Protocol) server configurations" }),
  formatter: Schema.optional(ConfigFormatterV1.Info).annotate({
    description:
      "Enable or configure formatters. Omit or set to false to disable, true to enable built-ins, or an object to enable built-ins with overrides.",
  }),
  lsp: Schema.optional(ConfigLSPV1.Info).annotate({
    description:
      "Enable or configure LSP servers. Omit or set to false to disable, true to enable built-ins, or an object to enable built-ins with overrides.",
  }),
  instructions: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description: "Additional instruction files or patterns to include",
  }),
  layout: Schema.optional(ConfigLayoutV1.Layout).annotate({ description: "@deprecated Always uses stretch layout." }),
  permission: Schema.optional(ConfigPermissionV1.Info),
  tools: Schema.optional(Schema.Record(Schema.String, Schema.Boolean)),
  attachment: Schema.optional(ConfigAttachmentV1.Info).annotate({
    description: "Attachment processing configuration, including image size limits and resizing behavior",
  }),
  enterprise: Schema.optional(
    Schema.Struct({ url: Schema.optional(Schema.String).annotate({ description: "Enterprise URL" }) }),
  ),
  commit_message: CommitMessageSchema, // kilocode_change
  tool_output: Schema.optional(
    Schema.Struct({
      max_lines: Schema.optional(PositiveInt).annotate({
        description: "Maximum lines of tool output before it is truncated and saved to disk (default: 2000)",
      }),
      max_bytes: Schema.optional(PositiveInt).annotate({
        description: "Maximum bytes of tool output before it is truncated and saved to disk (default: 51200)",
      }),
    }),
  ).annotate({
    description:
      "Thresholds for truncating tool output. When output exceeds either limit, the full text is written to the truncation directory and a preview is returned.",
  }),
  compaction: Schema.optional(
    Schema.Struct({
      auto: Schema.optional(Schema.Boolean).annotate({
        description: "Enable automatic compaction when context is full (default: true)",
      }),
      // kilocode_change start
      threshold_percent: Schema.optional(Schema.NullOr(Percent)).annotate({
        description:
          "Percentage of the model input/context window that triggers automatic compaction. The reserved safety buffer still applies if it would compact sooner.",
      }),
      // kilocode_change end
      prune: Schema.optional(Schema.Boolean).annotate({
        description: "Enable pruning of old tool outputs (default: true)",
      }),
      tail_turns: Schema.optional(NonNegativeInt).annotate({
        description:
          "Number of recent user turns, including their following assistant/tool responses, to keep verbatim during compaction (default: 2)",
      }),
      preserve_recent_tokens: Schema.optional(NonNegativeInt).annotate({
        description: "Maximum number of tokens from recent turns to preserve verbatim after compaction",
      }),
      reserved: Schema.optional(NonNegativeInt).annotate({
        description: "Token buffer for compaction. Leaves enough window to avoid overflow during compaction.",
      }),
    }),
  ),
  experimental: Schema.optional(
    Schema.Struct({
      disable_paste_summary: Schema.optional(Schema.Boolean),
      batch_tool: Schema.optional(Schema.Boolean).annotate({ description: "Enable the batch tool" }),
      // kilocode_change start
      codebase_search: Schema.optional(Schema.Boolean).annotate({ description: "Enable AI-powered codebase search" }),
      image_generation: Schema.optional(Schema.Boolean).annotate({ description: "Enable AI image generation" }),
      image_generation_model: Schema.optional(Schema.String).annotate({
        description: "Model ID to use for image generation (default: openrouter/auto)",
      }),
      agent_requirements: Schema.optional(Schema.Boolean).annotate({
        description: "Require declared agent skills, MCPs, and VS Code extensions before VS Code prompts can run",
      }),
      native_notebook_tools: Schema.optional(Schema.Boolean).annotate({
        description: "Enable native tools for reading, editing, and executing VS Code notebooks",
      }),
      speech_to_text_model: Schema.optional(Schema.String).annotate({
        description: "Speech-to-text transcription model ID to use for voice input",
      }),
      openTelemetry: Schema.Boolean.pipe(Schema.optional, Schema.withDecodingDefault(Effect.succeed(true))).annotate({
        description: "Enable telemetry. Set to false to opt-out.",
      }),
      // kilocode_change end
      primary_tools: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
        description: "Tools that should only be available to primary agents.",
      }),
      continue_loop_on_deny: Schema.optional(Schema.Boolean).annotate({
        description: "Continue the agent loop when a tool call is denied",
      }),
      // kilocode_change start
      sandbox: Schema.optional(Schema.Boolean).annotate({
        description:
          "Run agent tools inside a sandbox that restricts writes to project and Kilo state directories and can restrict outbound network access",
      }),
      sandbox_restrict_network: Schema.optional(Schema.Boolean).annotate({
        description:
          "Restrict outbound network access for model-originated commands and first-party HTTP tools; local MCP servers and plugin hooks are not covered (default: true)",
      }),
      sandbox_writable_paths: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
        description:
          "Additional filesystem paths the sandbox allows writes to (e.g. ['/tmp', '/var/log']). These are merged with the default writable paths when the sandbox is active.",
      }),
      swe_pruner: Schema.optional(Schema.Boolean).annotate({
        description:
          "Enable SWE-Pruner: task-aware pruning of large read, grep, and bash tool outputs guided by a focus question provided by the agent (default: false)",
      }),
      swe_pruner_model: Schema.optional(Schema.String).annotate({
        description:
          'Model used by SWE-Pruner to skim tool outputs, in "provider/model" format (default: the configured small model)',
      }),
      // kilocode_change end
      mcp_timeout: Schema.optional(PositiveInt).annotate({
        description: "Timeout in milliseconds for model context protocol (MCP) requests",
      }),
      policies: Schema.optional(Schema.mutable(Schema.Array(ConfigExperimental.Policy))).annotate({
        description: "Policy statements applied to supported resources, such as provider access",
      }),
    }),
  ),
}).annotate({ identifier: "Config" })

export type Info = DeepMutable<Schema.Schema.Type<typeof Info>>
