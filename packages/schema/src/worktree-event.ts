export * as WorktreeEvent from "./worktree-event"

import { Schema } from "effect"
import { optional } from "./schema"
import { Event } from "./event"

export const Ready = Event.define({
  type: "worktree.ready",
  schema: {
    name: Schema.String,
    branch: optional(Schema.String),
  },
})

export const Failed = Event.define({
  type: "worktree.failed",
  schema: {
    message: Schema.String,
  },
})

// kilocode_change start - fires after the worktree's start script finishes, unlike Ready
export const SetupReady = Event.define({
  type: "worktree.setup.ready",
  schema: {
    name: Schema.String,
    branch: optional(Schema.String),
  },
})
// kilocode_change end

export const Definitions = Event.inventory(Ready, Failed, SetupReady) // kilocode_change
