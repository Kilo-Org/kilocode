import { Effect, Schema } from "effect"
import type { Agent } from "@/agent/agent"
import type * as Tool from "@/tool/tool"
import { Parameters as SkillParameters } from "@/tool/skill"
import { allowed } from "@/kilocode/skill/allow-list"

// Gate the skill tool's execute. The per-agent allow-list applies only when the
// name is a string; malformed args (null, missing, non-string) pass through so
// the tool's own schema validation surfaces Tool.InvalidArgumentsError instead
// of a raw TypeError from Glob.match inside the allow-list.
export function gateSkillTool(tool: Tool.Def, agent: Agent.Info): Tool.Def["execute"] {
  return (params: Schema.Schema.Type<typeof SkillParameters>, ctx: Tool.Context) =>
    typeof params?.name === "string" && !allowed(agent, params.name)
      ? Effect.die(new Error(`Skill "${params.name}" is not allowed for agent "${agent.name}".`))
      : tool.execute(params, ctx)
}
