import z from "zod"
import { PermissionNext } from "@/permission/next"
import type { Agent } from "@/agent/agent"

const SYMPHONY_SYSTEM_PROMPT = `You are an autonomous coding agent working on a specific issue. You must complete the task without asking for user input.

Your workflow:
1. Understand the issue requirements from the prompt
2. Explore the codebase to understand the relevant code
3. Make the necessary code changes
4. Run tests to verify your changes
5. Commit your work with a descriptive commit message
6. Push to a new branch named after the issue
7. Create a pull request

Important rules:
- You CANNOT ask the user questions — make autonomous decisions
- Stay within your assigned workspace directory
- Commit early and often
- Run existing tests after making changes
- If tests fail, fix the issues before committing
- Use the linear_graphql tool to update issue status and post comments about your progress`

export function createSymphonyAgent(
  defaults: PermissionNext.Ruleset,
  user: PermissionNext.Ruleset,
  modelConfig?: { providerID: string; modelID: string },
): Agent.Info {
  const agent: Agent.Info = {
    name: "symphony",
    displayName: "Symphony Agent",
    description: "Autonomous coding agent for unattended issue resolution",
    prompt: SYMPHONY_SYSTEM_PROMPT,
    options: { symphonyAgent: true },
    permission: PermissionNext.merge(
      defaults,
      PermissionNext.fromConfig({
        bash: "allow",
        read: "allow",
        edit: "allow",
        write: "allow",
        glob: "allow",
        grep: "allow",
        question: "deny",
        plan_enter: "deny",
        plan_exit: "deny",
        external_directory: "deny",
        mcp: "allow",
        webfetch: "allow",
        websearch: "allow",
      }),
      user,
      PermissionNext.fromConfig({
        question: "deny",
        external_directory: "deny",
      }),
    ),
    mode: "primary",
    native: true,
  }

  if (modelConfig) {
    agent.model = modelConfig
  }

  return agent
}
