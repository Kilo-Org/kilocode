import { AgentManagerService } from "@/kilocode/agent-manager/service"
import { AgentManagerTypes } from "@/kilocode/agent-manager/types"
import { Tool } from "@/tool/tool"
import CREATE_DESCRIPTION from "./agent-session-create.txt"
import LIST_DESCRIPTION from "./agent-session-list.txt"
import STATUS_DESCRIPTION from "./agent-session-status.txt"
import CANCEL_DESCRIPTION from "./agent-session-cancel.txt"
import DIFF_DESCRIPTION from "./agent-session-diff.txt"

export const AgentSessionCreateTool = Tool.define("agent_session_create", {
  description: CREATE_DESCRIPTION,
  parameters: AgentManagerTypes.CreateInput,
  async execute(params, ctx) {
    await ctx.ask({
      permission: "agent_session_create",
      patterns: ["*"],
      metadata: {
        baseBranch: params.baseBranch,
        versions: params.versions?.length,
      },
      always: ["*"],
    })
    const result = await AgentManagerService.create(params)
    return {
      title: `Created ${result.sessions.length} managed session${result.sessions.length === 1 ? "" : "s"}`,
      output: JSON.stringify(result, null, 2),
      metadata: result,
    }
  },
})

export const AgentSessionListTool = Tool.define("agent_session_list", {
  description: LIST_DESCRIPTION,
  parameters: AgentManagerTypes.ListInput,
  async execute(params, ctx) {
    await ctx.ask({
      permission: "agent_session_list",
      patterns: ["*"],
      metadata: params,
      always: ["*"],
    })
    const result = await AgentManagerService.list(params)
    return {
      title: `Found ${result.sessions.length} managed session${result.sessions.length === 1 ? "" : "s"}`,
      output: JSON.stringify(result, null, 2),
      metadata: result,
    }
  },
})

export const AgentSessionStatusTool = Tool.define("agent_session_status", {
  description: STATUS_DESCRIPTION,
  parameters: AgentManagerTypes.DetailInput,
  async execute(params, ctx) {
    await ctx.ask({
      permission: "agent_session_status",
      patterns: ["*"],
      metadata: {
        sessionID: params.sessionID,
      },
      always: ["*"],
    })
    const result = await AgentManagerService.get(params)
    return {
      title: `Loaded status for ${result.session.sessionID}`,
      output: JSON.stringify(result, null, 2),
      metadata: result,
    }
  },
})

export const AgentSessionCancelTool = Tool.define("agent_session_cancel", {
  description: CANCEL_DESCRIPTION,
  parameters: AgentManagerTypes.CancelInput,
  async execute(params, ctx) {
    await ctx.ask({
      permission: "agent_session_cancel",
      patterns: ["*"],
      metadata: {
        sessionID: params.sessionID,
      },
      always: ["*"],
    })
    const result = await AgentManagerService.cancel(params)
    return {
      title: `Cancelled managed session ${params.sessionID}`,
      output: JSON.stringify({ success: result }, null, 2),
      metadata: { success: result, sessionID: params.sessionID },
    }
  },
})

export const AgentSessionDiffTool = Tool.define("agent_session_diff", {
  description: DIFF_DESCRIPTION,
  parameters: AgentManagerTypes.DiffInput,
  async execute(params, ctx) {
    await ctx.ask({
      permission: "agent_session_diff",
      patterns: ["*"],
      metadata: {
        sessionID: params.sessionID,
        includePatch: params.includePatch,
      },
      always: ["*"],
    })
    const result = await AgentManagerService.diff(params)
    return {
      title: `Loaded diff for ${params.sessionID}`,
      output: JSON.stringify(result, null, 2),
      metadata: result,
    }
  },
})
