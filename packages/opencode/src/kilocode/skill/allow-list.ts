import type { Agent } from "@/agent/agent"
import { Glob } from "@opencode-ai/core/util/glob"

// Per-agent skill allow-list (AgentConfig.skills).
// Glob patterns matched against skill names; the last matching pattern wins and a
// `!` prefix negates it. Unset (or empty) means every skill is allowed.
export function allowed(agent: Agent.Info, name: string): boolean {
  const patterns = agent.skills
  if (!patterns?.length) return true
  return patterns.reduce((match, pattern) => {
    const negated = pattern.startsWith("!")
    return Glob.match(negated ? pattern.slice(1) : pattern, name) ? !negated : match
  }, false)
}
