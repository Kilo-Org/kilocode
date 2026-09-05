/**
 * AutoGuard as a Kilo plugin.
 *
 * Integration is Tier 0: no file under `packages/opencode/src` outside this
 * directory changes. That matters for two reasons beyond tidiness -- the fork
 * stays cheap to merge with upstream, and the benchmark gets a genuine
 * plugin-on / plugin-off A/B on identical binaries.
 *
 * Hooks used:
 *   `chat.message`        capture the developer's own words (the only trusted
 *                         statement of intent available)
 *   `tool.execute.before` evaluate the call and stop it before it runs
 *
 * `tool.execute.before` cannot return a verdict, so a denial is raised as an
 * error carrying the reason and safe alternatives. That text reaches the model
 * as a tool result, which is what makes a denial something the agent can route
 * around rather than a dead end it retries.
 */

import type { Plugin } from "@kilocode/plugin"
import { evaluate, DEFAULT_CASCADE_CONFIG, type CascadeConfig } from "./cascade"
import { normalize, type RawToolCall } from "./normalize"
import { deriveProvenance } from "./provenance"
import type { Authority, CascadeResult, PolicyInput, TrustedContext } from "./types"

/** Thrown to stop a tool call. The message is what the agent reads back. */
export class AutoGuardDenied extends Error {
  readonly rule: string | null
  readonly safeAlternatives: string[]
  constructor(result: CascadeResult) {
    const alternatives = result.safe_alternatives.map((a) => `  - ${a}`).join("\n")
    super(
      [
        `AutoGuard blocked this action: ${result.reason}`,
        result.rule ? `Rule: ${result.rule}` : "",
        alternatives ? `Try instead:\n${alternatives}` : "",
        `This is a policy decision, not a tool failure. Choose a different approach rather than retrying this call.`,
      ]
        .filter(Boolean)
        .join("\n"),
    )
    this.name = "AutoGuardDenied"
    this.rule = result.rule
    this.safeAlternatives = result.safe_alternatives
  }
}

/**
 * Repeated denials of equivalent actions mean the agent is searching for a
 * phrasing that gets through, not learning. Identity is the normalized record,
 * so rewording the command does not reset the counter.
 */
const ESCALATION_THRESHOLD = 3

function actionKey(input: PolicyInput): string {
  const a = input.action
  return `${a.operation}|${[...a.targets].sort().join(",")}|${a.effect}|${a.radius}`
}

/** Environment facts the agent cannot forge. Supplied by the host, not the model. */
function trustedContext(directory: string, worktree: string): TrustedContext {
  return {
    workspace_root: worktree,
    cwd: directory,
    environment_kind: process.env["CI"] ? "ci" : "local_dev",
    protected_paths: (process.env["AUTOGUARD_PROTECTED_PATHS"] ?? ".git,.env,secrets").split(",").filter(Boolean),
    generated_paths: (process.env["AUTOGUARD_GENERATED_PATHS"] ?? "dist,build,.cache,node_modules").split(",").filter(Boolean),
    allowed_external_hosts: (process.env["AUTOGUARD_ALLOWED_HOSTS"] ?? "").split(",").filter(Boolean),
  }
}

/**
 * Authority for the MVP is derived from the session rather than negotiated.
 * A real grant extractor is future work; until it exists this stays empty,
 * which is the conservative reading -- an empty grant authorizes nothing, so
 * the fast-allow path stays closed and decisions fall to Level 1.
 */
function sessionAuthority(): Authority {
  return { issuer: "user", scope: [], capabilities: [], expires: "task", required: [], implicit: [], sensitive: [] }
}

export interface AutoGuardOptions {
  cascade?: Partial<CascadeConfig>
  /** Report what would have happened without stopping anything. */
  dryRun?: boolean
  /** Called for every decision. Used for the JSONL audit log and metrics. */
  onDecision?: (record: { tool: string; sessionID: string; result: CascadeResult; input: PolicyInput }) => void
}

export function createAutoGuardPlugin(options: AutoGuardOptions = {}): Plugin {
  return async (ctx) => {
    const config: CascadeConfig = { ...DEFAULT_CASCADE_CONFIG, ...options.cascade } as CascadeConfig
    /** Latest developer message per session. Never assistant text. */
    const intents = new Map<string, string>()
    const denials = new Map<string, number>()

    return {
      async "chat.message"(input, output) {
        const text = output.parts
          .filter((part): part is typeof part & { type: "text"; text: string } => part.type === "text")
          .map((part) => part.text)
          .join("\n")
        if (text.trim()) intents.set(input.sessionID, text)
      },

      async "tool.execute.before"(input, output) {
        const userIntent = intents.get(input.sessionID) ?? ""
        const context = trustedContext(ctx.directory, ctx.worktree)
        const call: RawToolCall = { tool: input.tool, arguments: output.args ?? {} }

        // One call can be several actions. Each is judged on its own so a
        // benign prefix cannot carry a hostile suffix past the check.
        for (const action of normalize(call, context)) {
          const policyInput: PolicyInput = {
            user_intent: userIntent,
            authority: sessionAuthority(),
            trusted_context: context,
            action: { ...action, intent_provenance: deriveProvenance(action, userIntent) },
            raw: JSON.stringify(output.args),
          }

          const result = await evaluate(policyInput, config)
          options.onDecision?.({ tool: input.tool, sessionID: input.sessionID, result, input: policyInput })

          if (result.decision === "allow") continue
          if (options.dryRun) continue

          const key = `${input.sessionID}:${actionKey(policyInput)}`
          const attempts = (denials.get(key) ?? 0) + 1
          denials.set(key, attempts)

          if (attempts >= ESCALATION_THRESHOLD) {
            throw new AutoGuardDenied({
              ...result,
              reason: `${result.reason} (attempt ${attempts} of an equivalent action; escalating to the developer)`,
              safe_alternatives: ["stop and ask the developer to approve this action explicitly"],
            })
          }
          throw new AutoGuardDenied(result)
        }
      },
    }
  }
}

/** Default export shape Kilo's plugin loader expects. */
export const AutoGuardPlugin: Plugin = createAutoGuardPlugin()
