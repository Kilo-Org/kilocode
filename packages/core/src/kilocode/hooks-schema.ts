import { Record, Schema } from "effect"
import { PositiveInt } from "../schema"
import { EVENTS } from "./hooks-events"

// Changing a field or a description here also needs apps/web/src/app/config.json/extras.ts in
// Kilo-Org/cloud, which mirrors it by hand.
const Handler = Schema.Struct({
  type: Schema.Literal("command"),
  command: Schema.String.annotate({
    description:
      "Command to run. Without args it runs in bash (Git Bash on Windows) or the platform shell; with args it is the program to spawn directly. It receives the hook input as JSON on stdin.",
  }),
  args: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description: "Arguments for exec form: the command is spawned directly, without a shell.",
  }),
  shell: Schema.optional(Schema.Literals(["bash", "powershell"])).annotate({
    description: "Shell for the command when args is not set. Default: bash.",
  }),
  if: Schema.optional(Schema.String).annotate({
    description:
      'Tool events only: a permission-rule condition such as "Bash(rm *)" or "Edit(*.env)". The hook runs only when the call matches, or when Kilo cannot tell.',
  }),
  timeout: Schema.optional(PositiveInt).annotate({
    description:
      'Timeout in seconds. Default: 600; 30 for UserPromptSubmit and the model-switch events; 10 for BranchName; see the docs for the rest. Values above 86400 are capped at 24 hours. SessionEnd hooks share one 1.5 s budget per exit or deleted session, raised to the largest SessionEnd timeout (at most 60 s, or 3 s when kilo serve or the TUI exits; kilo --mini keeps the full budget). A hook that times out does not block unless onFailure is "block"; on PreModelSwitch a timeout always blocks.',
  }),
  onFailure: Schema.optional(Schema.Literals(["continue", "block"])).annotate({
    description:
      'What happens when the hook fails (cannot start, times out, exits with a code other than 0 or 2, prints invalid JSON): "continue" (default) lets the action proceed, "block" blocks it (on PermissionRequest: denies). Honored only on PreToolUse, PostToolBatch, PermissionRequest, TaskCreated, UserPromptSubmit, UserPromptExpansion, PreModelSwitch, PreCompact, WakeupFire, WorktreeSetup, CommitMessage and BranchName.',
  }),
  async: Schema.optional(Schema.Boolean).annotate({
    description: "Run in the background without waiting. Output, exit code and onFailure are ignored.",
  }),
}).annotate({ identifier: "HookHandlerConfig" })

const Group = Schema.Struct({
  matcher: Schema.optional(
    Schema.String.annotate({
      description:
        'What it matches depends on the event (tool name, source, trigger, ...): "*" or omitted matches everything, "a|b" matches exact names, anything else is a regular expression. On StopFailure only letters, digits, "_" and "|" make exact names. On FileChanged it lists the files to watch, as names or paths relative to the project folder, each taken literally ("*" is a file named *); without a matcher, the hook runs only for paths added with watchPaths. Ignored on events without a matcher.',
    }),
  ),
  hooks: Schema.mutable(Schema.Array(Handler)),
}).annotate({ identifier: "HookGroupConfig" })

const Groups = Schema.optional(Schema.mutable(Schema.Array(Group)))

export const Info = Schema.optional(
  Schema.Struct(Record.map(EVENTS, (meta) => Groups.annotate({ description: meta.description }))),
).annotate({
  description:
    "Shell command hooks run on agent events. Uses the Claude Code hooks format; behavior matches Claude Code 2.1.301 except where the docs list a difference. Only read from global, managed, or organization config; project config hooks are ignored.",
})

export * as KiloHooksSchema from "./hooks-schema"
