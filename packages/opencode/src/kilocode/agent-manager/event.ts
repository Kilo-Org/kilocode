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

export const AgentManagerControl = Schema.Struct({
  requestID: Schema.String,
  sessionID: SessionID,
  action: Schema.Literals([
    "prompt",
    "stop",
    "create_section",
    "rename_section",
    "remove_section",
    "move_to_section",
    "ungroup",
  ]),
  targetSessionID: Schema.optional(Schema.String),
  prompt: Schema.optional(Schema.String),
  worktreeID: Schema.optional(Schema.String),
  sectionID: Schema.optional(Schema.String),
  sectionName: Schema.optional(Schema.String),
  newSectionName: Schema.optional(Schema.String),
  color: Schema.optional(Schema.String),
  createIfMissing: Schema.optional(Schema.Boolean),
})

export type AgentManagerControl = Schema.Schema.Type<typeof AgentManagerControl>

export const AgentManagerInspect = Schema.Struct({
  requestID: Schema.String,
  sessionID: SessionID,
  targetSessionID: Schema.String,
  tail: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(50))),
})

export type AgentManagerInspect = Schema.Schema.Type<typeof AgentManagerInspect>

export const AgentManagerEvent = {
  Start: BusEvent.define("kilocode.agent_manager.start", AgentManagerStart),
  Control: BusEvent.define("kilocode.agent_manager.control", AgentManagerControl),
  Inspect: BusEvent.define("kilocode.agent_manager.inspect", AgentManagerInspect),
}
