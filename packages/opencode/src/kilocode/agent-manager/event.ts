// kilocode_change - new file
import { BusEvent } from "@/bus/bus-event"
import { SessionID } from "@/session/schema"
import { Schema } from "effect"

export const AgentManagerTask = Schema.Struct({
  prompt: Schema.optional(Schema.String).annotate({ description: "Initial prompt to send to the new session" }),
  name: Schema.optional(Schema.String).annotate({ description: "Short display name for the Agent Manager card" }),
  branchName: Schema.optional(Schema.String).annotate({ description: "Git branch name seed for worktree mode" }),
})

export const AgentManagerMode = Schema.Literals(["worktree", "local"])

export const AgentManagerStart = Schema.Struct({
  requestID: Schema.String,
  sessionID: SessionID,
  mode: AgentManagerMode,
  versions: Schema.optional(Schema.Boolean),
  tasks: Schema.Array(AgentManagerTask).check(Schema.isMinLength(1), Schema.isMaxLength(20)),
})

export type AgentManagerStart = Schema.Schema.Type<typeof AgentManagerStart>

export const AgentManagerEvent = {
  Start: BusEvent.define("kilocode.agent_manager.start", AgentManagerStart),
}
