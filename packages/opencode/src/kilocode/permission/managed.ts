import { decide, type MemberPolicy, type PolicyShell } from "@kilocode/kilo-gateway/permission-policy"
import { Wildcard } from "@opencode-ai/core/util/wildcard"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { Effect, Schema } from "effect"
import type { PolicyState } from "./managed-context"

export type Check = {
  permission: string
  patterns: readonly string[]
  managedShell?: PolicyShell
  agent?: string
  managedOnly?: boolean
  managedFallback?: boolean
  scope?: string
}

const dedicated = new Set([
  "agent_manager",
  "apply_patch",
  "bash",
  "board_post",
  "board_read",
  "browser_open",
  "edit",
  "glob",
  "grep",
  "lsp",
  "notebook_edit",
  "notebook_execute",
  "notebook_read",
  "read",
  "repo_clone",
  "repo_overview",
  "semantic_search",
  "skill",
  "task",
  "todowrite",
  "webfetch",
  "websearch",
  "write",
])

export function fallback(tool: string, builtin: boolean) {
  if (builtin && dedicated.has(tool)) return undefined
  if (tool === "apply_patch" || tool === "write") return "edit"
  return tool
}

export function enablesUnrestricted(rules?: PermissionV1.Ruleset) {
  return rules?.some((rule) => rule.permission === "*" && rule.pattern === "*" && rule.action === "allow") ?? false
}

const Reason = Schema.Literals([
  "unavailable",
  "unauthorized",
  "invalid",
  "update-required",
  "client-denied",
  "denied",
  "changed",
  "interactive-required",
])

export class Refused extends Schema.TaggedErrorClass<Refused>()("ManagedPermissionError", {
  reason: Reason,
  message: Schema.String,
}) {}

export function metadata(reason: Refused["reason"]) {
  return { managedPermission: { reason } }
}

export function refusal(reason: typeof Reason.Type, permission?: string) {
  const messages = {
    unavailable: "Organization permission policy is unavailable.",
    unauthorized: "Your account is not authorized to read this organization's permission policy.",
    invalid: "The organization permission policy response could not be validated.",
    "update-required": "Update Kilo to use this organization's permission policy.",
    "client-denied": "This client or version is not permitted by your organization.",
    denied: `Your organization or managed device policy does not allow ${permission ?? "this operation"}.`,
    changed: "Organization permission policy changed before execution. Retry the operation for a new authorization.",
    "interactive-required": "Organization permission policy requires interactive approval for this operation.",
  }
  return new Refused({ reason, message: messages[reason] })
}

export function publicState(state: PolicyState): PermissionV1.ManagedState {
  if (state.status === "personal" || state.status === "unavailable") return state
  return {
    status: state.status,
    organization: state.organization,
    revision: state.policy.revision,
    unrestricted: state.unrestricted,
  }
}

function decision(policy: MemberPolicy, input: Check) {
  return decide(
    policy,
    {
      tool: input.permission,
      resources: input.patterns.filter((pattern) => pattern !== "*"),
      shell:
        input.managedShell ??
        (input.permission === "bash" ? { kind: "unsupported", commands: [], uncertain: true } : undefined),
    },
    Wildcard.match,
  )
}

export const authorize = Effect.fn("Permission.managed")(function* (
  request: Check,
  policy: Effect.Effect<PolicyState>,
  mdm: () => Effect.Effect<readonly PermissionV1.Ruleset[]>,
) {
  const state = yield* policy
  if (state.status === "unavailable") return yield* refusal(state.reason)
  if (request.scope !== undefined && request.scope !== scope(state)) return yield* refusal("changed")
  if (state.status !== "active") return { state, ask: false, enforced: false }
  const action = decision(state.policy, request)
  if (action === "deny") return yield* refusal("denied", request.permission)
  const layers = yield* mdm()
  const patterns = request.patterns.length ? request.patterns : ["*"]
  const decisions = layers.flatMap((rules) =>
    patterns.map(
      (pattern) =>
        rules.findLast(
          (rule) => Wildcard.match(request.permission, rule.permission) && Wildcard.match(pattern, rule.pattern),
        )?.action,
    ),
  )
  if (decisions.includes("deny")) return yield* refusal("denied", request.permission)
  return {
    state,
    ask: action === "ask" || decisions.includes("ask"),
    enforced: action !== undefined || decisions.some((value) => value !== undefined),
  }
})

export function stamp(state: PolicyState) {
  if (state.status === "active" || state.status === "disabled") return state.stamp
  return state.status
}

export function scope(state: PolicyState) {
  if (state.status === "active" || state.status === "disabled") return state.scope
  return state.status
}
