import { KiloAgentPlugin } from "./agent"
import { KiloAgentRemovePlugin } from "./agent/plugin"
// The plan file, the plan_exit tool and the post-plan follow-up question live in one plugin.
import { KiloPlanPlugin } from "./plan"
// The native `/goal` plus v1's agent-started goals; the host removes the native goal plugin.
import { KiloGoal } from "./goal"
import { KiloBranchNamePlugin } from "./branch-name"
import { KiloCommitMessagePlugin } from "./commit-message"
// kilo_port(gateway:17e39e074eaf) v1 registered the Gateway auth plugin in the upstream plugin list.
import { KiloGatewayPlugin } from "./gateway"
import { OpencodeFreeTier } from "./gateway/opencode"
import { KiloGatewayPolicyPlugin } from "./gateway/policy"
import { GatewayOptions } from "./gateway/options"
import { KiloHandshakePlugin } from "./handshake"
// kilo_port(provider-usage:ce8e021f1ef6) v1 imported the ProviderUsage Location service into location-services.ts.
import { KiloProviderUsagePlugin } from "./provider-usage"
import { KiloReadPlugin } from "./read"
import { KiloRequestIdentity } from "./request-identity"
import { KiloOpenAIPlugin } from "./openai"
import { KiloMarketplacePlugin } from "./marketplace"
import { KiloSessionSync } from "./session-sync"
import { KiloRemote } from "./remote"

export { KiloSessionSync }
export { KiloRemote }
import { KiloPrivacyPlugin } from "./privacy"
import { KiloFlowPlugin } from "./flow"
import { KiloSettingsPlugin } from "./settings"
import { KiloSkillPlugin } from "./skill"
import { KiloSkillConfigPlugin } from "./skill/config"
import { KiloTodoPlugin } from "./todo"
import { KiloBrowserToolPlugin } from "./browser"
import { KiloChartPlugin } from "./chart"
import { KiloWriteToolPlugin } from "./tool-write"
// kilo_port(notebook:91a426486dc8) v1 registered the notebook tools and service from the shared server.
import { KiloNotebookPlugin } from "./notebook"
import { KiloReview } from "./review"
import { KiloQuestionPlugin } from "./question"
import { KiloWakeupPlugin } from "./wakeup"
// kilo_port(agent-manager:648a508ad347) the protection guard now lives in the Agent Manager plugin.
import { KiloAgentManagerPlugin } from "./agent-manager"
import { KiloBackgroundJobs } from "./background-jobs"
import { KiloSessionDrain } from "./session-drain"
import { KiloSubagentBackgroundPlugin } from "./subagent-background"
import { KiloRecallPlugin } from "./recall"
import { KiloIndexingPlugin } from "./indexing"
import { KiloSandbox } from "./sandbox"
import { KiloBoard } from "./board"
import { KiloSoulPlugin } from "./soul"

export { KiloSandbox }

/**
 * The Kilo plugins on the public plugin API (plugin-first rung 1), in registration order. The Kilo host
 * (`packages/kilo-cli/src/host.ts`) registers each one through `SdkPlugins.register` and provides the
 * global core services that a plugin names in its requirements (the Gateway uses `Bus`, the agents use
 * `Global`). They run after the built-in plugins and before the config plugins.
 *
 * Add a ported Kilo feature here. A Kilo route group is a Kilo RPC: its contract is in
 * `packages/schema/src/kilocode/<feature>.ts`, its plugin registers the handlers with `ctx.rpc.register`, and the
 * server serves it at `POST /api/rpc/<rpc id>/<method>`, as for the Gateway and the handshake.
 */
// kilo_port(server:5e0f8563b425) v1 added the Kilo HttpApi groups to the upstream Api; v2 serves each Kilo group as
// the RPC of a plugin in this list.
export const KiloPlugins = [
  KiloHandshakePlugin,
  // v1 imported the Kilo agent module into agent.ts. kilo_port(agent:2e5632e7bfc6)
  KiloAgentPlugin.Plugin,
  // The plan_exit tool and the post-plan handoff question.
  KiloPlanPlugin,
  KiloGoal.Plugin,
  // The Kilo user agent on model requests to other providers. Before the Gateway, whose request headers are its
  // own, and before the config plugins, so a user plugin can still replace it.
  KiloRequestIdentity.Plugin,
  KiloGatewayPlugin,
  // v1 listed the ProviderUsage node in the Location services. kilo_port(provider-usage:b0945f511fb3)
  KiloProviderUsagePlugin,
  KiloOpenAIPlugin,
  KiloMarketplacePlugin,
  KiloFlowPlugin,
  KiloSessionSync.plugin,
  KiloRemote.plugin,
  KiloSkillPlugin,
  // Replaces the upstream OpenCode and report built-in skills with Kilo's config guide.
  KiloSkillConfigPlugin.Plugin,
  KiloAgentRemovePlugin,
  // Rung 1: names the extracted formats in the native read tool description. The host swaps the
  // reader behind it for the filesystem service (rung 2).
  KiloReadPlugin,
  KiloTodoPlugin,
  KiloWriteToolPlugin,
  KiloBrowserToolPlugin,
  KiloNotebookPlugin,
  // The chart tool and its skill, for the VS Code chat that draws the chart. It registers nothing elsewhere.
  KiloChartPlugin,
  KiloCommitMessagePlugin,
  KiloPrivacyPlugin,
  KiloSettingsPlugin,
  KiloBranchNamePlugin,
  KiloAgentManagerPlugin,
  // Per-job list, stop and continue-in-background for the subagents of one session.
  KiloBackgroundJobs.Plugin,
  // Waits until a session and the work it started have gone quiet. kilo_port(goals:b983b6af7e4b)
  KiloSessionDrain.Plugin,
  // Runs subagents in the background unless the call passes `background: false`.
  KiloSubagentBackgroundPlugin,
  KiloRecallPlugin,
  // v1 enabled codebase indexing through a built-in plugin entry. kilo_port(indexing:2e5dfe2574c6)
  KiloIndexingPlugin,
  // The Kilo review command replaces the built-in `review`. kilo_port(review:efc710228c1f)
  KiloReview.Plugin,
  KiloQuestionPlugin.Plugin,
  // Wakeups and cron tasks, and the pending state clients show as scheduled.
  KiloWakeupPlugin,
  // Kilo Swarm: the shared board of a main session and its subagents.
  KiloBoard.Plugin,
] as const

/** Kilo plugins that run after the config plugins: the host registers them with phase `post`. */
export const KiloPostPlugins = [
  KiloGatewayPolicyPlugin,
  KiloAgentPlugin.Ceiling,
  GatewayOptions.Plugin,
  OpencodeFreeTier.Plugin,
  // The default Kilo referer and title of the other providers, where config did not set its own.
  KiloRequestIdentity.Referer,
  // The sandbox wraps every tool, so it registers after the config plugins and their tools.
  KiloSandbox.Plugin,
  // Leads the system prompt with the Kilo persona, after every plugin that replaces the first system part.
  KiloSoulPlugin,
] as const
