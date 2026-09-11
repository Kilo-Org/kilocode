import type { ScriptedAnswer } from "./scripted"
import { Global } from "@opencode-ai/core/global"
import type { Plugin } from "@kilocode/plugin"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { Controller, register, stateRoot, supported } from "./controller"
import type { CascadeConfig } from "./cascade"
import type { AuditEvent, CascadeResult, PolicyInput, TrustedContext } from "./types"

export class AutoGuardDenied extends Error {
  readonly rule: string | null
  readonly safeAlternatives: string[]
  constructor(result: CascadeResult) {
    super(
      `AutoGuard blocked this action: ${result.reason}\nRule: ${result.rule}\nTry instead:\n${result.safe_alternatives.map((x) => `  - ${x}`).join("\n")}\nThis is a policy decision, not a tool failure. Choose a different approach rather than retrying this call.`,
    )
    this.name = "AutoGuardDenied"
    this.rule = result.rule
    this.safeAlternatives = result.safe_alternatives
  }
}
export interface AutoGuardOptions {
  cascade?: Partial<CascadeConfig>
  dryRun?: boolean
  observe?: boolean
  scripted?: ScriptedAnswer[]
  extractor?: boolean
  state?: string
  audit?: string
  context?: Partial<TrustedContext>
  onEvent?: (event: AuditEvent) => void
  onDecision?: (record: { tool: string; sessionID: string; result: CascadeResult; input: PolicyInput }) => void
}
const entries = (name: string, fallback = "") =>
  (process.env[name] ?? fallback)
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
export function createAutoGuardPlugin(options: AutoGuardOptions = {}): Plugin {
  return async (ctx) => {
    const state = options.state ?? stateRoot()
    const generated = entries("AUTOGUARD_GENERATED_PATHS")
    const context: TrustedContext = {
      workspace_root: ctx.worktree,
      cwd: ctx.directory,
      environment_kind: process.env.CI ? "ci" : "local_dev",
      protected_paths: entries("AUTOGUARD_PROTECTED_PATHS", ".git,.env,secrets"),
      generated_paths: generated,
      allowed_external_hosts: entries("AUTOGUARD_ALLOWED_HOSTS"),
      catalog: {
        source: entries("AUTOGUARD_SOURCE_PATHS"),
        verification: entries("AUTOGUARD_TEST_PATHS"),
        generated_output: generated,
      },
      test_profile: {
        environment: { TMPDIR: Global.Path.tmp },
        trusted_code: process.env.AUTOGUARD_TRUST_TESTS === "1",
      },
      ...options.context,
    }
    const controller = new Controller({
      context,
      state,
      audit: options.audit ?? process.env.AUTOGUARD_AUDIT_PATH ?? path.join(state, "audit", `${randomUUID()}.jsonl`),
      cascade: options.cascade,
      extractor: options.extractor,
      observe: options.observe ?? options.dryRun,
      scripted: options.scripted,
      onDecision: options.onDecision,
      onEvent: options.onEvent,
    })
    const dispose = register(ctx.directory, controller)
    return {
      dispose: async () => dispose(),
      async "chat.message"(input, output) {
        const text = output.parts
          .filter(
            (part): part is typeof part & { type: "text"; text: string } =>
              part.type === "text" && !("synthetic" in part && part.synthetic),
          )
          .map((part) => part.text)
          .join("\n")
        if (text.trim())
          await controller.message(input.sessionID, { id: input.messageID ?? output.message.id ?? randomUUID(), text })
      },
      async "tool.execute.before"() {
        if (!supported())
          throw new Error("AutoGuard requires the Kilo v2 runtime adapter; refusing unguarded execution")
      },
      // Evaluation occurs in the host adapter after ALL before hooks have finalized arguments.
    }
  }
}
export const AutoGuardPlugin: Plugin = createAutoGuardPlugin()
