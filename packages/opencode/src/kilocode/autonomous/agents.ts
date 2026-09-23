import { Permission } from "@/permission"
import * as Truncate from "@/tool/truncate"
import PROMPT_PLANNER from "./prompt/planner.txt"
import PROMPT_WORKER from "./prompt/worker.txt"
import PROMPT_REVIEWER from "./prompt/reviewer.txt"
import PROMPT_CHECKER from "./prompt/checker.txt"
import PROMPT_FINAL from "./prompt/final.txt"

/**
 * Engine agents. Registered only when `autonomous_goal.enabled` is set so
 * regular users never see them. All limits are permission rules, not prompt text.
 */
export namespace AutonomousAgents {
  export const PLANNER = "autonomous-planner"
  export const WORKER = "autonomous-worker"
  export const REVIEWER = "autonomous-reviewer"
  export const CHECKER = "autonomous-checker"
  export const FINAL = "autonomous-final"
  export const names = [PLANNER, WORKER, REVIEWER, CHECKER, FINAL] as const
  export type Name = (typeof names)[number]

  /** Commands a worker may never run, whatever the user config says. Applied last. */
  export const forbidden: Record<string, "deny"> = {
    "git push *": "deny",
    "git push": "deny",
    "git reset --hard *": "deny",
    "git clean *": "deny",
    "git checkout -- *": "deny",
    "git commit *": "deny",
    "git rebase *": "deny",
    "sudo *": "deny",
    "rm -rf *": "deny",
    "rm -fr *": "deny",
    "npm publish *": "deny",
    "npm publish": "deny",
    "pnpm publish *": "deny",
    "yarn publish *": "deny",
    "bun publish *": "deny",
    "cargo publish *": "deny",
    "terraform apply *": "deny",
    "terraform destroy *": "deny",
    "kubectl delete *": "deny",
    "kubectl apply *": "deny",
    "docker push *": "deny",
    "gh pr merge *": "deny",
    "gh release create *": "deny",
    "curl * | sh": "deny",
    "curl * | bash": "deny",
    "wget * | sh": "deny",
  }

  /** Tools no engine child may use: they need a human or spawn more agents. */
  const noHuman = Permission.fromConfig({
    // Every engine child replies through StructuredOutput; the "*" deny above would hide it.
    StructuredOutput: "allow",
    question: "deny",
    suggest: "deny",
    task: "deny",
    goal: "deny",
    goal_report: "deny",
    plan_enter: "deny",
    plan_exit: "deny",
    agent_manager: "deny",
    repo_clone: "deny",
    browser_open: "deny",
    kilo_memory_save: "deny",
    board_post: "deny",
  })

  const dirs = (whitelisted: string[]) => ({
    external_directory: {
      "*": "deny" as const,
      [Truncate.GLOB]: "allow" as const,
      ...Object.fromEntries(whitelisted.map((dir) => [dir, "allow" as const])),
    },
  })

  export function readOnly(input: { defaults: Permission.Ruleset; bash: Record<string, "allow" | "ask" | "deny">; whitelistedDirs: string[] }) {
    return Permission.merge(
      input.defaults,
      Permission.fromConfig({
        "*": "deny",
        read: "allow",
        grep: "allow",
        glob: "allow",
        list: "allow",
        semantic_search: "allow",
        skill: "allow",
        ...dirs(input.whitelistedDirs),
      }),
      Permission.fromConfig({ bash: { ...input.bash, "gh *": "deny", "find *": "deny" } }),
      noHuman,
    )
  }

  export function worker(input: { defaults: Permission.Ruleset; user: Permission.Ruleset; whitelistedDirs: string[] }) {
    const denies = input.user.filter((rule) => rule.action === "deny")
    return Permission.merge(
      input.defaults,
      Permission.fromConfig({
        "*": "deny",
        read: "allow",
        grep: "allow",
        glob: "allow",
        list: "allow",
        semantic_search: "allow",
        skill: "allow",
        edit: "allow",
        write: "allow",
        patch: "allow",
        multiedit: "allow",
        todowrite: "allow",
        todoread: "allow",
        webfetch: "allow",
        bash: { "*": "allow" },
        ...dirs(input.whitelistedDirs),
      }),
      denies,
      Permission.fromConfig({ bash: forbidden }),
      noHuman,
    )
  }

  type Agent = {
    name: string
    description?: string
    mode: "subagent" | "primary" | "all"
    native?: boolean
    hidden?: boolean
    permission: Permission.Ruleset
    prompt?: string
    options: Record<string, unknown>
  }

  export function register(
    agents: Record<string, Agent>,
    input: { defaults: Permission.Ruleset; user: Permission.Ruleset; readOnlyBash: Record<string, "allow" | "ask" | "deny">; whitelistedDirs: string[] },
  ) {
    const ro = readOnly({ defaults: input.defaults, bash: input.readOnlyBash, whitelistedDirs: input.whitelistedDirs })
    const base = { mode: "subagent" as const, native: true, hidden: true, options: {} }
    agents[PLANNER] = { ...base, name: PLANNER, description: "Autonomous goal planner (read-only).", prompt: PROMPT_PLANNER, permission: ro }
    agents[WORKER] = {
      ...base,
      name: WORKER,
      description: "Autonomous goal implementation worker.",
      prompt: PROMPT_WORKER,
      permission: worker({ defaults: input.defaults, user: input.user, whitelistedDirs: input.whitelistedDirs }),
    }
    agents[REVIEWER] = { ...base, name: REVIEWER, description: "Autonomous goal reviewer (read-only).", prompt: PROMPT_REVIEWER, permission: ro }
    agents[CHECKER] = { ...base, name: CHECKER, description: "Autonomous goal checker (read-only).", prompt: PROMPT_CHECKER, permission: ro }
    agents[FINAL] = { ...base, name: FINAL, description: "Autonomous goal final reviewer (read-only).", prompt: PROMPT_FINAL, permission: ro }
  }
}
