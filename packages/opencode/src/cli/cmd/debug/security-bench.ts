// kilocode_change - new file
import { EOL } from "os"
import fs from "fs/promises"
import { Effect } from "effect"
import { Config } from "@/config/config"
import { Provider } from "@/provider/provider"
import { InstanceState } from "@/effect/instance-state"
import { ShellPermission } from "@/tool/shell"
import type { Permission } from "@/permission"
import { MessageID, SessionID } from "@/session/schema"
import { SecurityDecisionAdapter } from "@/kilocode/security-decision/adapter"
import { SecurityReviewer } from "@/kilocode/security-decision/reviewer"
import { SecurityReviewerBinding } from "@/kilocode/security-decision/reviewer-binding"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { effectCmd } from "../../effect-cmd"

/**
 * Live benchmark for the security reviewer.
 *
 * It runs inside the real runtime, so the model, provider and LLM services are the ones the feature
 * actually uses. Commands are only ever *scanned* — `ShellPermission.ask` parses and asks, it never
 * executes — which is what makes an adversarial corpus safe to measure.
 *
 * Two numbers matter, and only one is about safety. Exposure is decided deterministically before any
 * model runs, so an adversarial corpus must reach zero exposure whatever is bound; what a model
 * changes is the autonomy it buys on benign traffic, and how reliably.
 */

type Row = { command: string; state: SecurityReviewer.State; reason?: string; ms: number }

const containment = { sandbox: "operational", network: "deny", destinations: [], escalated: false } as const

function percentile(values: number[], p: number) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!
}

export const SecurityBenchCommand = effectCmd({
  command: "security-bench <corpus>",
  describe: "measure the security reviewer against a corpus of shell commands",
  builder: (yargs) =>
    yargs
      .positional("corpus", { type: "string", describe: "file with one shell command per line" })
      .option("label", { type: "string", describe: "name for this run", default: "corpus" }),
  handler: (args: { corpus?: string; label: string }) =>
    run(args).pipe(Effect.provide(AppNodeBuilder.build(CrossSpawnSpawner.node))),
})

const run = Effect.fn("Cli.debug.securityBench")(function* (args: { corpus?: string; label: string }) {
    const corpusPath = args.corpus!
    const config = yield* Config.Service
    const provider = yield* Provider.Service
    const permission = yield* ShellPermission
    const instance = yield* InstanceState.context

    const outcome = yield* SecurityReviewerBinding.install(config, provider)
    process.stdout.write(`reviewer: ${JSON.stringify(outcome)}${EOL}`)

    const text = yield* Effect.promise(() => fs.readFile(corpusPath, "utf8"))
    const corpus = text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"))

    const rows: Row[] = []
    let exposed = 0
    const rules = new Map<string, number>()

    for (const command of corpus) {
      const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
      const ctx = {
        sessionID: SessionID.make("ses_bench"),
        messageID: MessageID.make("msg_bench"),
        callID: "",
        agent: "code",
        abort: AbortSignal.any([]),
        messages: [],
        metadata: () => Effect.void,
        ask: (req: Omit<Permission.Request, "id" | "sessionID" | "tool">) =>
          Effect.sync(() => {
            requests.push(req)
          }),
      }
      yield* permission
        .ask(ctx as never, { command, cwd: instance.directory, shell: "/bin/bash" })
        .pipe(Effect.catchCause(() => Effect.void))
      const bash = requests.find((item) => item.permission === "bash")

      const directive = SecurityDecisionAdapter.evaluate(
        {
          permission: "bash",
          patterns: bash?.patterns ?? [command],
          metadata: bash?.metadata ?? {},
          sessionID: "ses_bench",
        },
        {
          workspace: instance.directory,
          effective: "allow",
          humanOnly: false,
          floor: { action: "allow", authority: "untrusted", conflict: false },
          containment,
        },
      )
      rules.set(directive.rule_id, (rules.get(directive.rule_id) ?? 0) + 1)
      if (directive.decision !== "ask" || !directive.reviewable || !directive.review) continue

      exposed++
      const reviewed = yield* SecurityReviewer.review(
        {
          decision: directive.decision,
          reason: directive.audit.reason,
          rule_id: directive.rule_id,
          requirements: directive.audit.requirements,
          reviewable: directive.reviewable,
        },
        directive.review,
      )
      rows.push({
        command,
        state: reviewed.outcome.state,
        ...(reviewed.outcome.reason_code ? { reason: reviewed.outcome.reason_code } : {}),
        ms: reviewed.outcome.latency_ms ?? 0,
      })
    }

    const by = (state: string) => rows.filter((row) => row.state === state).length
    const malformed = rows.filter((row) => row.reason === "INVALID_RESPONSE").length
    const latency = rows.map((row) => row.ms)
    const model = process.env["KILO_SECURITY_REVIEWER_MODEL"] ?? "(unbound)"

    const lines = [
      "",
      `### ${args.label} — model ${model}`,
      `  corpus            ${corpus.length}`,
      `  exposed           ${exposed}  ${((exposed / Math.max(1, corpus.length)) * 100).toFixed(0)}%`,
      `  allow             ${by("allow")}`,
      `  keep_ask          ${by("keep_ask")}  (malformed ${malformed})`,
      `  timeout           ${by("timeout")}`,
      `  error             ${by("error")}`,
      `  latency p50/p95   ${percentile(latency, 50)}ms / ${percentile(latency, 95)}ms`,
      "  rules:",
      ...[...rules].sort((a, b) => b[1] - a[1]).map(([id, count]) => `    ${String(count).padStart(3)}  ${id}`),
      "  allowed:",
      ...rows.filter((row) => row.state === "allow").map((row) => `    ${row.command}   [${row.reason ?? ""}]`),
      "  kept:",
      ...rows
        .filter((row) => row.state !== "allow")
        .map((row) => `    ${row.command}   [${row.state}/${row.reason ?? ""}]`),
      "",
    ]
    process.stdout.write(lines.join(EOL))
})
